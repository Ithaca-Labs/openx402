const { execFileSync } = require("node:child_process");
const S = require("@stellar/stellar-sdk");

const RPC_URL =
  process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = S.Networks.TESTNET;
const CONTRACT =
  process.env.SETTLEMENT_CONTRACT ||
  "CDEI3W6ZFW6BFSU37VL265OSOGKSM3BR3TZVUR5NZ4UER6FOMVJUKOOT";
const TEST_HOOK =
  process.env.TEST_SETTLEMENT_HOOK ||
  "CBBQTCJ4VOFJSNJ2AVDWNMBQVDPGOKQTJZHMRCWVMPX4KDPL4RETBNQI";
const TOKEN =
  process.env.TOKEN_CONTRACT ||
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const POLICY_ACCOUNT =
  process.env.POLICY_ACCOUNT ||
  "CA2OQNV5QEM3SBPZSTDUNEJWKI7ZSQKYPYRO72W2RKV4LKDXCGESQQYJ";
const OZ_POLICY =
  process.env.OZ_RECONCILING_POLICY ||
  "CCEMDZHPJFLT2UX63PKI6YZHLCCR243PRVOE56BOVCE6S4654QFITYBY";
const OZ_VERIFIER =
  process.env.OZ_ED25519_VERIFIER ||
  "CDQUKL5ONG6YORXLN3N7MX4LCO3PDHWTTNM6W6G5L4XDSRJZB5OS6R2X";
const OZ_POLICY_ACCOUNT =
  process.env.OZ_POLICY_ACCOUNT ||
  "CBFHWZ4IIMYYGOYRTVRFFBSUOUP76HDS7CQYHUTSXY2IKFNTWFSTWZWO";
const MAXIMUM = 10_000_000n;
const server = new S.rpc.Server(RPC_URL);
let settlementIdCounter = BigInt(Date.now()) * 1_000n;

function keypair(alias) {
  const secret = execFileSync("stellar", ["keys", "show", alias], {
    encoding: "utf8",
  }).trim();
  return S.Keypair.fromSecret(secret);
}

const payer = keypair(process.env.PAYER_IDENTITY || "upto-payer");
const payee = keypair(process.env.PAYEE_IDENTITY || "upto-payee");
const facilitator = keypair(
  process.env.FACILITATOR_IDENTITY || "upto-fac",
);
const channels = [
  keypair(process.env.CHANNEL_IDENTITY_1 || "upto-ch"),
  keypair(process.env.CHANNEL_IDENTITY_2 || "upto-ch2"),
];

function scAddress(address) {
  return new S.Address(address).toScVal();
}

function scI128(value) {
  return S.nativeToScVal(BigInt(value), { type: "i128" });
}

function scU32(value) {
  return S.nativeToScVal(Number(value), { type: "u32" });
}

function nextSettlementId() {
  const id = Buffer.alloc(32);
  id.writeBigUInt64BE(settlementIdCounter, 24);
  settlementIdCounter += 1n;
  return id;
}

function scSettlementId(value) {
  return S.nativeToScVal(new Uint8Array(value), { type: "bytes" });
}

function scOptionalAddress(value) {
  return value ? scAddress(value) : S.xdr.ScVal.scvVoid();
}

function authAddress(entry) {
  if (
    entry.credentials().switch() !==
    S.xdr.SorobanCredentialsType.sorobanCredentialsAddress()
  ) {
    return undefined;
  }
  return S.Address.fromScAddress(
    entry.credentials().address().address(),
  ).toString();
}

function cloneEntry(entry) {
  return S.xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR());
}

function operation(actual, terms, auth, payerAddress = payer.publicKey()) {
  const raw = new S.Contract(CONTRACT).call(
    "settle",
    scAddress(payerAddress),
    scAddress(terms.payTo),
    scAddress(TOKEN),
    scI128(terms.maximum),
    scU32(terms.validAfter),
    scU32(terms.deadline),
    scAddress(facilitator.publicKey()),
    scSettlementId(terms.settlementId),
    scOptionalAddress(terms.settlementHook),
    scI128(actual),
  );
  if (!auth) {
    return raw;
  }
  return S.Operation.invokeHostFunction({
    func: raw.body().invokeHostFunctionOp().hostFunction(),
    auth,
  });
}

async function transaction(
  source,
  actual,
  terms,
  auth,
  payerAddress = payer.publicKey(),
) {
  const account = await server.getAccount(source.publicKey());
  return new S.TransactionBuilder(account, {
    fee: "1000000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(operation(actual, terms, auth, payerAddress))
    .setTimeout(120)
    .build();
}

function simulationError(simulation) {
  if (!S.rpc.Api.isSimulationError(simulation)) {
    return undefined;
  }
  return simulation.error.split("\n")[0];
}

async function prepare({
  source,
  actual,
  terms,
  payerEntry,
  facilitatorEntry,
  payerAddress = payer.publicKey(),
  authorizePayer,
  maxResourceFee,
}) {
  const recordingTx = await transaction(
    source,
    actual,
    terms,
    undefined,
    payerAddress,
  );
  const recording = await server.simulateTransaction(recordingTx);
  const recordError = simulationError(recording);
  if (recordError) {
    if (process.env.DEBUG_SIM === "1") {
      console.dir(recording, { depth: 8 });
    }
    throw new Error(`recording simulation rejected: ${recordError}`);
  }

  let foundPayer = false;
  let foundFacilitator = false;
  const signedEntries = [];
  for (const entry of recording.result.auth || []) {
    const address = authAddress(entry);
    if (address === payerAddress) {
      foundPayer = true;
      signedEntries.push(
        payerEntry
          ? cloneEntry(payerEntry)
          : authorizePayer
            ? await authorizePayer(cloneEntry(entry), terms.deadline)
            : await S.authorizeEntry(
                cloneEntry(entry),
                payer,
                terms.deadline,
                NETWORK_PASSPHRASE,
              ),
      );
      continue;
    }
    if (address === facilitator.publicKey()) {
      foundFacilitator = true;
      signedEntries.push(
        facilitatorEntry
          ? cloneEntry(facilitatorEntry)
          : await S.authorizeEntry(
              cloneEntry(entry),
              facilitator,
              terms.deadline,
              NETWORK_PASSPHRASE,
            ),
      );
      continue;
    }
    throw new Error(`unexpected auth entry for ${address || "source account"}`);
  }
  if (!foundPayer || !foundFacilitator || signedEntries.length !== 2) {
    throw new Error("recording simulation returned the wrong authorization set");
  }

  const signedTx = await transaction(
    source,
    actual,
    terms,
    signedEntries,
    payerAddress,
  );
  const enforcing = await server.simulateTransaction(signedTx, {
    authMode: "enforce",
  });
  const enforceError = simulationError(enforcing);
  if (enforceError) {
    if (process.env.DEBUG_SIM === "1") {
      console.dir(enforcing, { depth: 8 });
    }
    const error = new Error(`enforcing simulation rejected: ${enforceError}`);
    error.code = "ENFORCING_REJECTED";
    error.recordFee = BigInt(recording.minResourceFee);
    throw error;
  }
  if (
    maxResourceFee !== undefined &&
    BigInt(enforcing.minResourceFee) > BigInt(maxResourceFee)
  ) {
    const error = new Error(
      `enforcing fee ${enforcing.minResourceFee} exceeds ceiling ${maxResourceFee}`,
    );
    error.code = "FEE_CEILING";
    error.recordFee = BigInt(recording.minResourceFee);
    error.enforceFee = BigInt(enforcing.minResourceFee);
    throw error;
  }

  const assembled = S.rpc.assembleTransaction(signedTx, enforcing).build();
  assembled.sign(source);
  return {
    transaction: assembled,
    payerEntry: signedEntries.find(
      (entry) => authAddress(entry) === payerAddress,
    ),
    facilitatorEntry: signedEntries.find(
      (entry) => authAddress(entry) === facilitator.publicKey(),
    ),
    recordFee: BigInt(recording.minResourceFee),
    enforceFee: BigInt(enforcing.minResourceFee),
  };
}

async function submit(prepared) {
  const sent = await server.sendTransaction(prepared.transaction);
  if (sent.status === "ERROR") {
    return { status: "SUBMIT_ERROR", hash: sent.hash || "" };
  }

  let result = await server.getTransaction(sent.hash);
  for (let i = 0; i < 20 && result.status === "NOT_FOUND"; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    result = await server.getTransaction(sent.hash);
  }
  return {
    status: result.status,
    hash: sent.hash,
    fee: result.resultXdr
      ? BigInt(result.resultXdr.feeCharged())
      : undefined,
  };
}

async function terms() {
  const current = (await server.getLatestLedger()).sequence;
  return {
    maximum: MAXIMUM,
    validAfter: current,
    deadline: current + 1_000,
    payTo: payee.publicKey(),
    settlementId: nextSettlementId(),
    settlementHook: null,
  };
}

async function view(functionName, args) {
  return contractView(TOKEN, functionName, args);
}

async function contractView(contract, functionName, args) {
  const account = await server.getAccount(channels[0].publicKey());
  const tx = new S.TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(new S.Contract(contract).call(functionName, ...args))
    .setTimeout(30)
    .build();
  const simulation = await server.simulateTransaction(tx);
  const error = simulationError(simulation);
  if (error) {
    throw new Error(`view ${functionName} failed: ${error}`);
  }
  return S.scValToNative(simulation.result.retval);
}

function scSymbol(value) {
  return S.xdr.ScVal.scvSymbol(value);
}

function scMap(entries) {
  return S.xdr.ScVal.scvMap(
    entries.map(
      ([key, val]) =>
        new S.xdr.ScMapEntry({
          key,
          val,
        }),
    ),
  );
}

function ozExternalSigner() {
  return S.xdr.ScVal.scvVec([
    scSymbol("External"),
    scAddress(OZ_VERIFIER),
    S.xdr.ScVal.scvBytes(payer.rawPublicKey()),
  ]);
}

async function authorizeOzPolicyAccount(entry, expirationLedger) {
  return S.authorizeEntry(
    cloneEntry(entry),
    (_preimage, signaturePayload) => {
      const ruleIds = S.xdr.ScVal.scvVec([scU32(0), scU32(1)]);
      const authDigest = S.hash(
        Buffer.concat([signaturePayload, ruleIds.toXDR()]),
      );
      const signer = ozExternalSigner();
      const signatures = scMap([
        [signer, S.xdr.ScVal.scvBytes(payer.sign(authDigest))],
      ]);
      const signatureScVal = scMap([
        [scSymbol("context_rule_ids"), ruleIds],
        [scSymbol("signers"), signatures],
      ]);
      return { address: OZ_POLICY_ACCOUNT, signatureScVal };
    },
    expirationLedger,
    NETWORK_PASSPHRASE,
    OZ_POLICY_ACCOUNT,
  );
}

async function ozReconcilingPolicy() {
  const startingBudget = await contractView(OZ_POLICY, "get_budget", [
    scAddress(OZ_POLICY_ACCOUNT),
    scU32(0),
  ]);
  const partialTerms = {
    ...(await terms()),
    settlementHook: OZ_POLICY,
  };
  const partial = await prepare({
    source: channels[0],
    actual: 3_000_000n,
    terms: partialTerms,
    payerAddress: OZ_POLICY_ACCOUNT,
    authorizePayer: authorizeOzPolicyAccount,
  });
  const partialResult = await submit(partial);
  if (partialResult.status !== "SUCCESS") {
    throw new Error(`OZ partial settlement failed with ${partialResult.status}`);
  }

  let budget = await contractView(OZ_POLICY, "get_budget", [
    scAddress(OZ_POLICY_ACCOUNT),
    scU32(0),
  ]);
  const expectedCommitted = startingBudget.committed + 3_000_000n;
  if (budget.committed !== expectedCommitted) {
    throw new Error(
      `OZ policy kept ${budget.committed}, expected ${expectedCommitted}`,
    );
  }
  console.log(
    `OZ policy partial: SUCCESS hash=${partialResult.hash} recordFee=${partial.recordFee} enforceFee=${partial.enforceFee} charged=${partialResult.fee}`,
  );

  const zeroTerms = {
    ...(await terms()),
    settlementHook: OZ_POLICY,
  };
  const zero = await prepare({
    source: channels[0],
    actual: 0n,
    terms: zeroTerms,
    payerAddress: OZ_POLICY_ACCOUNT,
    authorizePayer: authorizeOzPolicyAccount,
  });
  const zeroResult = await submit(zero);
  if (zeroResult.status !== "SUCCESS") {
    throw new Error(`OZ zero settlement failed with ${zeroResult.status}`);
  }
  budget = await contractView(OZ_POLICY, "get_budget", [
    scAddress(OZ_POLICY_ACCOUNT),
    scU32(0),
  ]);
  if (budget.committed !== expectedCommitted) {
    throw new Error(`zero settlement changed committed budget to ${budget.committed}`);
  }
  console.log(
    `OZ policy zero: SUCCESS hash=${zeroResult.hash} recordFee=${zero.recordFee} enforceFee=${zero.enforceFee} charged=${zeroResult.fee}`,
  );

  await expectSimulationRejection("OZ duplicate settlement ID with fresh nonce", {
    source: channels[0],
    actual: 0n,
    terms: zeroTerms,
    payerAddress: OZ_POLICY_ACCOUNT,
    authorizePayer: authorizeOzPolicyAccount,
  });

  await expectEnforcingRejection("OZ conservative maximum exceeds remaining budget", {
    source: channels[0],
    actual: 1n,
    terms: {
      ...(await terms()),
      maximum: 98_000_000n,
      settlementHook: OZ_POLICY,
    },
    payerAddress: OZ_POLICY_ACCOUNT,
    authorizePayer: authorizeOzPolicyAccount,
  });

  const allowance = await view("allowance", [
    scAddress(OZ_POLICY_ACCOUNT),
    scAddress(CONTRACT),
  ]);
  if (allowance !== 0n) {
    throw new Error(`OZ policy account allowance remained ${allowance}`);
  }
}

async function assertTerminalBalances() {
  const allowance = await view("allowance", [
    scAddress(payer.publicKey()),
    scAddress(CONTRACT),
  ]);
  const contractBalance = await view("balance", [scAddress(CONTRACT)]);
  if (allowance !== 0n || contractBalance !== 0n) {
    throw new Error(
      `terminal invariant failed: allowance=${allowance} contract=${contractBalance}`,
    );
  }
}

async function settleFresh(
  label,
  actual,
  source = channels[0],
  termOverrides = {},
) {
  const paymentTerms = { ...(await terms()), ...termOverrides };
  const prepared = await prepare({
    source,
    actual,
    terms: paymentTerms,
  });
  const result = await submit(prepared);
  if (result.status !== "SUCCESS") {
    throw new Error(`${label} failed with ${result.status}`);
  }
  await assertTerminalBalances();
  console.log(
    `${label}: SUCCESS hash=${result.hash} recordFee=${prepared.recordFee} enforceFee=${prepared.enforceFee} charged=${result.fee}`,
  );
  return { ...prepared, result, terms: paymentTerms, actual };
}

async function expectEnforcingRejection(label, options) {
  try {
    await prepare(options);
  } catch (error) {
    if (error.code === "ENFORCING_REJECTED") {
      console.log(`${label}: rejected`);
      return;
    }
    throw error;
  }
  throw new Error(`${label} unexpectedly passed enforcing simulation`);
}

async function expectRecordingRejection(label, actual, termOverrides = {}) {
  const paymentTerms = { ...(await terms()), ...termOverrides };
  try {
    await prepare({
      source: channels[0],
      actual,
      terms: paymentTerms,
    });
  } catch (error) {
    if (error.message.startsWith("recording simulation rejected:")) {
      console.log(`${label}: rejected`);
      return;
    }
    throw error;
  }
  throw new Error(`${label} unexpectedly passed recording simulation`);
}

async function expectSimulationRejection(label, options) {
  try {
    await prepare(options);
  } catch (error) {
    if (
      error.code === "ENFORCING_REJECTED" ||
      error.message.startsWith("recording simulation rejected:")
    ) {
      console.log(`${label}: rejected`);
      return;
    }
    throw error;
  }
  throw new Error(`${label} unexpectedly passed simulation`);
}

async function changedActualAndReplay() {
  const paymentTerms = await terms();
  const unsignedUse = await prepare({
    source: channels[0],
    actual: 1_000_000n,
    terms: paymentTerms,
  });
  await expectEnforcingRejection("recipient changed after payer signature", {
    source: channels[0],
    actual: 1_000_000n,
    terms: { ...paymentTerms, payTo: channels[1].publicKey() },
    payerEntry: unsignedUse.payerEntry,
  });

  const changed = await prepare({
    source: channels[0],
    actual: 2_000_000n,
    terms: paymentTerms,
    payerEntry: unsignedUse.payerEntry,
  });
  const result = await submit(changed);
  if (result.status !== "SUCCESS") {
    throw new Error(`changed actual failed with ${result.status}`);
  }
  console.log(
    `same payer auth, changed actual before use: SUCCESS hash=${result.hash}`,
  );

  await expectEnforcingRejection("same auth replay, changed actual", {
    source: channels[0],
    actual: 3_000_000n,
    terms: paymentTerms,
    payerEntry: unsignedUse.payerEntry,
  });
  await expectEnforcingRejection("identical auth replay", {
    source: channels[0],
    actual: 2_000_000n,
    terms: paymentTerms,
    payerEntry: unsignedUse.payerEntry,
    facilitatorEntry: changed.facilitatorEntry,
  });

}

async function concurrentSameAuthorization() {
  const paymentTerms = await terms();
  const seed = await prepare({
    source: channels[0],
    actual: 1_000_000n,
    terms: paymentTerms,
  });
  const first = await prepare({
    source: channels[0],
    actual: 1_000_000n,
    terms: paymentTerms,
    payerEntry: seed.payerEntry,
  });
  const second = await prepare({
    source: channels[1],
    actual: 1_000_000n,
    terms: paymentTerms,
    payerEntry: seed.payerEntry,
  });

  const results = await Promise.all([submit(first), submit(second)]);
  const successes = results.filter((result) => result.status === "SUCCESS");
  if (successes.length !== 1) {
    throw new Error(
      `concurrent replay expected one success, got ${JSON.stringify(results)}`,
    );
  }
  console.log(
    `concurrent same payer auth: ${results
      .map((result) => `${result.status}:${result.hash}`)
      .join(" | ")}`,
  );
}

function invokePolicyAccount(functionName, value) {
  execFileSync(
    "stellar",
    [
      "contract",
      "invoke",
      "--id",
      POLICY_ACCOUNT,
      "--source",
      "upto-payer",
      "--network",
      "testnet",
      "--",
      functionName,
      `--${functionName === "init" ? "cap" : "n"}`,
      String(value),
    ],
    { stdio: "ignore" },
  );
}

function transferNative(sourceAlias, from, to, amount) {
  execFileSync(
    "stellar",
    [
      "contract",
      "invoke",
      "--id",
      TOKEN,
      "--source",
      sourceAlias,
      "--network",
      "testnet",
      "--",
      "transfer",
      "--from",
      from,
      "--to",
      to,
      "--amount",
      String(amount),
    ],
    { stdio: "ignore" },
  );
}

function configureTestHook(burnIterations, recordCalls) {
  execFileSync(
    "stellar",
    [
      "contract",
      "invoke",
      "--id",
      TEST_HOOK,
      "--source",
      "upto-payee",
      "--network",
      "testnet",
      "--",
      "configure",
      "--burn_iterations",
      String(burnIterations),
      "--record_calls",
      String(recordCalls),
    ],
    { stdio: "ignore" },
  );
}

async function hookFeeGate() {
  await expectRecordingRejection("self-referential hook", 1_000_000n, {
    settlementHook: CONTRACT,
  });
  await expectRecordingRejection("token-address hook", 1_000_000n, {
    settlementHook: TOKEN,
  });

  const noHook = await settleFresh("hook profile/no-hook", 1_000_000n);

  configureTestHook(0, false);
  const noOpHook = await settleFresh(
    "hook profile/no-op",
    1_000_000n,
    channels[0],
    { settlementHook: TEST_HOOK },
  );

  configureTestHook(0, true);
  const statefulHook = await settleFresh(
    "hook profile/stateful",
    1_000_000n,
    channels[0],
    { settlementHook: TEST_HOOK },
  );

  configureTestHook(1_000, false);
  const burnTerms = { ...(await terms()), settlementHook: TEST_HOOK };
  const burning = await prepare({
    source: channels[0],
    actual: 1_000_000n,
    terms: burnTerms,
  });
  if (burning.enforceFee <= noOpHook.enforceFee) {
    throw new Error(
      `CPU hook fee did not increase: no-op=${noOpHook.enforceFee} burn=${burning.enforceFee}`,
    );
  }

  const testCeiling =
    noOpHook.enforceFee + (burning.enforceFee - noOpHook.enforceFee) / 2n;
  try {
    await prepare({
      source: channels[0],
      actual: 1_000_000n,
      terms: { ...(await terms()), settlementHook: TEST_HOOK },
      maxResourceFee: testCeiling,
    });
  } catch (error) {
    if (error.code === "FEE_CEILING") {
      console.log(
        `hook profile/CPU burn: enforcingFee=${error.enforceFee} rejectedByTestCeiling=${testCeiling}`,
      );
      configureTestHook(0, false);
      return { noHook, noOpHook, statefulHook, burning, testCeiling };
    }
    throw error;
  }
  throw new Error("CPU-burning hook unexpectedly passed the enforcing fee ceiling");
}

async function authorizeVoidAccount(entry, expirationLedger) {
  const copy = cloneEntry(entry);
  copy
    .credentials()
    .address()
    .signatureExpirationLedger(expirationLedger);
  copy.credentials().address().signature(S.xdr.ScVal.scvVoid());
  return copy;
}

async function smartAccountPolicy() {
  invokePolicyAccount("set_burn", 0);
  invokePolicyAccount("init", MAXIMUM - 1n);
  const lowCapTerms = await terms();
  let lowCapRecordFee;
  try {
    await prepare({
      source: channels[0],
      actual: 1_000_000n,
      terms: lowCapTerms,
      payerAddress: POLICY_ACCOUNT,
      authorizePayer: authorizeVoidAccount,
    });
  } catch (error) {
    if (error.code !== "ENFORCING_REJECTED") {
      throw error;
    }
    lowCapRecordFee = error.recordFee;
    console.log("C-account cap below signed maximum: enforcing rejected");
  }
  if (lowCapRecordFee === undefined) {
    throw new Error("C-account cap unexpectedly passed");
  }

  invokePolicyAccount("init", MAXIMUM * 10n);
  invokePolicyAccount("set_burn", 5_000_000);
  const burnTerms = await terms();
  let burnRecordFee;
  try {
    await prepare({
      source: channels[0],
      actual: 1_000_000n,
      terms: burnTerms,
      payerAddress: POLICY_ACCOUNT,
      authorizePayer: authorizeVoidAccount,
    });
  } catch (error) {
    if (error.code !== "ENFORCING_REJECTED") {
      throw error;
    }
    burnRecordFee = error.recordFee;
    console.log("C-account CPU burn: enforcing rejected");
  }
  if (burnRecordFee === undefined) {
    throw new Error("C-account CPU burn unexpectedly passed");
  }
  console.log(
    `record-mode custom-account fees: normal=${lowCapRecordFee} burn=${burnRecordFee}`,
  );

  invokePolicyAccount("set_burn", 0);
  const balance = await view("balance", [scAddress(POLICY_ACCOUNT)]);
  if (balance < MAXIMUM) {
    throw new Error(`policy account needs ${MAXIMUM}, has ${balance}`);
  }
  const paymentTerms = await terms();
  const prepared = await prepare({
    source: channels[0],
    actual: 1_000_000n,
    terms: paymentTerms,
    payerAddress: POLICY_ACCOUNT,
    authorizePayer: authorizeVoidAccount,
  });
  const result = await submit(prepared);
  if (result.status !== "SUCCESS") {
    throw new Error(`C-account settlement failed with ${result.status}`);
  }
  const allowance = await view("allowance", [
    scAddress(POLICY_ACCOUNT),
    scAddress(CONTRACT),
  ]);
  if (allowance !== 0n) {
    throw new Error(`C-account allowance remained ${allowance}`);
  }
  console.log(
    `C-account policy settlement: SUCCESS hash=${result.hash} recordFee=${prepared.recordFee} enforceFee=${prepared.enforceFee}`,
  );
}

async function replayAfterFailure() {
  const startingBalance = await view("balance", [scAddress(payer.publicKey())]);
  const remainingBalance = 30_000_000n;
  const paymentTerms = {
    ...(await terms()),
    maximum: 40_000_000n,
  };
  if (startingBalance <= paymentTerms.maximum) {
    throw new Error("payer balance is too low for the failure replay test");
  }

  const prepared = await prepare({
    source: channels[0],
    actual: 1_000_000n,
    terms: paymentTerms,
  });
  const drained = startingBalance - remainingBalance;
  transferNative(
    "upto-payer",
    payer.publicKey(),
    payee.publicKey(),
    drained,
  );

  const failed = await submit(prepared);
  if (failed.status === "SUCCESS") {
    throw new Error("state-raced settlement unexpectedly succeeded");
  }
  console.log(
    `forced insufficient-balance settlement: ${failed.status} hash=${failed.hash}`,
  );

  transferNative(
    "upto-payee",
    payee.publicKey(),
    payer.publicKey(),
    drained,
  );
  const retry = await prepare({
    source: channels[0],
    actual: 1_000_000n,
    terms: paymentTerms,
    payerEntry: prepared.payerEntry,
    facilitatorEntry: prepared.facilitatorEntry,
  });
  const retried = await submit(retry);
  if (retried.status !== "SUCCESS") {
    throw new Error(`retry after failure returned ${retried.status}`);
  }
  console.log(
    `same auth after failed transaction: SUCCESS hash=${retried.hash}`,
  );
}

async function main() {
  console.log(`contract=${CONTRACT}`);
  console.log(`payer=${payer.publicKey()}`);
  console.log(`facilitator=${facilitator.publicKey()}`);
  console.log(`channels=${channels.map((key) => key.publicKey()).join(",")}`);

  if (process.env.ONLY_POLICY === "1") {
    await smartAccountPolicy();
    return;
  }
  if (process.env.ONLY_OZ_POLICY === "1") {
    await ozReconcilingPolicy();
    return;
  }
  if (process.env.ONLY_FAILURE_REPLAY === "1") {
    await replayAfterFailure();
    return;
  }
  if (process.env.ONLY_HOOK_FEES === "1") {
    await hookFeeGate();
    return;
  }

  await settleFresh("actual=0", 0n);
  await settleFresh("actual<max", 3_000_000n);
  await settleFresh("actual=max", MAXIMUM);
  await expectRecordingRejection("negative actual", -1n);
  await expectRecordingRejection("actual above maximum", MAXIMUM + 1n);
  await changedActualAndReplay();
  await concurrentSameAuthorization();
  await replayAfterFailure();
  await smartAccountPolicy();
  await ozReconcilingPolicy();
  await hookFeeGate();
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

const assert = require("node:assert/strict");
const test = require("node:test");
const S = require("@stellar/stellar-sdk");

const SETTLEMENT = "CDEI3W6ZFW6BFSU37VL265OSOGKSM3BR3TZVUR5NZ4UER6FOMVJUKOOT";
const OTHER_CONTRACT = "CBBQTCJ4VOFJSNJ2AVDWNMBQVDPGOKQTJZHMRCWVMPX4KDPL4RETBNQI";
const TOKEN = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const EXPIRATION = 1_000;

function address(value) {
  return new S.Address(value).toScVal();
}

function contractInvocation(contractId, functionName, args, children = []) {
  return new S.xdr.SorobanAuthorizedInvocation({
    function: S.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new S.xdr.InvokeContractArgs({
        contractAddress: new S.Address(contractId).toScAddress(),
        functionName,
        args,
      }),
    ),
    subInvocations: children,
  });
}

function settlementInvocation(payer, contractId = SETTLEMENT) {
  const approve = contractInvocation(TOKEN, "approve", [
    address(payer),
    address(contractId),
    S.nativeToScVal(10_000n, { type: "i128" }),
    S.nativeToScVal(1_000, { type: "u32" }),
  ]);
  return contractInvocation(contractId, "settle", [
    address(payer),
    address(S.Keypair.random().publicKey()),
    address(TOKEN),
    S.nativeToScVal(10_000n, { type: "i128" }),
    S.nativeToScVal(900, { type: "u32" }),
    S.nativeToScVal(1_000, { type: "u32" }),
    address(S.Keypair.random().publicKey()),
    S.xdr.ScVal.scvBytes(Buffer.alloc(32, 7)),
    S.xdr.ScVal.scvVoid(),
    S.nativeToScVal(3_000n, { type: "i128" }),
  ], [approve]);
}

function payload(entry, expiration, networkPassphrase) {
  return S.hash(
    S.buildAuthorizationEntryPreimage(entry, expiration, networkPassphrase).toXDR(),
  );
}

test("authorization signature is bound to the Stellar network", async () => {
  const signer = S.Keypair.random();
  const entry = await S.authorizeInvocation({
    signer,
    validUntilLedgerSeq: EXPIRATION,
    invocation: settlementInvocation(signer.publicKey()),
    networkPassphrase: S.Networks.TESTNET,
  });
  const testnetPayload = payload(entry, EXPIRATION, S.Networks.TESTNET);
  const pubnetPayload = payload(entry, EXPIRATION, S.Networks.PUBLIC);
  const signature = signer.sign(testnetPayload);

  assert.notDeepEqual(testnetPayload, pubnetPayload);
  assert.equal(signer.verify(testnetPayload, signature), true);
  assert.equal(signer.verify(pubnetPayload, signature), false);
});

test("authorization signature is bound to the settlement contract", async () => {
  const signer = S.Keypair.random();
  const entry = await S.authorizeInvocation({
    signer,
    validUntilLedgerSeq: EXPIRATION,
    invocation: settlementInvocation(signer.publicKey()),
    networkPassphrase: S.Networks.TESTNET,
  });
  const originalPayload = payload(entry, EXPIRATION, S.Networks.TESTNET);
  const substituted = S.xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR());
  substituted.rootInvocation(settlementInvocation(signer.publicKey(), OTHER_CONTRACT));
  const substitutedPayload = payload(substituted, EXPIRATION, S.Networks.TESTNET);
  const signature = signer.sign(originalPayload);

  assert.notDeepEqual(originalPayload, substitutedPayload);
  assert.equal(signer.verify(substitutedPayload, signature), false);
});

test("authorization signature is bound to signatureExpirationLedger", async () => {
  const signer = S.Keypair.random();
  const entry = await S.authorizeInvocation({
    signer,
    validUntilLedgerSeq: EXPIRATION,
    invocation: settlementInvocation(signer.publicKey()),
    networkPassphrase: S.Networks.TESTNET,
  });
  const originalPayload = payload(entry, EXPIRATION, S.Networks.TESTNET);
  const changedPayload = payload(entry, EXPIRATION + 1, S.Networks.TESTNET);
  const signature = signer.sign(originalPayload);

  assert.notDeepEqual(originalPayload, changedPayload);
  assert.equal(signer.verify(changedPayload, signature), false);
});

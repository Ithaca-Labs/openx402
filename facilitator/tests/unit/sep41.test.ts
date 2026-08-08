import { Address, Keypair, StrKey, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { validateExactTransferEvents } from "../../src/stellar/common.js";

const ASSET_BYTES = Buffer.alloc(32, 17);
const ASSET_ID = ASSET_BYTES as unknown as xdr.Hash;
const OTHER_CONTRACT_ID = Buffer.alloc(32, 18) as unknown as xdr.Hash;
const ASSET = StrKey.encodeContract(ASSET_BYTES);
const FROM = Keypair.random().publicKey();
const TO = Keypair.random().publicKey();

function i128(value: bigint): xdr.ScVal {
  const unsigned = value >= 0n ? value : (1n << 128n) + value;
  return xdr.ScVal.scvI128(new xdr.Int128Parts({
    hi: xdr.Int64.fromString(BigInt.asIntN(64, unsigned >> 64n).toString()),
    lo: xdr.Uint64.fromString(BigInt.asUintN(64, unsigned).toString()),
  }));
}

function event(args: {
  contractId?: xdr.Hash | null;
  name: string;
  topics?: xdr.ScVal[];
  data?: xdr.ScVal;
  type?: "contract" | "system";
}): xdr.DiagnosticEvent {
  const topics = [xdr.ScVal.scvSymbol(args.name), ...(args.topics ?? [])];
  const bodyV0 = new xdr.ContractEventV0({ topics, data: args.data ?? xdr.ScVal.scvVoid() });
  const body = xdr.ContractEventBody.fromXDR(Buffer.concat([
    Buffer.from([0, 0, 0, 0]),
    xdr.ContractEventV0.toXDR(bodyV0),
  ]));
  return new xdr.DiagnosticEvent({
    inSuccessfulContractCall: true,
    event: new xdr.ContractEvent({
      ext: xdr.ExtensionPoint.fromXDR(Buffer.from([0, 0, 0, 0])),
      contractId: args.contractId === null ? null : (args.contractId ?? ASSET_ID),
      type: args.type === "system" ? xdr.ContractEventType.system() : xdr.ContractEventType.contract(),
      body,
    }),
  });
}

function transfer(amount: bigint, extraTopics: xdr.ScVal[] = []): xdr.DiagnosticEvent {
  return event({
    name: "transfer",
    topics: [new Address(FROM).toScVal(), new Address(TO).toScVal(), ...extraTopics],
    data: i128(amount),
  });
}

function validate(events: xdr.DiagnosticEvent[], amount = 1_234_567n) {
  return validateExactTransferEvents(events, { asset: ASSET, from: FROM, to: TO, amount });
}

describe("generic SEP-41 exact transfer validation", () => {
  it("compares six-decimal token amounts as atomic i128 values without conversion", () => {
    expect(validate([transfer(1_234_567n)])).toBeUndefined();
  });

  it("supports the optional extra transfer topics used by compliant token variants", () => {
    expect(validate([transfer(1_234_567n, [xdr.ScVal.scvSymbol("memo")])])).toBeUndefined();
  });

  it("ignores unrelated events from the token and nested smart-account contracts", () => {
    const tokenMetadataEvent = event({ name: "audit", data: xdr.ScVal.scvString("policy checked") });
    const accountEvent = event({
      contractId: OTHER_CONTRACT_ID,
      name: "authorized",
      data: xdr.ScVal.scvBool(true),
    });
    const systemEvent = event({ contractId: null, name: "", type: "system" });

    expect(validate([tokenMetadataEvent, accountEvent, systemEvent, transfer(1_234_567n)])).toBeUndefined();
  });

  it("rejects a malformed transfer event from the configured token", () => {
    const malformed = event({
      name: "transfer",
      topics: [new Address(FROM).toScVal()],
      data: i128(1_234_567n),
    });

    expect(validate([malformed])).toMatchObject({
      isValid: false,
      invalidReason: "invalid_exact_stellar_malformed_transfer_event",
    });
  });

  it("rejects absent, duplicate, wrong-recipient, and wrong-amount balance changes", () => {
    expect(validate([])?.invalidReason).toBe("invalid_exact_stellar_unexpected_balance_changes");
    expect(validate([transfer(1_234_567n), transfer(1_234_567n)])?.invalidReason)
      .toBe("invalid_exact_stellar_unexpected_balance_changes");
    expect(validate([transfer(1_234_568n)])?.invalidReason)
      .toBe("invalid_exact_stellar_unexpected_balance_changes");
    const wrongRecipient = event({
      name: "transfer",
      topics: [new Address(FROM).toScVal(), new Address(Keypair.random().publicKey()).toScVal()],
      data: i128(1_234_567n),
    });
    expect(validate([wrongRecipient])?.invalidReason)
      .toBe("invalid_exact_stellar_unexpected_balance_changes");
  });

  it("accepts the full positive i128 range without JavaScript number coercion", () => {
    const maximum = (1n << 127n) - 1n;
    expect(validateExactTransferEvents([transfer(maximum)], {
      asset: ASSET,
      from: FROM,
      to: TO,
      amount: maximum,
    })).toBeUndefined();
  });
});

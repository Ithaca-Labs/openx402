import { beforeEach, describe, expect, it, vi } from "vitest";

const CATALOG_RESOURCE = {
  resource: "https://api.example.com/mcp", type: "mcp" as const, x402Version: 2, lastUpdated: "now",
  accepts: [{ scheme: "exact", network: "stellar:testnet", asset: "CASSET", amount: "10000", payTo: "GPAYTO", maxTimeoutSeconds: 60, extra: {} }],
  extensions: { bazaar: { info: { input: { type: "mcp", toolName: "sentiment", transport: "streamable-http", inputSchema: {} } } } },
};

const PAYMENT_REQUIRED = {
  x402Version: 2,
  resource: { url: "https://api.example.com/mcp" },
  accepts: CATALOG_RESOURCE.accepts,
  extensions: CATALOG_RESOURCE.extensions,
};

function unpaidResult() {
  return { isError: true, structuredContent: PAYMENT_REQUIRED, content: [{ type: "text", text: JSON.stringify(PAYMENT_REQUIRED) }] };
}

async function setup(paidCallToolImpl: () => Promise<unknown>) {
  vi.resetModules();
  vi.doMock("../../src/network/mcpConnection.js", () => ({
    resolveConnectableEndpoint: () => new URL("https://seller.example.com/mcp"),
    connectMcpClient: async () => ({
      client: {
        callTool: vi.fn()
          .mockResolvedValueOnce(unpaidResult())
          .mockImplementationOnce(paidCallToolImpl),
      },
      close: vi.fn(),
    }),
  }));
  vi.doMock("../../src/payment/schemeRegistry.js", () => ({
    buildSchemeRegistry: () => new Map([["exact", { scheme: "exact", createPaymentPayload: async (x402Version: number) => ({ x402Version, payload: { transaction: "FAKEXDR" } }) }]]),
    resolveScheme: (registry: Map<string, unknown>, scheme: string) => registry.get(scheme),
    UptoUnavailableError: class UptoUnavailableError extends Error {},
  }));

  const { callResource } = await import("../../src/tools/callResource.js");
  const { encodeResourceRef } = await import("../../src/resourceRef.js");
  const { MemoryBudgetStore } = await import("../../src/budget/memoryBudgetStore.js");
  const { SingleRetryGuard } = await import("../../src/payment/paymentIdentifier.js");

  const budgetStore = new MemoryBudgetStore();
  const facilitatorClient = { getResource: async () => CATALOG_RESOURCE } as never;
  const signerProvider = { getSigner: async () => ({ address: "GBUYER", signAuthEntry: async () => ({ signedAuthEntry: "x" }) }) } as never;

  const run = () => callResource({
    facilitatorClient, budgetStore, signerProvider,
    config: { networks: { pubnet: false }, transport: "stdio", httpApiKeys: [], budget: { store: "memory", defaultPerCallMaxAtomic: 1_000_000n, defaultSessionOrDayMaxAtomic: 1_000_000n } } as never,
    retryGuard: new SingleRetryGuard(),
    mcpConnectionConfig: { allowInsecureLocal: false, maxResponseBytes: 1024, timeoutMs: 1000, maxRedirects: 3, resolvedMcpEndpoints: {} },
  }, {
    ref: encodeResourceRef({ type: "mcp", url: "https://api.example.com/mcp", toolName: "sentiment" }),
    toolArguments: { text: "hello" },
    network: "stellar:testnet" as const, scheme: "exact" as const, asset: "CASSET", maxAtomicAmount: "10000",
    agentId: "agent-1",
  });

  return { run, budgetStore };
}

async function captureIdentifier(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    throw new Error("expected run() to reject");
  } catch (error) {
    const details = (error as { details?: { paymentIdentifier?: string } }).details;
    if (!details?.paymentIdentifier) throw error;
    return details.paymentIdentifier;
  }
}

describe("callResource settlement outcomes", () => {
  beforeEach(() => {
    vi.doUnmock("../../src/network/mcpConnection.js");
    vi.doUnmock("../../src/payment/schemeRegistry.js");
  });

  it("success: settles, reconciles the budget, returns upstream output unchanged plus a receipt", async () => {
    const { run, budgetStore } = await setup(async () => ({
      content: [{ type: "text", text: "sentiment result" }],
      _meta: { "x402/payment-response": { success: true, transaction: "a".repeat(64), network: "stellar:testnet", payer: "GBUYER" } },
    }));
    const result = await run();
    expect(result.receipt.status).toBe("settled");
    expect(result.receipt.transaction).toBe("a".repeat(64));
    expect(result.content).toEqual([{ type: "text", text: "sentiment result" }]);
    const record = await budgetStore.get(result.receipt.paymentIdentifier);
    expect(record?.status).toBe("settled");
  });

  it("PAYMENT_REJECTED: settlement explicitly reports failure -- budget is released, not held", async () => {
    const { run, budgetStore } = await setup(async () => ({
      content: [],
      _meta: { "x402/payment-response": { success: false, errorReason: "insufficient_funds", transaction: "", network: "stellar:testnet" } },
    }));
    const paymentIdentifier = await captureIdentifier(run);
    expect((await budgetStore.get(paymentIdentifier))?.status).toBe("released");
  });

  it("PAYMENT_REJECTED: seller returns another PaymentRequired instead of a payment-response -- budget released", async () => {
    const { run, budgetStore } = await setup(async () => unpaidResult());
    const paymentIdentifier = await captureIdentifier(run);
    expect((await budgetStore.get(paymentIdentifier))?.status).toBe("released");
  });

  it("SETTLEMENT_UNKNOWN: the paid request itself throws (lost response) -- budget stays held, no double payment is attempted", async () => {
    const { run, budgetStore } = await setup(async () => { throw new Error("socket hang up"); });
    const paymentIdentifier = await captureIdentifier(run);
    // Ambiguous, not failed: the reservation is held, not released, and this
    // function never called the tool a second time to "make sure".
    expect((await budgetStore.get(paymentIdentifier))?.status).toBe("unknown");
  });

  it("SETTLEMENT_UNKNOWN: payer/network mismatch on an otherwise-successful response -- budget stays held", async () => {
    const { run, budgetStore } = await setup(async () => ({
      content: [{ type: "text", text: "result" }],
      _meta: { "x402/payment-response": { success: true, transaction: "b".repeat(64), network: "stellar:testnet", payer: "GSOMEONE-ELSE" } },
    }));
    const paymentIdentifier = await captureIdentifier(run);
    expect((await budgetStore.get(paymentIdentifier))?.status).toBe("unknown");
  });

  it("distinct codes: PAYMENT_REJECTED and SETTLEMENT_UNKNOWN are never confused for one another", async () => {
    const rejected = await setup(async () => ({ content: [], _meta: { "x402/payment-response": { success: false, transaction: "", network: "stellar:testnet" } } }));
    const unknown = await setup(async () => { throw new Error("timeout"); });
    await expect(rejected.run()).rejects.toMatchObject({ code: "PAYMENT_REJECTED" });
    await expect(unknown.run()).rejects.toMatchObject({ code: "SETTLEMENT_UNKNOWN" });
  });

  it("RESOURCE_STALE: an expectedVersionHash mismatch is rejected before any unpaid call is even made", async () => {
    vi.resetModules();
    const callTool = vi.fn();
    vi.doMock("../../src/network/mcpConnection.js", () => ({
      resolveConnectableEndpoint: () => new URL("https://seller.example.com/mcp"),
      connectMcpClient: async () => ({ client: { callTool }, close: vi.fn() }),
    }));
    const { callResource } = await import("../../src/tools/callResource.js");
    const { encodeResourceRef } = await import("../../src/resourceRef.js");
    const { MemoryBudgetStore } = await import("../../src/budget/memoryBudgetStore.js");
    const { SingleRetryGuard } = await import("../../src/payment/paymentIdentifier.js");
    const facilitatorClient = { getResource: async () => CATALOG_RESOURCE } as never;
    const signerProvider = { getSigner: async () => ({ address: "GBUYER", signAuthEntry: async () => ({ signedAuthEntry: "x" }) }) } as never;

    await expect(callResource({
      facilitatorClient, budgetStore: new MemoryBudgetStore(), signerProvider,
      config: { networks: { pubnet: false }, transport: "stdio", httpApiKeys: [], budget: { store: "memory", defaultPerCallMaxAtomic: 1_000_000n, defaultSessionOrDayMaxAtomic: 1_000_000n } } as never,
      retryGuard: new SingleRetryGuard(),
      mcpConnectionConfig: { allowInsecureLocal: false, maxResponseBytes: 1024, timeoutMs: 1000, maxRedirects: 3, resolvedMcpEndpoints: {} },
    }, {
      ref: encodeResourceRef({ type: "mcp", url: "https://api.example.com/mcp", toolName: "sentiment" }),
      expectedVersionHash: "stale-hash-that-will-never-match",
      toolArguments: { text: "hello" },
      network: "stellar:testnet", scheme: "exact", asset: "CASSET", maxAtomicAmount: "10000",
      agentId: "agent-1",
    })).rejects.toMatchObject({ code: "RESOURCE_STALE" });

    expect(callTool).not.toHaveBeenCalled();
    vi.doUnmock("../../src/network/mcpConnection.js");
  });
});

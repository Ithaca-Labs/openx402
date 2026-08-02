import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../config.js";
import type { BudgetStore } from "../budget/budgetStore.js";
import type { SignerProvider } from "../payment/signerProvider.js";
import type { SingleRetryGuard } from "../payment/paymentIdentifier.js";
import type { McpConnectionConfig } from "../network/mcpConnection.js";
import { FacilitatorClient } from "../facilitatorClient.js";
import { searchResources } from "./searchResources.js";
import { getResource } from "./getResource.js";
import { callResource, type CallResourceDeps } from "./callResource.js";
import { toErrorPayload } from "../errors.js";

export interface ToolContext {
  agentId: string;
  sessionId?: string;
}

export interface ToolDeps {
  facilitatorClient: FacilitatorClient;
  budgetStore: BudgetStore;
  signerProvider?: SignerProvider;
  config: AppConfig;
  retryGuard: SingleRetryGuard;
  mcpConnectionConfig: McpConnectionConfig;
}

const filterShape = {
  type: z.enum(["http", "mcp"]).optional(),
  network: z.string().min(1).max(128).optional(),
  scheme: z.string().min(1).max(64).optional(),
  payTo: z.string().min(1).max(128).optional(),
  asset: z.string().min(1).max(128).optional(),
  extensions: z.string().min(1).max(64).optional(),
};

const searchResourcesShape = {
  ...filterShape,
  query: z.string().max(512).optional(),
  limit: z.number().int().positive().max(200).optional(),
  cursor: z.string().optional(),
};

const getResourceShape = {
  ref: z.string().min(1).describe("Stable resource reference returned by x402_search_resources -- never a raw URL."),
  expectedVersionHash: z.string().optional(),
};

const callResourceShape = {
  ref: z.string().min(1),
  expectedVersionHash: z.string().optional(),
  arguments: z.record(z.string(), z.unknown()).default({}),
  network: z.enum(["stellar:testnet", "stellar:pubnet"]),
  scheme: z.enum(["exact", "upto"]),
  asset: z.string().min(1),
  maxAtomicAmount: z.string().regex(/^\d+$/, "maxAtomicAmount must be a non-negative integer decimal string"),
};

function toContent(payload: unknown): { content: Array<{ type: "text"; text: string }>; isError?: boolean; structuredContent?: Record<string, unknown> } {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

function toErrorContent(error: unknown): ReturnType<typeof toContent> {
  return { ...toContent(toErrorPayload(error)), isError: true };
}

/**
 * Registers the discovery tools and, only when a signer is configured, the
 * payment tool. `context` (agent identity, budget
 * scope) is fixed once per connection at registration time -- it is never
 * read from tool arguments, so an agent cannot self-report a different
 * identity to evade its own budget.
 */
export function registerTools(server: McpServer, deps: ToolDeps, context: ToolContext): void {
  server.tool(
    "x402_search_resources",
    "Search the Stellar Bazaar catalog (HTTP and MCP resources) with canonical filters. Returns the untouched canonical Bazaar resources plus a stable reference, version hash, provenance, status and warnings for each.",
    searchResourcesShape,
    async args => {
      try {
        const result = await searchResources(deps.facilitatorClient, args);
        return toContent(result);
      } catch (error) {
        return toErrorContent(error);
      }
    },
  );

  server.tool(
    "x402_get_resource",
    "Fetch the current canonical resource, payment options and provenance for a stable resource reference (never an arbitrary URL).",
    getResourceShape,
    async args => {
      try {
        const result = await getResource(deps.facilitatorClient, args);
        return toContent(result);
      } catch (error) {
        return toErrorContent(error);
      }
    },
  );

  if (!deps.signerProvider) return;

  server.tool(
    "x402_call_resource",
    "Discover, challenge, check, pay and retry a cataloged paid MCP tool under a hard budget cap. Returns the upstream tool output unchanged plus a structured payment receipt.",
    callResourceShape,
    async args => {
      try {
        const callDeps: CallResourceDeps = {
          facilitatorClient: deps.facilitatorClient,
          budgetStore: deps.budgetStore,
          config: deps.config,
          retryGuard: deps.retryGuard,
          mcpConnectionConfig: deps.mcpConnectionConfig,
          ...(deps.signerProvider ? { signerProvider: deps.signerProvider } : {}),
        };
        const result = await callResource(callDeps, {
          ref: args.ref,
          ...(args.expectedVersionHash !== undefined ? { expectedVersionHash: args.expectedVersionHash } : {}),
          toolArguments: args.arguments,
          network: args.network,
          scheme: args.scheme,
          asset: args.asset,
          maxAtomicAmount: args.maxAtomicAmount,
          agentId: context.agentId,
          ...(context.sessionId !== undefined ? { sessionId: context.sessionId } : {}),
        });
        return toContent(result);
      } catch (error) {
        return toErrorContent(error);
      }
    },
  );
}

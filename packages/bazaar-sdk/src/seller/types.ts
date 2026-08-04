import type { RouteConfig } from "@x402/core/server";
import type { Network, PaymentRequirements } from "@x402/core/types";
import type { DiscoveryExtension } from "@x402/extensions/bazaar";
import type {
  CompiledInputSchema, HttpMethod, OutputConfig, ParameterMap, ServiceMetadataConfig,
} from "../types.js";

export type { CompiledInputSchema } from "../types.js";
export { isCompiledInputSchema } from "../types.js";

/** Server-wide defaults, inherited by every route unless a route overrides them. */
export interface SellerDefaults {
  /** Payment scheme family, e.g. `"exact"` or `"upto"`. Defaults to `"exact"`. */
  scheme?: string;
  maxTimeoutSeconds?: number;
  /** Compiles to `accepts[].extra.areFeesSponsored`. */
  feesSponsored?: boolean;
  mimeType?: string;
}

export interface X402SellerConfig {
  /** Absolute origin routes are published under, e.g. from `resolveSellerPublicUrl()`. */
  publicUrl: string;
  /** Default network for routes that don't override it, e.g. `"stellar:testnet"`. */
  network?: Network;
  /** Default payment recipient for routes that don't override it. */
  payTo?: string;
  /** Readable asset aliases, e.g. `{ XLM: stellarAssets.testnet.XLM }`. */
  assets?: Record<string, string>;
  defaults?: SellerDefaults;
}

export interface PaymentInput {
  /** Must be a key of `X402SellerConfig.assets`. Raw asset addresses are not accepted here. */
  asset: string;
  /** Atomic-unit amount. A numeric string or bigint, never a JavaScript float. */
  amount: string | bigint;
  network?: Network;
  payTo?: string;
  scheme?: string;
  maxTimeoutSeconds?: number;
  feesSponsored?: boolean;
  /** Merged into `accepts[].extra` after `areFeesSponsored`. */
  extra?: Record<string, unknown>;
}

/** Discovery metadata for one HTTP route. Mirrors `HttpMetadataConfig` minus `method`. */
export interface RouteDiscoveryConfig extends Omit<ServiceMetadataConfig, "serviceName"> {
  /** Readable alias for `serviceName`. */
  name?: string;
  query?: ParameterMap | CompiledInputSchema;
  path?: ParameterMap;
  body?: ParameterMap | CompiledInputSchema;
  bodyType?: "json" | "form-data" | "text";
  headers?: ParameterMap;
  output?: OutputConfig;
}

export interface SellerRouteConfig {
  payment: PaymentInput;
  discovery: RouteDiscoveryConfig;
}

export interface SellerHttpRoute {
  method: HttpMethod;
  path: string;
  /** `"METHOD /path"`, the exact key `paymentMiddleware`'s `RoutesConfig` expects. */
  routeKey: string;
  resourceUrl: string;
  /** `{ [routeKey]: RouteConfig }`, ready to spread into `paymentMiddleware`. Deliberately
   *  keyed rather than a bare `RouteConfig`, so it never falls back to the `"*"` wildcard
   *  route match and accidentally payment-gates the whole app. */
  paymentConfig: Record<string, RouteConfig>;
  resource: ServiceMetadataConfig;
  extensions: { bazaar: DiscoveryExtension };
  compile(): { resource: ServiceMetadataConfig; extensions: { bazaar: DiscoveryExtension } };
}

export interface McpToolDiscoveryConfig extends Omit<ServiceMetadataConfig, "serviceName"> {
  name?: string;
  description?: string;
  transport?: "streamable-http" | "sse";
  /** The tool's existing MCP `inputSchema`, reused unchanged. */
  inputSchema: Record<string, unknown>;
  example?: Record<string, unknown>;
  output?: OutputConfig;
}

export interface SellerToolConfig {
  /** The shared MCP endpoint path this tool is multiplexed behind, e.g. `"/mcp"`. */
  path: string;
  payment: PaymentInput;
  discovery: McpToolDiscoveryConfig;
}

export interface SellerMcpTool {
  toolName: string;
  path: string;
  resourceUrl: string;
  /** Fully resolved payment requirements for this tool's single accepted option. */
  paymentOption: PaymentRequirements;
  resource: ServiceMetadataConfig;
  extensions: { bazaar: DiscoveryExtension };
  compile(): { resource: ServiceMetadataConfig; extensions: { bazaar: DiscoveryExtension } };
}

export interface X402Seller {
  config: X402SellerConfig;
  get(path: string, config: SellerRouteConfig): SellerHttpRoute;
  post(path: string, config: SellerRouteConfig): SellerHttpRoute;
  put(path: string, config: SellerRouteConfig): SellerHttpRoute;
  patch(path: string, config: SellerRouteConfig): SellerHttpRoute;
  delete(path: string, config: SellerRouteConfig): SellerHttpRoute;
  head(path: string, config: SellerRouteConfig): SellerHttpRoute;
  tool(toolName: string, config: SellerToolConfig): SellerMcpTool;
}

/**
 * Seller-facing Bazaar metadata SDK.
 *
 * `bazaar.http` and `bazaar.mcp` compile readable configuration into the
 * official x402 Bazaar wire format by delegating to `@x402/extensions/bazaar`.
 * No proprietary field is ever emitted and no new wire format is invented.
 */
import { http } from "./http.js";
import { mcp } from "./mcp.js";

export const bazaar = { http, mcp };
export { http, mcp };
export { BazaarConfigError } from "./validate.js";
export type {
  BazaarMetadata,
  BodyMethod,
  CompiledInputSchema,
  HttpMetadataConfig,
  HttpMethod,
  McpMetadataConfig,
  OutputConfig,
  ParameterConfig,
  ParameterMap,
  ParameterType,
  QueryMethod,
  ServiceMetadataConfig,
} from "./types.js";
export { isCompiledInputSchema } from "./types.js";

export { createX402Seller, resolveSellerPublicUrl, SellerConfigError } from "./seller/index.js";
export type {
  McpToolDiscoveryConfig,
  PaymentInput,
  ResolveSellerPublicUrlOptions,
  RouteDiscoveryConfig,
  SellerDefaults,
  SellerHttpRoute,
  SellerMcpTool,
  SellerRouteConfig,
  SellerToolConfig,
  X402Seller,
  X402SellerConfig,
} from "./seller/index.js";

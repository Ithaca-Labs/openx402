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

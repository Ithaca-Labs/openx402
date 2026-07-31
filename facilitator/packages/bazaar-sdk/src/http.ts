import { declareDiscoveryExtension, type DiscoveryExtension } from "@x402/extensions/bazaar";
import type { BazaarMetadata, HttpMetadataConfig } from "./types.js";
import { applyHeaders, applyOutput, parametersToExample, parametersToSchema, serviceMetadata } from "./compile.js";
import { validateHttpConfig } from "./validate.js";

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

/**
 * Declares an HTTP endpoint for the Bazaar catalog.
 *
 * The readable configuration is compiled into the official
 * `declareDiscoveryExtension` config and handed to the official builder, so the
 * emitted `extensions.bazaar` object is produced by upstream code rather than
 * re-implemented here.
 *
 * @example
 * ```ts
 * const weather = bazaar.http({
 *   description: "Returns the current weather for a city.",
 *   serviceName: "Weather API",
 *   tags: ["weather", "forecast"],
 *   method: "GET",
 *   query: {
 *     city: { type: "string", description: "City to look up.", required: true, example: "Mumbai" },
 *   },
 *   output: { type: "json", example: { city: "Mumbai", temperature: 29 } },
 * });
 * ```
 */
export function http(config: HttpMetadataConfig): BazaarMetadata {
  validateHttpConfig(config);
  const isBody = BODY_METHODS.has(config.method) && config.body !== undefined;

  const parameters = isBody ? config.body : config.query;
  const inputSchema = parametersToSchema(parameters);
  const input = parametersToExample(parameters);
  const pathSchema = parametersToSchema(config.path);
  const pathExample = parametersToExample(config.path);

  const declared = declareDiscoveryExtension({
    method: config.method,
    ...(input !== undefined ? { input } : {}),
    ...(inputSchema !== undefined ? { inputSchema } : {}),
    ...(pathExample !== undefined ? { pathParams: pathExample } : {}),
    ...(pathSchema !== undefined ? { pathParamsSchema: pathSchema } : {}),
    ...(isBody ? { bodyType: config.bodyType ?? "json" } : {}),
    ...(config.output
      ? {
          output: {
            ...(config.output.example !== undefined ? { example: config.output.example } : {}),
            ...(config.output.schema !== undefined ? { schema: config.output.schema } : {}),
          },
        }
      : {}),
  } as Parameters<typeof declareDiscoveryExtension>[0]);

  let extension = declared.bazaar as DiscoveryExtension;
  extension = applyOutput(extension, config.output);
  const headers = parametersToExample(config.headers);
  if (headers !== undefined) extension = applyHeaders(extension, headers);

  const resource = serviceMetadata(config);
  const extensions = { bazaar: extension };
  return { resource, extensions, compile: () => ({ resource, extensions }) };
}

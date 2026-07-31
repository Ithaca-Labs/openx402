import type { DiscoveryExtension } from "@x402/extensions/bazaar";
import type { OutputConfig, ParameterMap, ServiceMetadataConfig } from "./types.js";

/** Compiles a readable parameter map into a JSON Schema fragment. */
export function parametersToSchema(
  map: ParameterMap | undefined,
): { properties: Record<string, unknown>; required?: string[] } | undefined {
  if (map === undefined) return undefined;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, parameter] of Object.entries(map)) {
    const nested = parameter.properties ? parametersToSchema(parameter.properties) : undefined;
    properties[name] = {
      type: parameter.type,
      ...(parameter.description !== undefined ? { description: parameter.description } : {}),
      ...(parameter.enum !== undefined ? { enum: parameter.enum } : {}),
      ...(parameter.format !== undefined ? { format: parameter.format } : {}),
      ...(parameter.items !== undefined ? { items: parameter.items } : {}),
      ...(parameter.default !== undefined ? { default: parameter.default } : {}),
      ...(nested ? nested : {}),
    };
    if (parameter.required === true) required.push(name);
  }
  return required.length > 0 ? { properties, required } : { properties };
}

/** Collects the declared example values a caller can copy verbatim. */
export function parametersToExample(map: ParameterMap | undefined): Record<string, unknown> | undefined {
  if (map === undefined) return undefined;
  const example: Record<string, unknown> = {};
  for (const [name, parameter] of Object.entries(map)) {
    if (parameter.example !== undefined) example[name] = parameter.example;
    else if (parameter.enum?.[0] !== undefined) example[name] = parameter.enum[0];
  }
  return example;
}

export function serviceMetadata(config: ServiceMetadataConfig): ServiceMetadataConfig {
  return {
    ...(config.description !== undefined ? { description: config.description } : {}),
    ...(config.serviceName !== undefined ? { serviceName: config.serviceName } : {}),
    ...(config.tags !== undefined ? { tags: [...config.tags] } : {}),
    ...(config.iconUrl !== undefined ? { iconUrl: config.iconUrl } : {}),
    ...(config.mimeType !== undefined ? { mimeType: config.mimeType } : {}),
  };
}

type Mutable = Record<string, unknown>;

/**
 * Adds `info.input.headers` in the official `QueryDiscoveryInfo` /
 * `BodyDiscoveryInfo` shape, together with the matching schema property.
 *
 * The official builder has no `headers` slot even though the wire type and the
 * specification examples define one, so this is the only field the helper adds
 * after delegating. Both `info` and `schema` are updated together, which keeps
 * the extension valid under the builder's `additionalProperties: false`.
 */
export function applyHeaders(extension: DiscoveryExtension, headers: Record<string, unknown>): DiscoveryExtension {
  const source = extension as unknown as Mutable;
  const info = source.info as Mutable;
  const schema = source.schema as Mutable;
  const schemaProperties = schema.properties as Mutable;
  const inputSchema = schemaProperties.input as Mutable;
  return {
    ...source,
    info: { ...info, input: { ...(info.input as Mutable), headers } },
    schema: {
      ...schema,
      properties: {
        ...schemaProperties,
        input: {
          ...inputSchema,
          properties: {
            ...(inputSchema.properties as Mutable),
            headers: { type: "object", additionalProperties: { type: "string" } },
          },
        },
      },
    },
  } as unknown as DiscoveryExtension;
}

/**
 * Applies the parts of an output declaration the official builder cannot emit
 * on its own: a non-`json` content type, and a human description of the
 * response. Both land in official positions — `info.output.type` and the
 * JSON Schema `description` annotation on the `output` subschema.
 *
 * When the seller declares only `example` (and optionally `schema`), the
 * builder output is already complete and is returned untouched, so it stays
 * byte-identical to the official helpers.
 */
export function applyOutput(extension: DiscoveryExtension, output: OutputConfig | undefined): DiscoveryExtension {
  if (!output) return extension;
  const needsType = output.type !== undefined && output.type !== "json";
  const needsDescription = output.description !== undefined;
  const missingBlock = output.example === undefined && (output.type !== undefined || needsDescription || output.schema !== undefined);
  if (!needsType && !needsDescription && !missingBlock) return extension;

  const source = extension as unknown as Mutable;
  const info = source.info as Mutable;
  const schema = source.schema as Mutable;
  const schemaProperties = schema.properties as Mutable;
  const existingInfoOutput = (info.output as Mutable | undefined) ?? {};
  const existingSchemaOutput = (schemaProperties.output as Mutable | undefined) ?? {
    type: "object",
    properties: {
      type: { type: "string" },
      example: { type: "object", ...(output.schema ?? {}) },
    },
    required: ["type"],
  };
  return {
    ...source,
    info: {
      ...info,
      output: {
        ...existingInfoOutput,
        type: output.type ?? existingInfoOutput.type ?? "json",
        ...(output.example !== undefined ? { example: output.example } : {}),
      },
    },
    schema: {
      ...schema,
      properties: {
        ...schemaProperties,
        output: {
          ...existingSchemaOutput,
          ...(needsDescription ? { description: output.description } : {}),
        },
      },
    },
  } as unknown as DiscoveryExtension;
}

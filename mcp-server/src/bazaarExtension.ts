/** Small readers over the Bazaar `extensions.bazaar` shape (`specs/extensions/bazaar.md`). */

export interface HasBazaarExtension {
  extensions?: Record<string, unknown> | undefined;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function bazaarInput(value: HasBazaarExtension): Record<string, unknown> | undefined {
  const bazaar = value.extensions?.bazaar;
  if (!isPlainObject(bazaar)) return undefined;
  const info = bazaar.info;
  if (!isPlainObject(info)) return undefined;
  const input = info.input;
  return isPlainObject(input) ? input : undefined;
}

export function bazaarSchema(value: HasBazaarExtension): unknown {
  const bazaar = value.extensions?.bazaar;
  return isPlainObject(bazaar) ? bazaar.schema : undefined;
}

export function bazaarToolName(value: HasBazaarExtension): string | undefined {
  const input = bazaarInput(value);
  return typeof input?.toolName === "string" ? input.toolName : undefined;
}

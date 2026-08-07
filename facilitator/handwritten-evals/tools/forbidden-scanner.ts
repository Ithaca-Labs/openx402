/** Normalized complete-token matching for deterministic forbidden-capability signatures. */

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function matchesForbiddenSignature(text: string, signature: string): boolean {
  const textTokens = normalizeSearchText(text).split(" ").filter(Boolean);
  const signatureTokens = normalizeSearchText(signature).split(" ").filter(Boolean);
  if (signatureTokens.length === 0 || signatureTokens.length > textTokens.length) return false;

  const lastStart = textTokens.length - signatureTokens.length;
  for (let start = 0; start <= lastStart; start++) {
    if (signatureTokens.every((token, offset) => textTokens[start + offset] === token)) return true;
  }
  return false;
}

/** Extracts the exact backtick-delimited signatures from one human capability section. */
export function humanScannerSignatures(section: string): string[] {
  const paragraph = section.match(/\*\*Scanner signatures\.\*\*([\s\S]*?)(?:\n\s*\n|$)/)?.[1];
  if (!paragraph) return [];
  return [...paragraph.matchAll(/`([^`]+)`/g)]
    .map(match => match[1]!.replace(/\s+/g, " ").trim());
}

export function assertExactSignatureSync(
  section: string,
  machineSignatures: readonly string[],
  label: string,
): void {
  const human = [...humanScannerSignatures(section)].sort();
  const machine = [...machineSignatures].sort();
  if (new Set(human).size !== human.length) throw new Error(`${label}: duplicate human scanner signature`);
  if (human.join("\n") !== machine.join("\n")) {
    const missing = machine.filter(signature => !human.includes(signature));
    const extra = human.filter(signature => !machine.includes(signature));
    throw new Error(
      `${label}: human/machine scanner signatures differ; `
      + `missing=${missing.join(",") || "none"}; extra=${extra.join(",") || "none"}`,
    );
  }
}

export interface ForbiddenSignatureSet {
  id: string;
  name: string;
  signatures: readonly string[];
}

export interface ForbiddenScannableRecord {
  resource_id: string;
  wire: {
    resource: {
      serviceName?: string;
      description?: string;
      mimeType?: string;
      tags?: readonly string[];
    };
    extensions: { bazaar: unknown };
  };
}

export interface ForbiddenScanHit {
  resourceId: string;
  field: string;
  capabilityId: string;
  capabilityName: string;
  signature: string;
}

function appendSchemaFields(value: unknown, path: string, fields: Array<[string, string]>): void {
  if (typeof value === "string") {
    fields.push([path, value]);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendSchemaFields(item, `${path}[${index}]`, fields));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    // Schema field names can themselves declare a forbidden operation (for
    // example `sign_transaction`), so scan both keys and string values.
    fields.push([`${childPath}#key`, key]);
    appendSchemaFields(child, childPath, fields);
  }
}

/** Searchable prose plus every Bazaar schema key/string value required by BUILD-PLAN §6. */
export function forbiddenSearchFields(record: ForbiddenScannableRecord): Array<[string, string]> {
  const fields: Array<[string, string]> = [];
  const resource = record.wire.resource;
  if (resource.serviceName) fields.push(["serviceName", resource.serviceName]);
  if (resource.description) fields.push(["description", resource.description]);
  if (resource.mimeType) fields.push(["mimeType", resource.mimeType]);
  for (const [index, tag] of (resource.tags ?? []).entries()) fields.push([`tags[${index}]`, tag]);
  appendSchemaFields(record.wire.extensions.bazaar, "extensions.bazaar", fields);
  return fields;
}

export function scanForbiddenRecords(
  records: readonly ForbiddenScannableRecord[],
  capabilities: readonly ForbiddenSignatureSet[],
): ForbiddenScanHit[] {
  const hits: ForbiddenScanHit[] = [];
  for (const record of records) {
    for (const [field, raw] of forbiddenSearchFields(record)) {
      for (const capability of capabilities) {
        for (const signature of capability.signatures) {
          if (matchesForbiddenSignature(raw, signature)) {
            hits.push({
              resourceId: record.resource_id,
              field,
              capabilityId: capability.id,
              capabilityName: capability.name,
              signature,
            });
          }
        }
      }
    }
  }
  return hits;
}

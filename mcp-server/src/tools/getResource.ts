import type { WrappedResource } from "../types.js";
import { FacilitatorClient } from "../facilitatorClient.js";
import { decodeResourceRef, computeVersionHash } from "../resourceRef.js";
import { McpToolError } from "../errors.js";

export interface GetResourceInput {
  ref: string;
  expectedVersionHash?: string | undefined;
}

/**
 * `x402_get_resource`: fetches the current canonical resource by stable
 * reference -- never an arbitrary URL, since `ref` decodes to the exact
 * `(type, url, toolName)` tuple the facilitator's catalog is keyed on, and
 * the facilitator's `/discovery/resource` route resolves it by that
 * identity, not a client-supplied network address. A version mismatch is
 * reported as a non-blocking `stale` status with a warning rather than a
 * hard failure -- this is a read, so it returns current truth and lets the
 * caller (or `x402_call_resource`'s own `RESOURCE_STALE`/`RESOURCE_CHANGED`
 * gate) decide what to do about it.
 */
export async function getResource(client: FacilitatorClient, input: GetResourceInput): Promise<WrappedResource> {
  const identity = decodeResourceRef(input.ref);
  const resource = await client.getResource(identity);
  if (!resource) {
    throw new McpToolError("NO_RESULTS", "no active catalog entry for this resource reference");
  }
  const versionHash = computeVersionHash(resource);
  const stale = input.expectedVersionHash !== undefined && input.expectedVersionHash !== versionHash;
  return {
    resource,
    wrapper: {
      ref: input.ref,
      versionHash,
      provenance: "seller_declared",
      status: stale ? "stale" : "active",
      warnings: stale ? ["expectedVersionHash did not match the current catalog version"] : [],
    },
  };
}

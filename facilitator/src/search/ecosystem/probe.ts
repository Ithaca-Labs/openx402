import { EcosystemResourceSchema, type EcosystemResource } from "./schema.js";

export interface EcosystemProbeResult {
  resource_id: string;
  liveness: "pass" | "fail" | "unknown";
  latency_ms: number;
  checked_at: string;
  failure_reason?: string;
}

export interface EcosystemProbeOptions {
  concurrency?: number;
  timeout_ms?: number;
  fetch_impl?: typeof fetch;
}

async function probeOne(resource: EcosystemResource, options: Required<EcosystemProbeOptions>): Promise<EcosystemProbeResult> {
  const started = performance.now();
  const checkedAt = new Date().toISOString();
  try {
    // HEAD is intentionally used. A GET could invoke a paid operation or have
    // side effects; this probe only measures whether the route is reachable.
    const response = await options.fetch_impl(resource.resource, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeout_ms),
    });
    const latency = Math.max(0, Math.round(performance.now() - started));
    // 402 is a healthy x402 signal: the endpoint is reachable and correctly
    // asking for payment. Auth challenges and redirects also prove reachability.
    const reachable = response.status === 402 || response.status === 401 || response.status === 403
      || (response.status >= 200 && response.status < 400) || response.status === 405;
    return {
      resource_id: resource.resource_id,
      liveness: reachable ? "pass" : "fail",
      latency_ms: latency,
      checked_at: checkedAt,
      ...(reachable ? {} : { failure_reason: `HTTP ${response.status}` }),
    };
  } catch (error) {
    return {
      resource_id: resource.resource_id,
      liveness: "fail",
      latency_ms: Math.max(0, Math.round(performance.now() - started)),
      checked_at: checkedAt,
      failure_reason: error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000),
    };
  }
}

export async function probeEcosystemResources(
  resources: EcosystemResource[],
  options: EcosystemProbeOptions = {},
): Promise<EcosystemProbeResult[]> {
  const resolved: Required<EcosystemProbeOptions> = {
    concurrency: Math.max(1, Math.min(32, options.concurrency ?? 8)),
    timeout_ms: Math.max(100, Math.min(30_000, options.timeout_ms ?? 5_000)),
    fetch_impl: options.fetch_impl ?? fetch,
  };
  const results: EcosystemProbeResult[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < resources.length) {
      const index = cursor;
      cursor += 1;
      results.push(await probeOne(resources[index]!, resolved));
    }
  };
  await Promise.all(Array.from({ length: Math.min(resolved.concurrency, resources.length) }, () => worker()));
  return results.sort((left, right) => left.resource_id.localeCompare(right.resource_id));
}

export function applyEcosystemProbes(resources: EcosystemResource[], probes: EcosystemProbeResult[]): EcosystemResource[] {
  const probeById = new Map(probes.map(value => [value.resource_id, value]));
  return resources.map(resource => {
    const probe = probeById.get(resource.resource_id);
    if (!probe) return resource;
    const status = resource.operational.safety === "fail" ? "unsafe"
      : probe.liveness === "pass" ? "active" : "unreachable";
    return EcosystemResourceSchema.parse({
      ...resource,
      operational: {
        ...resource.operational,
        liveness: probe.liveness,
        invocation: probe.liveness,
        latency_ms: probe.latency_ms,
        checked_at: probe.checked_at,
        ...(probe.failure_reason ? { failure_reason: probe.failure_reason } : {}),
      },
      status,
    });
  });
}

import type { RouteConfig } from "@x402/core/server";
import type { Network, PaymentRequirements } from "@x402/core/types";
import { http } from "../http.js";
import { mcp } from "../mcp.js";
import type { HttpMethod } from "../types.js";
import {
  resolveAsset, SellerConfigError, validateAmount, validateNetwork, validatePath, validatePayTo, validateScheme,
} from "./validate.js";
import type {
  McpToolDiscoveryConfig, PaymentInput, RouteDiscoveryConfig, SellerHttpRoute, SellerMcpTool, X402SellerConfig,
} from "./types.js";

export interface ResolvedPayment {
  scheme: string;
  network: Network;
  payTo: string;
  asset: string;
  amount: string;
  maxTimeoutSeconds?: number;
  extra: Record<string, unknown>;
}

/**
 * Merges seller-level defaults with a route's payment overrides and validates the
 * result. Returns `undefined` (with `issues` populated) rather than throwing, so
 * callers can accumulate additional route-specific issues (e.g. an invalid path)
 * into the same error.
 */
export function resolvePayment(
  seller: X402SellerConfig,
  payment: PaymentInput,
  issues: string[],
): ResolvedPayment | undefined {
  const scheme = payment.scheme ?? seller.defaults?.scheme ?? "exact";
  validateScheme(scheme, issues);

  const network = payment.network ?? seller.network;
  validateNetwork(network, issues);

  const payTo = payment.payTo ?? seller.payTo;
  validatePayTo(payTo, issues);

  const asset = resolveAsset(payment.asset, seller.assets, issues);
  validateAmount(payment.amount, issues);

  if (issues.length > 0) return undefined;

  const feesSponsored = payment.feesSponsored ?? seller.defaults?.feesSponsored;
  const maxTimeoutSeconds = payment.maxTimeoutSeconds ?? seller.defaults?.maxTimeoutSeconds;
  const extra: Record<string, unknown> = {
    ...(feesSponsored !== undefined ? { areFeesSponsored: feesSponsored } : {}),
    ...(payment.extra ?? {}),
  };

  return {
    scheme,
    network: network as Network,
    payTo: payTo as string,
    asset: asset as string,
    amount: typeof payment.amount === "bigint" ? payment.amount.toString() : payment.amount,
    ...(maxTimeoutSeconds !== undefined ? { maxTimeoutSeconds } : {}),
    extra,
  };
}

function buildAccepts(resolved: ResolvedPayment): RouteConfig["accepts"] {
  return {
    scheme: resolved.scheme,
    payTo: resolved.payTo,
    price: { asset: resolved.asset, amount: resolved.amount },
    network: resolved.network,
    ...(resolved.maxTimeoutSeconds !== undefined ? { maxTimeoutSeconds: resolved.maxTimeoutSeconds } : {}),
    ...(Object.keys(resolved.extra).length > 0 ? { extra: resolved.extra } : {}),
  };
}

export function compileHttpRoute(
  seller: X402SellerConfig,
  method: HttpMethod,
  path: string,
  config: { payment: PaymentInput; discovery: RouteDiscoveryConfig },
): SellerHttpRoute {
  const issues: string[] = [];
  validatePath(path, issues);
  const resolved = resolvePayment(seller, config.payment, issues);
  if (issues.length > 0) throw new SellerConfigError(issues);
  const resolvedPayment = resolved!;

  const discovery = config.discovery;
  const mimeType = discovery.mimeType ?? seller.defaults?.mimeType;
  const metadata = http({
    method,
    ...(discovery.description !== undefined ? { description: discovery.description } : {}),
    ...(discovery.name !== undefined ? { serviceName: discovery.name } : {}),
    ...(discovery.tags !== undefined ? { tags: discovery.tags } : {}),
    ...(discovery.iconUrl !== undefined ? { iconUrl: discovery.iconUrl } : {}),
    ...(mimeType !== undefined ? { mimeType } : {}),
    ...(discovery.query !== undefined ? { query: discovery.query } : {}),
    ...(discovery.path !== undefined ? { path: discovery.path } : {}),
    ...(discovery.body !== undefined ? { body: discovery.body } : {}),
    ...(discovery.bodyType !== undefined ? { bodyType: discovery.bodyType } : {}),
    ...(discovery.headers !== undefined ? { headers: discovery.headers } : {}),
    ...(discovery.output !== undefined ? { output: discovery.output } : {}),
  });

  const routeKey = `${method} ${path}`;
  const resourceUrl = `${seller.publicUrl}${path}`;

  const routeConfig: RouteConfig = {
    accepts: buildAccepts(resolvedPayment),
    resource: resourceUrl,
    ...(metadata.resource.description !== undefined ? { description: metadata.resource.description } : {}),
    ...(metadata.resource.serviceName !== undefined ? { serviceName: metadata.resource.serviceName } : {}),
    ...(metadata.resource.tags !== undefined ? { tags: metadata.resource.tags } : {}),
    ...(metadata.resource.iconUrl !== undefined ? { iconUrl: metadata.resource.iconUrl } : {}),
    ...(metadata.resource.mimeType !== undefined ? { mimeType: metadata.resource.mimeType } : {}),
    extensions: metadata.extensions,
  };

  return {
    method,
    path,
    routeKey,
    resourceUrl,
    paymentConfig: { [routeKey]: routeConfig },
    resource: metadata.resource,
    extensions: metadata.extensions,
    compile: () => metadata.compile(),
  };
}

export function compileMcpTool(
  seller: X402SellerConfig,
  toolName: string,
  config: { path: string; payment: PaymentInput; discovery: McpToolDiscoveryConfig },
): SellerMcpTool {
  const issues: string[] = [];
  validatePath(config.path, issues);
  const resolved = resolvePayment(seller, config.payment, issues);
  if (resolved && resolved.maxTimeoutSeconds === undefined) {
    issues.push(
      "maxTimeoutSeconds is required for an MCP tool: set createX402Seller({ defaults: { maxTimeoutSeconds } }) "
      + "or payment.maxTimeoutSeconds",
    );
  }
  if (issues.length > 0) throw new SellerConfigError(issues);
  const resolvedPayment = resolved!;

  const discovery = config.discovery;
  const mimeType = discovery.mimeType ?? seller.defaults?.mimeType;
  const metadata = mcp({
    toolName,
    ...(discovery.description !== undefined ? { description: discovery.description } : {}),
    ...(discovery.transport !== undefined ? { transport: discovery.transport } : {}),
    ...(discovery.name !== undefined ? { serviceName: discovery.name } : {}),
    ...(discovery.tags !== undefined ? { tags: discovery.tags } : {}),
    ...(discovery.iconUrl !== undefined ? { iconUrl: discovery.iconUrl } : {}),
    ...(mimeType !== undefined ? { mimeType } : {}),
    inputSchema: discovery.inputSchema,
    ...(discovery.example !== undefined ? { example: discovery.example } : {}),
    ...(discovery.output !== undefined ? { output: discovery.output } : {}),
  });

  const resourceUrl = `${seller.publicUrl}${config.path}`;
  const paymentOption: PaymentRequirements = {
    scheme: resolvedPayment.scheme,
    network: resolvedPayment.network,
    asset: resolvedPayment.asset,
    amount: resolvedPayment.amount,
    payTo: resolvedPayment.payTo,
    maxTimeoutSeconds: resolvedPayment.maxTimeoutSeconds!,
    extra: resolvedPayment.extra,
  };

  return {
    toolName,
    path: config.path,
    resourceUrl,
    paymentOption,
    resource: metadata.resource,
    extensions: metadata.extensions,
    compile: () => metadata.compile(),
  };
}

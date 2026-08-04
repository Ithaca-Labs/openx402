import { compileHttpRoute, compileMcpTool } from "./compile.js";
import { SellerConfigError, validateNetwork, validatePublicUrl } from "./validate.js";
import type {
  SellerHttpRoute, SellerRouteConfig, SellerToolConfig, X402Seller, X402SellerConfig,
} from "./types.js";

function validateSellerConfig(config: X402SellerConfig): string {
  const issues: string[] = [];
  const publicUrl = validatePublicUrl(config.publicUrl, issues);
  if (config.network !== undefined) validateNetwork(config.network, issues, "network");
  if (config.assets !== undefined) {
    for (const [alias, address] of Object.entries(config.assets)) {
      if (typeof address !== "string" || address.trim().length === 0) {
        issues.push(`assets.${alias} must be a non-empty asset address`);
      }
    }
  }
  if (issues.length > 0) throw new SellerConfigError(issues);
  return publicUrl!;
}

/**
 * Compiles readable seller-level defaults plus per-route configuration into official
 * x402 route configuration and Bazaar discovery metadata. Purely a compiler: it never
 * holds keys, signs transactions, submits payments, or talks to a facilitator — that
 * remains the job of the `x402ResourceServer` the seller constructs and wires
 * separately into `paymentMiddleware`.
 */
export function createX402Seller(config: X402SellerConfig): X402Seller {
  const publicUrl = validateSellerConfig(config);
  const seller: X402SellerConfig = { ...config, publicUrl };
  const routeKeys = new Set<string>();
  const toolKeys = new Set<string>();

  function defineRoute(
    method: SellerHttpRoute["method"],
    path: string,
    routeConfig: SellerRouteConfig,
  ): SellerHttpRoute {
    const route = compileHttpRoute(seller, method, path, routeConfig);
    if (routeKeys.has(route.routeKey)) {
      throw new SellerConfigError([`route ${JSON.stringify(route.routeKey)} is already declared on this seller`]);
    }
    routeKeys.add(route.routeKey);
    return route;
  }

  return {
    config: seller,
    get: (path, routeConfig) => defineRoute("GET", path, routeConfig),
    post: (path, routeConfig) => defineRoute("POST", path, routeConfig),
    put: (path, routeConfig) => defineRoute("PUT", path, routeConfig),
    patch: (path, routeConfig) => defineRoute("PATCH", path, routeConfig),
    delete: (path, routeConfig) => defineRoute("DELETE", path, routeConfig),
    head: (path, routeConfig) => defineRoute("HEAD", path, routeConfig),
    tool: (toolName, toolConfig: SellerToolConfig) => {
      const tool = compileMcpTool(seller, toolName, toolConfig);
      const toolKey = `${tool.path}|${toolName}`;
      if (toolKeys.has(toolKey)) {
        throw new SellerConfigError([`tool ${JSON.stringify(toolName)} is already declared at ${JSON.stringify(tool.path)}`]);
      }
      toolKeys.add(toolKey);
      return tool;
    },
  };
}

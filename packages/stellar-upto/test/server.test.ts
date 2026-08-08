import { describe, expect, it } from "vitest";
import { UptoStellarScheme } from "../src/server.js";

describe("UptoStellar server scheme", () => {
  it("preserves explicit SEP-41 asset amounts and sponsorship metadata", async () => {
    const asset = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
    const scheme = new UptoStellarScheme({ assetDecimals: { [asset]: 7 } });
    await expect(scheme.parsePrice({ asset, amount: "1000" }, "stellar:testnet"))
      .resolves.toEqual({ asset, amount: "1000", extra: {} });
    expect(scheme.getAssetDecimals(asset, "stellar:testnet")).toBe(7);
    await expect(scheme.enhancePaymentRequirements({
      scheme: "upto",
      network: "stellar:testnet",
      asset,
      amount: "1000",
      payTo: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      maxTimeoutSeconds: 60,
      extra: {},
    }, {
      x402Version: 2,
      scheme: "upto",
      network: "stellar:testnet",
      extra: { areFeesSponsored: true },
    }, [])).resolves.toMatchObject({ extra: { areFeesSponsored: true } });
  });
});

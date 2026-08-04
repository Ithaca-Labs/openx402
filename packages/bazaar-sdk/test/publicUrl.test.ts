import { describe, expect, it } from "vitest";
import { resolveSellerPublicUrl, SellerConfigError } from "../src/index.js";

describe("resolveSellerPublicUrl", () => {
  it("uses SELLER_PUBLIC_URL when set, normalizing a trailing slash", () => {
    expect(resolveSellerPublicUrl({ env: { SELLER_PUBLIC_URL: "https://api.example.com/" } }))
      .toBe("https://api.example.com");
  });

  it("rejects a non-https SELLER_PUBLIC_URL", () => {
    expect(() => resolveSellerPublicUrl({ env: { SELLER_PUBLIC_URL: "http://api.example.com" } }))
      .toThrow(SellerConfigError);
  });

  it("falls back to https://${RAILWAY_PUBLIC_DOMAIN} with no seller-specific variable required", () => {
    expect(resolveSellerPublicUrl({ env: { RAILWAY_PUBLIC_DOMAIN: "my-app.up.railway.app" } }))
      .toBe("https://my-app.up.railway.app");
  });

  it("normalizes a trailing slash for an explicit local-development origin", () => {
    expect(resolveSellerPublicUrl({ env: {}, localDevelopmentUrl: "http://localhost:4788/" }))
      .toBe("http://localhost:4788");
  });

  it("allows http only through the explicit local-development branch", () => {
    expect(resolveSellerPublicUrl({ env: {}, localDevelopmentUrl: "http://localhost:4788" }))
      .toBe("http://localhost:4788");
  });

  it("prefers SELLER_PUBLIC_URL over RAILWAY_PUBLIC_DOMAIN", () => {
    expect(resolveSellerPublicUrl({
      env: { SELLER_PUBLIC_URL: "https://custom.example.com", RAILWAY_PUBLIC_DOMAIN: "my-app.up.railway.app" },
    })).toBe("https://custom.example.com");
  });

  it("prefers RAILWAY_PUBLIC_DOMAIN over an explicit local-development origin", () => {
    expect(resolveSellerPublicUrl({
      env: { RAILWAY_PUBLIC_DOMAIN: "my-app.up.railway.app" },
      localDevelopmentUrl: "http://localhost:4788",
    })).toBe("https://my-app.up.railway.app");
  });

  it("throws when nothing resolves", () => {
    expect(() => resolveSellerPublicUrl({ env: {} })).toThrow(SellerConfigError);
  });

  it("rejects a non-http(s) protocol", () => {
    expect(() => resolveSellerPublicUrl({ env: { SELLER_PUBLIC_URL: "ftp://api.example.com" } }))
      .toThrow(SellerConfigError);
  });

  it("rejects a blank SELLER_PUBLIC_URL by falling through to the next source", () => {
    expect(resolveSellerPublicUrl({ env: { SELLER_PUBLIC_URL: "  ", RAILWAY_PUBLIC_DOMAIN: "my-app.up.railway.app" } }))
      .toBe("https://my-app.up.railway.app");
  });

});

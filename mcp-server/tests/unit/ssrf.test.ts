import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { isBlockedAddress, safeFetch } from "../../src/network/safeFetch.js";
import { McpToolError } from "../../src/errors.js";

describe("isBlockedAddress", () => {
  it("blocks IPv4 loopback, private, link-local and cloud metadata ranges", () => {
    for (const address of ["127.0.0.1", "127.255.255.255", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "224.0.0.1"]) {
      expect(isBlockedAddress(address)).toBe(true);
    }
  });

  it("blocks IPv4-mapped-IPv6 loopback/private", () => {
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:10.0.0.5")).toBe(true);
  });

  it("blocks IPv6 loopback, unique-local, link-local and multicast", () => {
    for (const address of ["::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1"]) {
      expect(isBlockedAddress(address)).toBe(true);
    }
  });

  it("allows ordinary public addresses", () => {
    for (const address of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"]) {
      expect(isBlockedAddress(address)).toBe(false);
    }
  });
});

describe("safeFetch", () => {
  let server: Server | undefined;
  let port = 0;

  afterEach(async () => {
    await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve());
    server = undefined;
  });

  async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<void> {
    server = createServer(handler);
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    port = (server!.address() as { port: number }).port;
  }

  it("rejects a loopback target by default (SSRF block, not just insecure-scheme)", async () => {
    await listen((_req, res) => res.end("ok"));
    await expect(safeFetch(`http://127.0.0.1:${port}/`)).rejects.toMatchObject({ code: "UNTRUSTED_REDIRECT" });
  });

  it("allows the same loopback target when allowInsecureLocal is set (local dev/test only)", async () => {
    await listen((_req, res) => res.end("ok"));
    const result = await safeFetch(`http://127.0.0.1:${port}/`, {}, {
      allowInsecureLocal: true, maxResponseBytes: 1024, timeoutMs: 2000, maxRedirects: 3,
    });
    expect(result.status).toBe(200);
    expect(result.text).toBe("ok");
  });

  it("rejects a cross-origin redirect", async () => {
    await listen((_req, res) => {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
    });
    await expect(safeFetch(`http://127.0.0.1:${port}/`, {}, {
      allowInsecureLocal: true, maxResponseBytes: 1024, timeoutMs: 2000, maxRedirects: 3,
    })).rejects.toMatchObject({ code: "UNTRUSTED_REDIRECT" });
  });

  it("follows a same-origin redirect", async () => {
    await listen((req, res) => {
      if (req.url === "/start") {
        res.writeHead(302, { location: "/end" });
        res.end();
        return;
      }
      res.end("landed");
    });
    const result = await safeFetch(`http://127.0.0.1:${port}/start`, {}, {
      allowInsecureLocal: true, maxResponseBytes: 1024, timeoutMs: 2000, maxRedirects: 3,
    });
    expect(result.text).toBe("landed");
  });

  it("rejects an oversized response", async () => {
    await listen((_req, res) => res.end("x".repeat(10_000)));
    await expect(safeFetch(`http://127.0.0.1:${port}/`, {}, {
      allowInsecureLocal: true, maxResponseBytes: 100, timeoutMs: 2000, maxRedirects: 3,
    })).rejects.toMatchObject({ code: "UPSTREAM_PROTOCOL_ERROR" });
  });

  it("rejects a timed-out response", async () => {
    await listen((_req, res) => {
      // Never respond -- hold the connection open past the timeout.
      setTimeout(() => res.end("late"), 5_000);
    });
    await expect(safeFetch(`http://127.0.0.1:${port}/`, {}, {
      allowInsecureLocal: true, maxResponseBytes: 1024, timeoutMs: 200, maxRedirects: 3,
    })).rejects.toMatchObject({ code: "UPSTREAM_TIMEOUT" });
  }, 10_000);

  it("rejects a non-HTTPS scheme when allowInsecureLocal is not set, even for a public-looking hostname", async () => {
    await expect(safeFetch("http://example.invalid/")).rejects.toBeInstanceOf(McpToolError);
  });
});

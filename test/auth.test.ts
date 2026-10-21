import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TokenProvider, jwtExpiration } from "../src/auth.js";

function jwt(exp: number) {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ exp })}.sig`;
}

describe("TokenProvider", () => {
  it("exchanges the key once and reuses the cached token while it has more than an hour left", async () => {
    const keysSent: string[] = [];
    const now = 1_000_000;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      keysSent.push((init?.headers as Record<string, string>).Authorization);
      return new Response(jwt(now + 24 * 3600), { status: 200 });
    }) as unknown as typeof fetch;
    const cacheFile = join(mkdtempSync(join(tmpdir(), "gpm-")), "token.json");
    const a = new TokenProvider({ apiKey: "k1", cacheFile, fetchImpl, now: () => now });
    await a.token();
    await a.token();
    // A second provider with the same key reads the disk cache instead of exchanging again.
    const b = new TokenProvider({ apiKey: "k1", cacheFile, fetchImpl, now: () => now });
    await b.token();
    expect(keysSent).toEqual(["ApiKey k1"]);
    // A different key never reuses another key's token.
    const c = new TokenProvider({ apiKey: "k2", cacheFile, fetchImpl, now: () => now });
    await c.token();
    expect(keysSent).toEqual(["ApiKey k1", "ApiKey k2"]);
  });

  it("refreshes when the token is inside the one-hour window", async () => {
    let calls = 0;
    let now = 1_000_000;
    const fetchImpl = (async () => {
      calls++;
      return new Response(jwt(now + 90 * 60), { status: 200 });
    }) as unknown as typeof fetch;
    const cacheFile = join(mkdtempSync(join(tmpdir(), "gpm-")), "token.json");
    const a = new TokenProvider({ apiKey: "k", cacheFile, fetchImpl, now: () => now });
    await a.token();
    now += 45 * 60;
    await a.token();
    expect(calls).toBe(2);
  });

  it("explains a failed exchange", async () => {
    const fetchImpl = (async () => new Response("", { status: 401 })) as unknown as typeof fetch;
    const a = new TokenProvider({ apiKey: "bad", cacheFile: join(mkdtempSync(join(tmpdir(), "gpm-")), "t.json"), fetchImpl });
    await expect(a.token()).rejects.toThrow(/HTTP 401/);
  });

  it("reads exp from a JWT", () => {
    expect(jwtExpiration(jwt(42))).toBe(42);
    expect(() => jwtExpiration("not-a-jwt")).toThrow();
  });
});

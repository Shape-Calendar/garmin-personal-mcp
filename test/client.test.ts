import { describe, expect, it } from "vitest";
import { GarminClient } from "../src/client.js";
import type { TokenProvider } from "../src/auth.js";

function tokens(seq: string[]) {
  let i = 0;
  return { host: "https://example.test", token: async (force?: boolean) => (force ? seq[++i] : seq[i]) } as unknown as TokenProvider;
}

describe("GarminClient", () => {
  it("retries once with a fresh token on 401", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: URL, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>).Authorization;
      seen.push(`${url.pathname}?${url.searchParams} ${auth}`);
      return auth === "Bearer t2" ? Response.json([{ activityId: 1 }]) : new Response("", { status: 401 });
    }) as unknown as typeof fetch;
    const c = new GarminClient(tokens(["t1", "t2"]), fetchImpl);
    const rows = await c.searchActivities({ limit: 5, startDate: "2024-01-01" });
    expect(rows).toEqual([{ activityId: 1 }]);
    expect(seen).toEqual([
      "/activitylist-service/activities/search/activities?start=0&limit=5&startDate=2024-01-01 Bearer t1",
      "/activitylist-service/activities/search/activities?start=0&limit=5&startDate=2024-01-01 Bearer t2",
    ]);
  });

  it("surfaces Garmin's empty-body errors with the status and path", async () => {
    const fetchImpl = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    const c = new GarminClient(tokens(["t"]), fetchImpl);
    await expect(c.getDailySummaries("2020-01-01", "2026-01-01")).rejects.toThrow(/500 on \/usersummary-service\/v2\/dailysummaries/);
  });
});

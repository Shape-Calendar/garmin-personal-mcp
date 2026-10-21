import { describe, expect, it } from "vitest";
import { createFetchHandler } from "../src/http.js";

const rpc = (body: unknown, token = "secret") =>
  new Request("http://x/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

describe("stateless HTTP handler", () => {
  const handler = createFetchHandler({ apiKey: "k", bearerToken: "secret" });

  it("rejects a missing or wrong bearer token", async () => {
    expect((await handler(rpc({}, "nope"))).status).toBe(401);
    expect((await handler(new Request("http://x/mcp", { method: "POST" }))).status).toBe(401);
    expect((await handler(rpc({}, "secret-but-longer"))).status).toBe(401);
  });

  it("answers tools/list without any session, on a cold request", async () => {
    // No initialize first: stateless mode must not require one.
    const res = await handler(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }));
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeNull();
    const json = (await res.json()) as { result: { tools: Array<{ name: string }> } };
    expect(json.result.tools.map((t) => t.name)).toContain("list_activities");
    expect(json.result.tools.length).toBe(25);
  });

  it("404s off-path", async () => {
    expect((await handler(new Request("http://x/other", { method: "POST", headers: { authorization: "Bearer secret" } }))).status).toBe(404);
  });
});

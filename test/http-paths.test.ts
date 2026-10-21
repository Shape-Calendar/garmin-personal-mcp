import { describe, expect, it } from "vitest";
import { createFetchHandler } from "../src/http.js";

describe("handler paths", () => {
  it("answers on every configured path and nowhere else", async () => {
    const handler = createFetchHandler({ apiKey: "k", bearerToken: "s", path: ["/mcp", "/api/mcp"] });
    const call = (path: string) =>
      handler(
        new Request(`http://x${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer s" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
        }),
      );
    expect((await call("/mcp")).status).toBe(200);
    expect((await call("/api/mcp")).status).toBe(200);
    expect((await call("/")).status).toBe(404);
  });
});

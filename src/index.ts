#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "./server.js";
import { createFetchHandler } from "./http.js";

export { createFetchHandler } from "./http.js";
export { createServer } from "./server.js";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (args.includes("--help") || args.includes("-h")) {
  console.log(`garmin-personal-mcp

Usage:
  garmin-personal-mcp                  stdio transport (Claude Desktop, Claude Code, Cursor...)
  garmin-personal-mcp --http [port]    stateless Streamable HTTP on <host>:<port>/mcp (default 3333)

Key (first match wins):
  --api-key-file <path>
  GARMIN_PERSONAL_API_KEY
  GARMIN_PERSONAL_API_KEY_FILE
  ~/.config/garmin/connect-personal-api-key

HTTP mode:
  MCP_BEARER_TOKEN  required; clients send it as "Authorization: Bearer <token>"
  MCP_HOST          bind address; default 127.0.0.1, or 0.0.0.0 when the platform sets PORT

Create a key at https://connect.garmin.com/app/settings/personalApiToken`);
  process.exit(0);
}

/** Bridge Node's http module to the web-standard handler. */
async function serve(handler: (r: Request) => Promise<Response>, req: IncomingMessage, res: ServerResponse) {
  const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const request = new Request(url, {
    method: req.method,
    headers: Object.entries(req.headers).flatMap(([k, v]) => (v === undefined ? [] : Array.isArray(v) ? v.map((x) => [k, x] as [string, string]) : [[k, v] as [string, string]])),
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  const response = await handler(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk);
  }
  res.end();
}

function httpServer(apiKeyFile: string | undefined): Server {
  const bearerToken = process.env.MCP_BEARER_TOKEN;
  const handler = bearerToken
    ? createFetchHandler({ apiKeyFile, bearerToken })
    : async () => new Response("MCP_BEARER_TOKEN is not set. Refusing to serve Garmin data without one.", { status: 503 });
  if (!bearerToken) console.error("MCP_BEARER_TOKEN is not set; every request will answer 503 until it is.");
  return createHttpServer((req, res) => {
    serve(handler, req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
}

// npm's bin shim is a symlink (node_modules/.bin/garmin-personal-mcp), so compare real paths.
const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
// Serverless launchers (Vercel) import this module and take the default export; a
// platform that hands us PORT (Railway, Fly, Render) runs it and expects us to listen.
const onVercel = process.env.VERCEL === "1";
const platform = onVercel || Boolean(process.env.PORT);
const apiKeyFile = flag("--api-key-file");

let exported: Server | undefined;

if (onVercel) {
  exported = httpServer(apiKeyFile);
} else if (invokedDirectly && (args.includes("--http") || platform)) {
  const port = Number(flag("--http") ?? process.env.PORT ?? 3333) || 3333;
  const host = process.env.MCP_HOST ?? (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
  httpServer(apiKeyFile).listen(port, host, () => console.error(`garmin-personal-mcp listening on http://${host}:${port}/mcp`));
} else if (invokedDirectly) {
  try {
    const server = await createServer({ apiKeyFile });
    await server.connect(new StdioServerTransport());
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

export default exported;

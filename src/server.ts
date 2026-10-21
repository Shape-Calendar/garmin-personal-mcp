import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TokenProvider, resolveApiKey } from "./auth.js";
import { GarminClient } from "./client.js";
import { registerTools } from "./tools.js";
import { VERSION } from "./version.js";

export function buildServer(garmin: GarminClient): McpServer {
  const server = new McpServer(
    { name: "garmin-personal-mcp", version: VERSION },
    {
      instructions:
        "Read-only access to one person's Garmin Connect data through Garmin's Personal API. " +
        "Activities go back to the first one ever recorded; page with list_activities. " +
        "Health endpoints are per day or per short date range (limits are stated on each tool). " +
        "All dates are YYYY-MM-DD in the athlete's local calendar.",
    },
  );
  registerTools(server, garmin);
  return server;
}

export async function createServer(opts: { apiKey?: string; apiKeyFile?: string } = {}): Promise<McpServer> {
  const apiKey = await resolveApiKey(opts);
  return buildServer(new GarminClient(new TokenProvider({ apiKey })));
}

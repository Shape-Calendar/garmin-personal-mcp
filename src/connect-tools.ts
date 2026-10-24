import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Garmin, type GarminClient as ConnectClient } from "garminconnect-js";
import { finishGarminConnectLogin, startGarminConnectLogin, withGarminConnect } from "./connect-auth.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
function output(data: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] }; }
function error(err: unknown) { return { isError: true as const, content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }] }; }
async function run(fn: () => Promise<unknown>) { try { return output(await fn()); } catch (err) { return error(err); } }
async function metrics(client: ConnectClient) { return new Garmin(client); }

export function registerConnectMetricsTools(server: McpServer) {
  server.registerTool("garmin_connect_login", {
    description: "Start the separate Garmin Connect sign-in using GARMIN_CONNECT_EMAIL and GARMIN_CONNECT_PASSWORD deployment secrets. Credentials are not accepted as tool arguments. If Garmin requires MFA, follow up with garmin_connect_verify_mfa.",
    inputSchema: {}, annotations: { readOnlyHint: true },
  }, async () => run(() => startGarminConnectLogin()));

  server.registerTool("garmin_connect_verify_mfa", {
    description: "Complete a pending Garmin Connect sign-in using the one-time verification code sent by Garmin.",
    inputSchema: { code: z.string().trim().min(4).max(12) }, annotations: { readOnlyHint: true },
  }, async ({ code }) => run(() => finishGarminConnectLogin(code)));

  server.registerTool("get_vo2_max", {
    description: "Get Garmin Connect VO₂ max / maximum aerobic capacity metrics for running and cycling on a date (YYYY-MM-DD). Uses the separate Garmin Connect session, not the Personal API key.",
    inputSchema: { date: isoDate }, annotations: { readOnlyHint: true },
  }, async ({ date }) => run(() => withGarminConnect(async client => (await metrics(client)).getMaxMetrics(date))));

  server.registerTool("get_cycling_ftp", {
    description: "Get the latest cycling functional threshold power (FTP) from Garmin Connect. Uses the separate Garmin Connect session.",
    inputSchema: {}, annotations: { readOnlyHint: true },
  }, async () => run(() => withGarminConnect(async client => (await metrics(client)).getCyclingFtp())));

  server.registerTool("get_training_status", {
    description: "Get Garmin Connect training status for a date (YYYY-MM-DD). Uses the separate Garmin Connect session.",
    inputSchema: { date: isoDate }, annotations: { readOnlyHint: true },
  }, async ({ date }) => run(() => withGarminConnect(async client => (await metrics(client)).getTrainingStatus(date))));
}

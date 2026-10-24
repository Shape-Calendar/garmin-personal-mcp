import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Garmin } from "garminconnect-js";
import { finishGarminConnectLogin, startGarminConnectLogin, withGarminConnect } from "./connect-auth.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const dateFields = { date: isoDate.optional(), from_date: isoDate.optional(), to_date: isoDate.optional() };
const MAX_RANGE_DAYS = 366;

function output(data: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] }; }
function error(err: unknown) { return { isError: true as const, content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }] }; }
async function run(fn: () => Promise<unknown>) { try { return output(await fn()); } catch (err) { return error(err); } }
function dateString(d: Date) { return d.toISOString().slice(0, 10); }
function today() { return dateString(new Date()); }
function isRealDate(value: string) { const d = new Date(value + "T00:00:00Z"); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value; }
function shiftDate(value: string, days: number) { const d = new Date(value + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return dateString(d); }

function validateQuery(args: { date?: string; from_date?: string; to_date?: string }) {
  const { date, from_date, to_date } = args;
  if (date && (from_date || to_date)) throw new Error("Use either date or from_date/to_date, not both.");
  if (date) {
    if (!isRealDate(date)) throw new Error("date must be a real calendar date in YYYY-MM-DD format.");
    return { kind: "date" as const, date };
  }
  if (from_date || to_date) {
    if (!from_date || !to_date) throw new Error("Provide both from_date and to_date for a range.");
    if (!isRealDate(from_date) || !isRealDate(to_date)) throw new Error("from_date and to_date must be real calendar dates in YYYY-MM-DD format.");
    if (from_date > to_date) throw new Error("from_date must be on or before to_date.");
    const days = Math.round((Date.parse(to_date + "T00:00:00Z") - Date.parse(from_date + "T00:00:00Z")) / 86400000) + 1;
    if (days > MAX_RANGE_DAYS) throw new Error(`Date range is ${days} days; maximum is ${MAX_RANGE_DAYS} days per call.`);
    return { kind: "range" as const, from: from_date, to: to_date };
  }
  return { kind: "latest" as const };
}

async function latestVo2(garmin: Garmin) {
  const to = today(), from = shiftDate(to, -89);
  return { mode: "latest", searched_from: from, searched_to: to, data: await garmin.getMaxMetricsRange(from, to) };
}
async function latestFtp(garmin: Garmin) { return { mode: "latest", data: await garmin.getCyclingFtp() }; }
async function latestTrainingStatus(garmin: Garmin) {
  const to = today();
  for (let offset = 0; offset < 30; offset++) {
    const date = shiftDate(to, -offset);
    const data = await garmin.getTrainingStatus(date);
    if (data != null) return { mode: "latest", date, data };
  }
  return { mode: "latest", searched_from: shiftDate(to, -29), searched_to: to, data: null };
}

export function registerConnectMetricsTools(server: McpServer) {
  server.registerTool("garmin_connect_login", {
    description: "Start Garmin Connect sign-in using GARMIN_CONNECT_EMAIL and GARMIN_CONNECT_PASSWORD deployment secrets. Tokens and MFA state are not persisted and are cleared when the runtime restarts.",
    inputSchema: {}, annotations: { readOnlyHint: true },
  }, async () => run(() => startGarminConnectLogin()));

  server.registerTool("garmin_connect_verify_mfa", {
    description: "Complete a pending Garmin Connect sign-in with the one-time code. Pending MFA state is memory-only and may be lost on a serverless restart.",
    inputSchema: { code: z.string().trim().min(4).max(12) }, annotations: { readOnlyHint: true },
  }, async ({ code }) => run(() => finishGarminConnectLogin(code)));

  server.registerTool("get_vo2_max", {
    description: "Get latest available running/cycling VO₂ max, one date, or history for an inclusive date range. Dates are YYYY-MM-DD. Latest searches the most recent 90 days.",
    inputSchema: dateFields, annotations: { readOnlyHint: true },
  }, async args => run(() => withGarminConnect(async client => {
    const garmin = new Garmin(client), query = validateQuery(args);
    if (query.kind === "date") return { mode: "date", date: query.date, data: await garmin.getMaxMetrics(query.date) };
    if (query.kind === "range") return { mode: "range", from_date: query.from, to_date: query.to, data: await garmin.getMaxMetricsRange(query.from, query.to) };
    return latestVo2(garmin);
  })));

  server.registerTool("get_cycling_ftp", {
    description: "Get latest cycling FTP, a specific date, or FTP history for an inclusive date range. Dates are YYYY-MM-DD. Range history is daily and cycling-specific.",
    inputSchema: dateFields, annotations: { readOnlyHint: true },
  }, async args => run(() => withGarminConnect(async client => {
    const garmin = new Garmin(client), query = validateQuery(args);
    if (query.kind === "latest") return latestFtp(garmin);
    if (query.kind === "date") return { mode: "date", date: query.date, data: await garmin.getFunctionalThresholdPowerRange(query.date, query.date, "CYCLING", "daily") };
    return { mode: "range", from_date: query.from, to_date: query.to, data: await garmin.getFunctionalThresholdPowerRange(query.from, query.to, "CYCLING", "daily") };
  })));

  server.registerTool("get_training_status", {
    description: "Get latest available training status, a specific date, or daily status records for an inclusive date range. Dates are YYYY-MM-DD. Latest searches backwards up to 30 days; range requests are capped at 366 days.",
    inputSchema: dateFields, annotations: { readOnlyHint: true },
  }, async args => run(() => withGarminConnect(async client => {
    const garmin = new Garmin(client), query = validateQuery(args);
    if (query.kind === "latest") return latestTrainingStatus(garmin);
    if (query.kind === "date") return { mode: "date", date: query.date, data: await garmin.getTrainingStatus(query.date) };
    const records: Array<{ date: string; data: unknown }> = [];
    for (let day = query.from; day <= query.to; day = shiftDate(day, 1)) records.push({ date: day, data: await garmin.getTrainingStatus(day) });
    return { mode: "range", from_date: query.from, to_date: query.to, records };
  })));
}

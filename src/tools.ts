import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GarminApiError, type GarminClient } from "./client.js";
import { compactActivity, MAX_PAGE } from "./activities.js";
import { extractFit, summarizeFit } from "./fit.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

/** Date-range limits observed on Oct 21 2026; Garmin answers 400 above them with no message. */
const LIMITS = {
  dailySummaries: 180,
  hrvSummaries: 180,
  sleepSummaries: 28,
  bodyBattery: 28,
  stress: 7,
  steps: 7,
  hydration: 28,
  weight: 365,
};

function text(data: unknown) {
  return { content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 1) }] };
}

function fail(err: unknown) {
  const message =
    err instanceof GarminApiError
      ? err.status === 400 || err.status === 500
        ? `${err.message}. Garmin answers 400/500 with no body when a date range is too long or a page is too big; try a shorter range.`
        : err.status === 404
          ? `${err.message}. Only the paths on the Personal API allowlist answer; this one is not on it.`
          : err.message
      : err instanceof Error
        ? err.message
        : String(err);
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}

async function run(fn: () => Promise<unknown>) {
  try {
    return text(await fn());
  } catch (err) {
    return fail(err);
  }
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

function rangeTool(
  server: McpServer,
  name: string,
  description: string,
  maxDays: number,
  fn: (startDate: string, endDate: string) => Promise<unknown>,
) {
  server.registerTool(
    name,
    {
      description: `${description} Inclusive date range; Garmin accepts up to ${maxDays} days per call.`,
      inputSchema: { startDate: isoDate, endDate: isoDate },
      annotations: { readOnlyHint: true },
    },
    async ({ startDate, endDate }) => {
      const span = daysBetween(startDate, endDate);
      if (span < 0) return fail(new Error("endDate is before startDate"));
      if (span > maxDays) return fail(new Error(`Range is ${span} days; Garmin accepts up to ${maxDays} days per call for this endpoint. Split the range.`));
      return run(() => fn(startDate, endDate));
    },
  );
}

function dateTool(server: McpServer, name: string, description: string, fn: (date: string) => Promise<unknown>) {
  server.registerTool(
    name,
    { description, inputSchema: { date: isoDate }, annotations: { readOnlyHint: true } },
    async ({ date }) => run(() => fn(date)),
  );
}

export function registerTools(server: McpServer, garmin: GarminClient) {
  // Activities
  server.registerTool(
    "list_activities",
    {
      description:
        "List activities, newest first, with a compact summary per activity (distance, duration, HR, power, training effect...). " +
        "Pages of up to 50; use `start` to page back through the whole history. Filter by date range and/or activity type (running, cycling, lap_swimming, strength_training...).",
      inputSchema: {
        start: z.number().int().min(0).default(0).describe("Offset into the list, newest first"),
        limit: z.number().int().min(1).max(MAX_PAGE).default(20),
        startDate: isoDate.optional(),
        endDate: isoDate.optional(),
        activityType: z.string().optional().describe("Garmin activity type key, e.g. running, cycling, lap_swimming"),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      run(async () => {
        const rows = (await garmin.searchActivities(args)) as Array<Record<string, unknown>> | null;
        const items = (rows ?? []).map(compactActivity);
        return { start: args.start, returned: items.length, nextStart: items.length === args.limit ? args.start + items.length : null, activities: items };
      }),
  );

  server.registerTool(
    "get_activity",
    {
      description: "Full details of one activity as Garmin Connect stores them (summary, device, type, location). Use list_activities to find the activityId.",
      inputSchema: { activityId: z.union([z.number().int(), z.string()]) },
      annotations: { readOnlyHint: true },
    },
    async ({ activityId }) => run(() => garmin.getActivity(activityId)),
  );

  server.registerTool(
    "get_activity_workout",
    {
      description: "The structured workout (steps, targets) that was followed during an activity, if any.",
      inputSchema: { activityId: z.union([z.number().int(), z.string()]) },
      annotations: { readOnlyHint: true },
    },
    async ({ activityId }) => run(() => garmin.getActivityWorkouts(activityId)),
  );

  server.registerTool(
    "get_activity_recording",
    {
      description:
        "Download the activity's original FIT file and decode it: session totals, every lap, and a downsampled second-by-second stream " +
        "(heart rate, power, speed, cadence, altitude, position). This is the complete file the device recorded.",
      inputSchema: {
        activityId: z.union([z.number().int(), z.string()]),
        maxSamples: z.number().int().min(10).max(5000).default(300).describe("How many evenly spaced record samples to return"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ activityId, maxSamples }) =>
      run(async () => {
        const zip = await garmin.downloadActivity(activityId);
        const { fileName, bytes } = extractFit(zip);
        return summarizeFit(bytes, fileName, maxSamples);
      }),
  );

  // Daily wellness
  rangeTool(server, "get_daily_summaries", "Daily summaries: steps, floors, intensity minutes, resting/min/max heart rate, stress, body battery, calories, sleep seconds.", LIMITS.dailySummaries, (s, e) => garmin.getDailySummaries(s, e));
  dateTool(server, "get_sleep", "Sleep for one night (the night ending on `date`): stages, score, duration, respiration, SpO2, HRV during sleep.", (d) => garmin.getDailySleep(d));
  rangeTool(server, "get_sleep_summaries", "Sleep summaries per night for a date range.", LIMITS.sleepSummaries, (s, e) => garmin.getDailySleepSummaries(s, e));
  dateTool(server, "get_hrv", "Overnight HRV for one date: readings, weekly average, baseline, status.", (d) => garmin.getDailyHrv(d));
  rangeTool(server, "get_hrv_summaries", "Daily HRV summaries (last night average, weekly average, status) for a date range.", LIMITS.hrvSummaries, (s, e) => garmin.getDailyHrvSummaries(s, e));
  rangeTool(server, "get_body_battery", "Body Battery per day: charged, drained, high and low values.", LIMITS.bodyBattery, (s, e) => garmin.getDailyBodyBattery(s, e));
  rangeTool(server, "get_stress", "Daily stress levels.", LIMITS.stress, (s, e) => garmin.getDailyStress(s, e));
  rangeTool(server, "get_steps", "Daily step counts and goals.", LIMITS.steps, (s, e) => garmin.getDailySteps(s, e));
  rangeTool(server, "get_hydration", "Daily hydration logs.", LIMITS.hydration, (s, e) => garmin.getDailyHydration(s, e));
  dateTool(server, "get_heart_rate", "Heart rate through one day: resting HR plus timestamped readings.", (d) => garmin.getDailyHeartRate(d));
  dateTool(server, "get_spo2", "Pulse oximetry and altitude acclimation for one day.", (d) => garmin.getDailySpo2(d));
  rangeTool(server, "get_wellness_activity_summaries", "Wellness activity summaries (all-day movement) for a date range.", LIMITS.dailySummaries, (s, e) => garmin.getWellnessActivitySummaries(s, e));

  // Body, goals, profile
  rangeTool(server, "get_weight", "Weight and body composition measurements for a date range.", LIMITS.weight, (s, e) => garmin.getWeightMeasurements(s, e));
  rangeTool(server, "get_weight_goals", "Effective weight goals for a date range.", LIMITS.weight, (s, e) => garmin.getEffectiveWeightGoals(s, e));
  dateTool(server, "get_food_logs", "Nutrition food logs for one day.", (d) => garmin.getDailyFoodLogs(d));
  server.registerTool("get_profile", { description: "The Garmin Connect user profile settings (units, locale, display preferences).", annotations: { readOnlyHint: true } }, async () => run(() => garmin.getUserProfileSettings()));
  server.registerTool("get_heart_rate_zones", { description: "Configured heart rate zones per sport, max HR, lactate threshold HR.", annotations: { readOnlyHint: true } }, async () => run(() => garmin.getHeartRateZones()));
  dateTool(server, "get_fitness_age", "Fitness age as of a date, with the inputs Garmin used.", (d) => garmin.getFitnessAge(d));

  // Menstrual cycle
  dateTool(server, "get_menstrual_cycle_summary", "Menstrual cycle summary for a date.", (d) => garmin.getMenstrualCycleSummary(d));
  server.registerTool(
    "get_menstrual_cycle_day",
    { description: "Menstrual cycle day view for a date.", inputSchema: { date: isoDate, todayDate: isoDate.optional() }, annotations: { readOnlyHint: true } },
    async ({ date, todayDate }) => run(() => garmin.getMenstrualCycleDayView(date, todayDate ?? new Date().toISOString().slice(0, 10))),
  );

  // Escape hatch
  server.registerTool(
    "get_raw",
    {
      description:
        "GET any Personal API path that the named tools don't cover, e.g. an endpoint Garmin adds later. Only paths on the Personal API allowlist answer; others return 404.",
      inputSchema: { path: z.string().startsWith("/"), query: z.record(z.string(), z.string()).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ path, query }) => run(() => garmin.get(path, query)),
  );
}

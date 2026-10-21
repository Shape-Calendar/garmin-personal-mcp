/**
 * Thin client over the Garmin Connect Personal API.
 *
 * Paths mirror Garmin's own Python client (github.com/garmin/connect-personal-api-python),
 * which is the only published list of endpoints. All endpoints are read-only.
 */
import type { TokenProvider } from "./auth.js";

export class GarminApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    body: string,
  ) {
    super(`Garmin Personal API ${status} on ${path}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
}

export type Json = unknown;
type Query = Record<string, string | number | boolean | undefined>;

export class GarminClient {
  constructor(
    private readonly tokens: TokenProvider,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async get(path: string, query?: Query): Promise<Json> {
    const res = await this.request(path, query, "application/json");
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as Json;
    } catch {
      return text;
    }
  }

  async getBytes(path: string): Promise<Uint8Array> {
    const res = await this.request(path, undefined, "*/*");
    return new Uint8Array(await res.arrayBuffer());
  }

  private async request(path: string, query: Query | undefined, accept: string, retried = false): Promise<Response> {
    const url = new URL(`${this.tokens.host}${path}`);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const res = await this.fetchImpl(url, {
      headers: { Accept: accept, Authorization: `Bearer ${await this.tokens.token()}` },
    });
    if (res.status === 401 && !retried) {
      // Token revoked or expired early: exchange the key once more.
      await this.tokens.token(true);
      return this.request(path, query, accept, true);
    }
    if (!res.ok) throw new GarminApiError(res.status, path, await res.text().catch(() => ""));
    return res;
  }

  // Activities
  searchActivities(p: { start?: number; limit?: number; startDate?: string; endDate?: string; activityType?: string }) {
    return this.get("/activitylist-service/activities/search/activities", {
      start: p.start ?? 0,
      limit: p.limit ?? 20,
      startDate: p.startDate,
      endDate: p.endDate,
      activityType: p.activityType,
    });
  }
  getActivity(id: number | string) {
    return this.get(`/activity-service/activity/${id}`);
  }
  getActivityWorkouts(id: number | string) {
    return this.get(`/activity-service/activity/${id}/workouts`);
  }
  /** ZIP archive containing `<id>_ACTIVITY.fit`. */
  downloadActivity(id: number | string) {
    return this.getBytes(`/download-service/files/activity/${id}`);
  }

  // Daily wellness
  getDailySummaries(startDate: string, endDate: string) {
    return this.get("/usersummary-service/v2/dailysummaries", { startDate, endDate });
  }
  getDailySleep(date: string) {
    return this.get("/sleep-service/sleep/dailySleep", { date });
  }
  getDailySleepSummaries(startDate: string, endDate: string) {
    return this.get("/sleep-service/sleep/dailySleepSummariesByDate", { startDate, endDate });
  }
  getDailyHrv(date: string) {
    return this.get(`/hrv-service/hrv/${date}`);
  }
  getDailyHrvSummaries(startDate: string, endDate: string) {
    return this.get(`/hrv-service/hrv/daily/${startDate}/${endDate}`);
  }
  getDailyBodyBattery(startDate: string, endDate: string) {
    return this.get("/wellness-service/wellness/bodyBattery/reports/daily", { startDate, endDate });
  }
  getDailyStress(startDate: string, endDate: string) {
    return this.get(`/usersummary-service/stats/stress/daily/${startDate}/${endDate}`);
  }
  getDailySteps(startDate: string, endDate: string) {
    return this.get(`/usersummary-service/stats/steps/daily/${startDate}/${endDate}`);
  }
  getDailyHydration(startDate: string, endDate: string) {
    return this.get(`/usersummary-service/stats/hydration/daily/${startDate}/${endDate}`);
  }
  getDailyHeartRate(date: string) {
    return this.get("/wellness-service/wellness/dailyHeartRate", { date });
  }
  getDailySpo2(date: string) {
    return this.get(`/wellness-service/wellness/daily/spo2acclimation/${date}`);
  }
  getWellnessActivitySummaries(startDate: string, endDate: string) {
    return this.get(`/wellnessactivity-service/activity/summary/range/${startDate}/${endDate}`);
  }

  // Body, goals, profile
  getWeightMeasurements(startDate: string, endDate: string) {
    return this.get(`/weight-service/weight/range/${startDate}/${endDate}`, { includeAll: true });
  }
  getEffectiveWeightGoals(startDate: string, endDate: string) {
    return this.get(`/goal-service/goal/user/effective/weightgoal/${startDate}/${endDate}`);
  }
  getDailyFoodLogs(date: string) {
    return this.get(`/nutrition-service/food/logs/${date}`);
  }
  getUserProfileSettings() {
    return this.get("/userprofile-service/userprofile/settings");
  }
  getHeartRateZones() {
    return this.get("/biometric-service/heartRateZones/v2");
  }
  getFitnessAge(date: string) {
    return this.get(`/fitnessage-service/fitnessage/v2/${date}`);
  }

  // Menstrual cycle
  getMenstrualCycleSummary(date: string) {
    return this.get(`/periodichealth-service/menstrualcycle/summary/${date}`);
  }
  getMenstrualCycleDayView(date: string, todayDate: string) {
    return this.get(`/periodichealth-service/menstrualcycle/dayview/${date}`, { todayDate });
  }
}

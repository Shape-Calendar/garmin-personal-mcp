/**
 * Garmin Connect web API client for metrics not exposed by the Personal API.
 *
 * Uses a separately obtained Garmin Connect OAuth2 access token. This is
 * intentionally independent of the Personal API key/token flow.
 */
export class GarminConnectMetricsClient {
  constructor(
    private readonly getAccessToken: () => string | undefined = () => process.env.GARMIN_CONNECT_OAUTH2_TOKEN,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async get(path: string): Promise<unknown> {
    const token = this.getAccessToken()?.trim();
    if (!token) {
      throw new Error(
        "Garmin Connect metrics are not configured. Set GARMIN_CONNECT_OAUTH2_TOKEN to a valid Garmin Connect OAuth2 access token.",
      );
    }

    const res = await this.fetchImpl(`https://connectapi.garmin.com${path}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `Garmin Connect metrics request failed (HTTP ${res.status}). The OAuth2 token may be expired or lack access; refresh/re-authenticate it and update GARMIN_CONNECT_OAUTH2_TOKEN.`,
        );
      }
      throw new Error(`Garmin Connect metrics request failed (HTTP ${res.status}) on ${path}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }

    return res.json() as Promise<unknown>;
  }

  getVo2Max(date: string) {
    return this.get(`/metrics-service/metrics/maxmet/latest/${encodeURIComponent(date)}`);
  }

  getFtp() {
    return this.get("/biometric-service/biometric/latestFunctionalThresholdPower/CYCLING");
  }

  getTrainingStatus(date: string) {
    return this.get(`/metrics-service/metrics/trainingstatus/${encodeURIComponent(date)}`);
  }
}

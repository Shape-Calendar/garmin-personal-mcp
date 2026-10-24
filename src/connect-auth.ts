import { GarminClient, MemoryTokenStore, type MfaState } from "garminconnect-js";

const client = new GarminClient({ tokenStore: new MemoryTokenStore() });
let pendingMfa: MfaState | null = null;

/** Process-memory only: tokens and MFA state vanish when this runtime instance is recycled. */
export async function startGarminConnectLogin(): Promise<{ status: string; message: string }> {
  const email = process.env.GARMIN_CONNECT_EMAIL?.trim();
  const password = process.env.GARMIN_CONNECT_PASSWORD;
  if (!email || !password) throw new Error("Set GARMIN_CONNECT_EMAIL and GARMIN_CONNECT_PASSWORD as private deployment environment variables.");
  const result = await client.login(email, password);
  if (result.state === "mfa_required") {
    pendingMfa = result.mfaState;
    return { status: "mfa_required", message: "Garmin requires a verification code. Call garmin_connect_verify_mfa. MFA state is memory-only and may be lost if the serverless instance restarts." };
  }
  pendingMfa = null;
  return { status: "authenticated", message: "Garmin Connect login succeeded. Session tokens are held in process memory only." };
}

export async function finishGarminConnectLogin(code: string): Promise<{ status: string; message: string }> {
  if (!pendingMfa) throw new Error("No pending Garmin MFA login in this runtime instance. Call garmin_connect_login again.");
  const state = pendingMfa;
  await client.resumeLogin(state, code);
  pendingMfa = null;
  return { status: "authenticated", message: "Garmin MFA verification succeeded. Session tokens are held in process memory only." };
}

export async function withGarminConnect<T>(fn: (client: GarminClient) => Promise<T>): Promise<T> {
  if (!(await client.loadTokens())) throw new Error("No in-memory Garmin Connect session. Call garmin_connect_login first. Serverless restarts clear the session; no database or persistent token storage is configured.");
  return fn(client);
}

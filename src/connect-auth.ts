import { GarminClient as ConnectClient, type MfaState, type TokenStore, type Tokens } from "garminconnect-js";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const TOKEN_KEY = "garmin-connect:tokens";
const MFA_KEY = "garmin-connect:mfa";

function key(): Buffer {
  const hex = process.env.GARMIN_CONNECT_ENCRYPTION_KEY?.trim();
  if (!hex || !/^[a-fA-F0-9]{64}$/.test(hex)) throw new Error("Set GARMIN_CONNECT_ENCRYPTION_KEY to 32 random bytes encoded as 64 hex characters.");
  return Buffer.from(hex, "hex");
}
function encrypt(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") });
}
function decrypt<T>(value: string): T {
  const x = JSON.parse(value) as { v: number; iv: string; tag: string; data: string };
  if (x.v !== 1) throw new Error("Unsupported encrypted Garmin session format.");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(x.iv, "base64"));
  d.setAuthTag(Buffer.from(x.tag, "base64"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(x.data, "base64")), d.final()]).toString("utf8")) as T;
}
async function command(args: string[]): Promise<unknown> {
  const url = process.env.KV_REST_API_URL?.trim(), token = process.env.KV_REST_API_TOKEN?.trim();
  if (!url || !token) throw new Error("Configure Vercel KV/Upstash with KV_REST_API_URL and KV_REST_API_TOKEN for persistent Garmin sessions.");
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  if (!res.ok) throw new Error(`Garmin session storage failed (HTTP ${res.status}).`);
  const body = await res.json() as { result?: unknown; error?: string };
  if (body.error) throw new Error("Garmin session storage rejected a command.");
  return body.result;
}
async function read<T>(keyName: string): Promise<T | null> {
  const v = await command(["GET", keyName]);
  return typeof v === "string" && v ? decrypt<T>(v) : null;
}
async function write(keyName: string, value: unknown): Promise<void> { await command(["SET", keyName, encrypt(value)]); }

export class GarminConnectKvTokenStore implements TokenStore {
  load(): Promise<Tokens | null> { return read<Tokens>(TOKEN_KEY); }
  save(tokens: Tokens): Promise<void> { return write(TOKEN_KEY, tokens); }
  async clear(): Promise<void> { await command(["DEL", TOKEN_KEY]); }
}
function newClient() { return new ConnectClient({ tokenStore: new GarminConnectKvTokenStore() }); }

/** Credentials are read only from deployment secrets, never accepted as MCP arguments. */
export async function startGarminConnectLogin(): Promise<{ status: string; message: string }> {
  const email = process.env.GARMIN_CONNECT_EMAIL?.trim(), password = process.env.GARMIN_CONNECT_PASSWORD;
  if (!email || !password) throw new Error("Set GARMIN_CONNECT_EMAIL and GARMIN_CONNECT_PASSWORD as private deployment environment variables.");
  const client = newClient();
  const result = await client.login(email, password);
  if (result.state === "mfa_required") {
    await write(MFA_KEY, result.mfaState);
    return { status: "mfa_required", message: "Garmin requires a verification code. Call garmin_connect_verify_mfa with the code sent by Garmin." };
  }
  await command(["DEL", MFA_KEY]);
  return { status: "authenticated", message: "Garmin Connect authentication succeeded; encrypted tokens are stored." };
}
export async function finishGarminConnectLogin(code: string): Promise<{ status: string; message: string }> {
  const state = await read<MfaState>(MFA_KEY);
  if (!state) throw new Error("No pending Garmin MFA login. Call garmin_connect_login first.");
  await newClient().resumeLogin(state, code);
  await command(["DEL", MFA_KEY]);
  return { status: "authenticated", message: "Garmin MFA verification succeeded; encrypted tokens are stored." };
}
export async function withGarminConnect<T>(fn: (client: ConnectClient) => Promise<T>): Promise<T> {
  const client = newClient();
  if (!(await client.loadTokens())) throw new Error("Garmin Connect is not authenticated. Configure GARMIN_CONNECT_EMAIL and GARMIN_CONNECT_PASSWORD, then call garmin_connect_login (and garmin_connect_verify_mfa if prompted).");
  return fn(client);
}

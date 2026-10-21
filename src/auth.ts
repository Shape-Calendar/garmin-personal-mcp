/**
 * Personal API key -> bearer token.
 *
 * Garmin issues a JWT in exchange for the Personal API key. Observed lifetime
 * is 24 hours. The token is cached on disk (mode 0600) and refreshed when less
 * than an hour remains, mirroring Garmin's own Python client so the two can
 * coexist on one machine.
 */
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

export const DEFAULT_BASE_URL = "https://personal.connectapi.garmin.com";
export const TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";
export const DEFAULT_KEY_FILE = join(homedir(), ".config", "garmin", "connect-personal-api-key");
const DEFAULT_CACHE_FILE = join(homedir(), ".config", "garmin-personal-mcp", "bearer-token.json");
const REFRESH_WINDOW_SECONDS = 60 * 60;

export interface AuthOptions {
  apiKey: string;
  baseUrl?: string;
  cacheFile?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface BearerToken {
  accessToken: string;
  /** Seconds since the epoch, from the JWT `exp` claim. */
  expiresAt: number;
}

export async function resolveApiKey(opts: { apiKey?: string; apiKeyFile?: string }): Promise<string> {
  if (opts.apiKey?.trim()) return opts.apiKey.trim();
  const fromEnv = process.env.GARMIN_PERSONAL_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const file = opts.apiKeyFile ?? process.env.GARMIN_PERSONAL_API_KEY_FILE ?? DEFAULT_KEY_FILE;
  try {
    const key = (await readFile(file, "utf8")).trim();
    if (key) return key;
  } catch {
    // fall through
  }
  throw new Error(
    `No Garmin Personal API key. Set GARMIN_PERSONAL_API_KEY, pass --api-key-file, or save the key to ${DEFAULT_KEY_FILE}. ` +
      "Create one at https://connect.garmin.com/app/settings/personalApiToken",
  );
}

export function jwtExpiration(token: string): number {
  const parts = token.split(".");
  if (parts.length < 2) throw new Error("Token endpoint did not return a JWT");
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { exp?: number };
  if (typeof payload.exp !== "number") throw new Error("JWT has no exp claim");
  return payload.exp;
}

export class TokenProvider {
  private readonly baseUrl: string;
  private readonly cacheFile: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly fingerprint: string;
  private inMemory: BearerToken | null = null;

  constructor(private readonly opts: AuthOptions) {
    this.baseUrl = (opts.baseUrl ?? process.env.GARMIN_PERSONAL_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.cacheFile = opts.cacheFile ?? DEFAULT_CACHE_FILE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? (() => Date.now() / 1000);
    // Cached tokens are only reused for the same key and host; the key itself is never written.
    this.fingerprint = createHash("sha256").update(`${this.baseUrl}\0${opts.apiKey}`).digest("hex");
  }

  get host(): string {
    return this.baseUrl;
  }

  async token(forceRefresh = false): Promise<string> {
    if (!forceRefresh) {
      const cached = this.inMemory ?? (await this.readCache());
      if (cached && cached.expiresAt - this.now() > REFRESH_WINDOW_SECONDS) {
        this.inMemory = cached;
        return cached.accessToken;
      }
    }
    const res = await this.fetchImpl(`${this.baseUrl}${TOKEN_PATH}`, {
      method: "POST",
      headers: { Accept: "*/*", Authorization: `ApiKey ${this.opts.apiKey}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Token exchange failed: HTTP ${res.status}${body ? ` ${body.slice(0, 200)}` : ""}. ` +
          "Check that the Personal API key is valid and has not expired.",
      );
    }
    const accessToken = (await res.text()).trim();
    const token = { accessToken, expiresAt: jwtExpiration(accessToken) };
    this.inMemory = token;
    await this.writeCache(token);
    return accessToken;
  }

  private async readCache(): Promise<BearerToken | null> {
    try {
      const raw = JSON.parse(await readFile(this.cacheFile, "utf8")) as {
        fingerprint?: string;
        accessToken?: string;
        expiresAt?: number;
      };
      if (raw.fingerprint !== this.fingerprint || !raw.accessToken || typeof raw.expiresAt !== "number") return null;
      return { accessToken: raw.accessToken, expiresAt: raw.expiresAt };
    } catch {
      return null;
    }
  }

  private async writeCache(token: BearerToken): Promise<void> {
    try {
      await mkdir(dirname(this.cacheFile), { recursive: true, mode: 0o700 });
      await writeFile(this.cacheFile, JSON.stringify({ fingerprint: this.fingerprint, ...token }), { mode: 0o600 });
      await chmod(this.cacheFile, 0o600);
    } catch {
      // A read-only home directory should not stop the server; the token stays in memory.
    }
  }
}

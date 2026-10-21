/**
 * Turn the ZIP the download endpoint returns into something an assistant can read:
 * the session summary, every lap, and a downsampled record stream.
 */
import { unzipSync } from "fflate";
import { Decoder, Stream } from "@garmin/fitsdk";

export interface FitSummary {
  fileName: string;
  session: Record<string, unknown> | null;
  laps: Array<Record<string, unknown>>;
  records: { total: number; returned: number; everyNth: number; fields: string[]; samples: Array<Record<string, unknown>> };
  messageCounts: Record<string, number>;
  decodeErrors: number;
}

const RECORD_FIELDS = [
  "timestamp",
  "elapsedTime",
  "distance",
  "speed",
  "enhancedSpeed",
  "heartRate",
  "cadence",
  "power",
  "altitude",
  "enhancedAltitude",
  "temperature",
  "positionLat",
  "positionLong",
  "grade",
  "respirationRate",
];

const SESSION_DROP = new Set(["timestamp", "messageIndex"]);

export function extractFit(zipBytes: Uint8Array): { fileName: string; bytes: Uint8Array } {
  const entries = unzipSync(zipBytes);
  const fileName = Object.keys(entries).find((n) => n.toLowerCase().endsWith(".fit")) ?? Object.keys(entries)[0];
  if (!fileName) throw new Error("Download contained no files");
  return { fileName, bytes: entries[fileName] };
}

export function summarizeFit(bytes: Uint8Array, fileName: string, maxSamples = 300): FitSummary {
  const stream = Stream.fromByteArray(bytes);
  const decoder = new Decoder(stream);
  const { messages, errors } = decoder.read({
    includeUnknownData: false,
    mergeHeartRates: true,
    expandSubFields: true,
    expandComponents: true,
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
  }) as unknown as { messages: Record<string, Array<Record<string, unknown>>>; errors: unknown[] };

  const messageCounts: Record<string, number> = {};
  for (const [k, v] of Object.entries(messages)) if (Array.isArray(v) && v.length) messageCounts[k.replace(/Mesgs$/, "")] = v.length;

  const session = messages.sessionMesgs?.[0] ? plain(messages.sessionMesgs[0], SESSION_DROP) : null;
  const laps = (messages.lapMesgs ?? []).map((l) => plain(l, SESSION_DROP));
  const all = messages.recordMesgs ?? [];
  const everyNth = Math.max(1, Math.ceil(all.length / maxSamples));
  const first = all[0]?.timestamp instanceof Date ? (all[0].timestamp as Date).getTime() : null;
  const samples: Array<Record<string, unknown>> = [];
  for (let i = 0; i < all.length; i += everyNth) {
    const r = all[i];
    const out: Record<string, unknown> = {};
    for (const f of RECORD_FIELDS) if (r[f] !== undefined) out[f] = r[f] instanceof Date ? (r[f] as Date).toISOString() : r[f];
    if (first !== null && r.timestamp instanceof Date) out.elapsedTime = Math.round(((r.timestamp as Date).getTime() - first) / 1000);
    samples.push(out);
  }
  const fields = Array.from(new Set(samples.flatMap((s) => Object.keys(s))));
  return {
    fileName,
    session,
    laps,
    records: { total: all.length, returned: samples.length, everyNth, fields, samples },
    messageCounts,
    decodeErrors: errors.length,
  };
}

function plain(m: Record<string, unknown>, drop: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m)) {
    if (drop.has(k) || v === undefined || v === null) continue;
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

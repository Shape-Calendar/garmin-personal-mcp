/** Compact the activity search payload: ~100 fields per activity is too much for a context window. */
const KEEP = [
  "activityId",
  "activityName",
  "startTimeLocal",
  "startTimeGMT",
  "distance",
  "duration",
  "movingDuration",
  "elapsedDuration",
  "elevationGain",
  "elevationLoss",
  "averageSpeed",
  "maxSpeed",
  "averageHR",
  "maxHR",
  "avgPower",
  "maxPower",
  "normPower",
  "trainingStressScore",
  "intensityFactor",
  "aerobicTrainingEffect",
  "anaerobicTrainingEffect",
  "activityTrainingLoad",
  "vO2MaxValue",
  "calories",
  "averageRunningCadenceInStepsPerMinute",
  "averageBikingCadenceInRevPerMinute",
  "avgStrideLength",
  "avgVerticalOscillation",
  "avgGroundContactTime",
  "steps",
  "lapCount",
  "deviceId",
  "manufacturer",
  "locationName",
  "hasPolyline",
  "ownerDisplayName",
] as const;

export interface CompactActivity extends Record<string, unknown> {
  activityId: number;
  activityType?: string;
}

export function compactActivity(a: Record<string, unknown>): CompactActivity {
  const out: Record<string, unknown> = {};
  for (const k of KEEP) if (a[k] !== undefined && a[k] !== null) out[k] = a[k];
  const type = a.activityType as { typeKey?: string } | undefined;
  if (type?.typeKey) out.activityType = type.typeKey;
  const event = a.eventType as { typeKey?: string } | undefined;
  if (event?.typeKey && event.typeKey !== "uncategorized") out.eventType = event.typeKey;
  return out as CompactActivity;
}

/** Garmin's search endpoint answers 500 above roughly 60 items per page. */
export const MAX_PAGE = 50;

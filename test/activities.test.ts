import { describe, expect, it } from "vitest";
import { compactActivity } from "../src/activities.js";

describe("compactActivity", () => {
  it("keeps the fields an assistant needs and flattens the type", () => {
    const out = compactActivity({
      activityId: 1,
      activityName: "Morning Run",
      activityType: { typeId: 1, typeKey: "running", parentTypeId: 17 },
      eventType: { typeKey: "uncategorized" },
      distance: 5000,
      averageHR: 140,
      privacy: { typeKey: "private" },
      splitSummaries: [{ a: 1 }],
      calories: null,
    });
    expect(out).toEqual({ activityId: 1, activityName: "Morning Run", distance: 5000, averageHR: 140, activityType: "running" });
  });
});

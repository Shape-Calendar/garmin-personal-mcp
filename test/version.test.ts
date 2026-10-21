import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { VERSION } from "../src/version.js";

it("src/version.ts matches package.json (it is inlined so the server never reads package.json at runtime)", () => {
  expect(VERSION).toBe((JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version);
});

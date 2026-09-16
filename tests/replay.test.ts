/**
 * histCount() in public/holotable.js decides how much of the recorded
 * history gets re-applied when you scrub the timeline. State is cumulative
 * and handle() has no inverse, so an off-by-one here does not throw — it
 * quietly rebuilds the wrong world, one event early or late.
 *
 * Extracted from source the way esc.test.ts does it: holotable.js is a
 * browser IIFE with nothing exported.
 */
import { describe, expect, test } from "bun:test";

type Ev = { t: number };

async function extractHistCount(): Promise<(h: Ev[], t: number) => number> {
  const src = await Bun.file("public/holotable.js").text();
  const start = src.indexOf("function histCount(hist, tMs){");
  if (start < 0) throw new Error("histCount() not found in holotable.js");
  const end = src.indexOf("\n  }", start) + 4;
  const fn = new Function("hist", "tMs",
    src.slice(start, end) + "\nreturn histCount(hist, tMs);");
  return fn as (h: Ev[], t: number) => number;
}

const H: Ev[] = [{ t: 100 }, { t: 200 }, { t: 200 }, { t: 300 }, { t: 400 }];

describe("histCount", () => {
  test("empty history replays nothing", async () => {
    const histCount = await extractHistCount();
    expect(histCount([], 999)).toBe(0);
  });

  test("before the first event replays nothing", async () => {
    const histCount = await extractHistCount();
    expect(histCount(H, 99)).toBe(0);
  });

  test("the boundary is inclusive", async () => {
    const histCount = await extractHistCount();
    // landing exactly on an event must include it, not stop short
    expect(histCount(H, 100)).toBe(1);
    expect(histCount(H, 300)).toBe(4);
  });

  test("duplicate timestamps are all taken", async () => {
    const histCount = await extractHistCount();
    // two events share t=200; a scrub to 200 must not split them
    expect(histCount(H, 200)).toBe(3);
  });

  test("between events takes only what has happened", async () => {
    const histCount = await extractHistCount();
    expect(histCount(H, 250)).toBe(3);
    expect(histCount(H, 399)).toBe(4);
  });

  test("past the end replays everything", async () => {
    const histCount = await extractHistCount();
    expect(histCount(H, 400)).toBe(5);
    expect(histCount(H, 1e15)).toBe(5);
  });

  test("events with no timestamp count as time zero", async () => {
    const histCount = await extractHistCount();
    const messy = [{}, { t: 50 }] as Ev[];
    expect(histCount(messy, 0)).toBe(1);
    expect(histCount(messy, 50)).toBe(2);
  });
});

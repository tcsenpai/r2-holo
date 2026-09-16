/**
 * bucketize() shapes the activity ring. Its span is measured from the
 * events themselves rather than fixed, because measurement on real
 * sessions killed every fixed choice: a 12-hour window came back 3/60
 * slots full, anchoring at the oldest event produced 522-hour spans off a
 * single prelude straggler, and cutting at the largest gap could not tell
 * a coffee break from a session resumed eight days later.
 *
 * None of those failures throw. They just draw an empty ring, which is
 * why they belong in a test.
 */
import { describe, expect, test } from "bun:test";

type Ev = { t: number; error?: boolean };
type Ring = { n: number; err: number }[] & { spanMs: number; from: number; n: number };

async function extractBucketize(): Promise<(h: Ev[], now: number, slots: number, take?: number) => Ring> {
  const src = await Bun.file("public/holotable.js").text();
  const start = src.indexOf("function bucketize(hist, nowMs, slots, take){");
  if (start < 0) throw new Error("bucketize() not found in holotable.js");
  const end = src.indexOf("\n  }", start) + 4;
  const fn = new Function("hist", "nowMs", "slots", "take",
    src.slice(start, end) + "\nreturn bucketize(hist, nowMs, slots, take);");
  return fn as (h: Ev[], now: number, slots: number, take?: number) => Ring;
}

const NOW = 1_700_000_000_000;
const filled = (r: Ring) => r.filter((s) => s.n > 0).length;

describe("bucketize", () => {
  test("no events leaves an empty ring, not a crash", async () => {
    const bucketize = await extractBucketize();
    const r = bucketize([], NOW, 60);
    expect(filled(r)).toBe(0);
    expect(r.spanMs).toBe(0);
  });

  test("a burst over minutes spreads across the ring", async () => {
    const bucketize = await extractBucketize();
    // 60 events over 10 minutes: the shape the wall actually shows
    const evs = Array.from({ length: 60 }, (_, i) => ({ t: NOW - 600_000 + i * 10_000 }));
    const r = bucketize(evs, NOW, 60);
    expect(filled(r)).toBeGreaterThan(30);
    expect(r.spanMs).toBeGreaterThan(500_000);
  });

  test("a slow session over days fills it just the same", async () => {
    const bucketize = await extractBucketize();
    // the scale-independence that fixed windows could not give
    const day = 86_400_000;
    const evs = Array.from({ length: 60 }, (_, i) => ({ t: NOW - 3 * day + i * (day / 20) }));
    const r = bucketize(evs, NOW, 60);
    expect(filled(r)).toBeGreaterThan(30);
    expect(r.spanMs).toBeGreaterThan(2 * day);
  });

  test("one ancient straggler does not flatten the scale", async () => {
    const bucketize = await extractBucketize();
    // the 522-hour failure: a prelude event from a week ago, then a live run
    const week = 7 * 86_400_000;
    const evs: Ev[] = [{ t: NOW - week }];
    for (let i = 0; i < 100; i++) evs.push({ t: NOW - 300_000 + i * 3_000 });
    const r = bucketize(evs, NOW, 60, 100);   // take drops the straggler
    expect(r.spanMs).toBeLessThan(86_400_000);
    expect(filled(r)).toBeGreaterThan(20);
  });

  test("errors are counted alongside activity", async () => {
    const bucketize = await extractBucketize();
    const evs = [
      { t: NOW - 60_000 }, { t: NOW - 50_000, error: true },
      { t: NOW - 40_000 }, { t: NOW - 30_000, error: true },
    ];
    const r = bucketize(evs, NOW, 10);
    expect(r.reduce((a, s) => a + s.err, 0)).toBe(2);
    expect(r.reduce((a, s) => a + s.n, 0)).toBe(4);
  });

  test("future and malformed timestamps are ignored, not binned", async () => {
    const bucketize = await extractBucketize();
    const evs = [{ t: NOW + 60_000 }, { t: 0 }, { t: NOW - 1_000 }] as Ev[];
    const r = bucketize(evs, NOW, 10);
    expect(r.reduce((a, s) => a + s.n, 0)).toBe(1);
  });

  test("every event lands inside the ring", async () => {
    const bucketize = await extractBucketize();
    // an off-by-one at the last slot would silently drop the newest event,
    // which is the one the eye goes to
    const evs = Array.from({ length: 30 }, (_, i) => ({ t: NOW - 30_000 + i * 1_000 }));
    const r = bucketize(evs, NOW, 12);
    expect(r.reduce((a, s) => a + s.n, 0)).toBe(30);
  });
});

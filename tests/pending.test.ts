/**
 * pendStart/pendEnd track in-flight tool calls, and nothing in the repo
 * covered them — which is how `at: Date.now()` survived. During replay
 * the wall clock sits hours from when the call actually ran, so every
 * derived duration collapsed toward zero: a 45s Bash call read as 0.0s.
 * Nothing throws. The display just quietly lies.
 *
 * These also pin the second half of that fix: expiry and elapsed time
 * must be measured against SCENE time, not the wall clock, or replaying
 * an old session ages every open call past PEND_MAX instantly and
 * nothing ever shows as running.
 */
import { describe, expect, test } from "bun:test";

type Ev = { kind: string; id?: string; forId?: string; tool?: string; t?: number };
type Pend = Record<string, { tool?: string; at: number }>;

async function extractPend(): Promise<{
  start: (p: Pend, e: Ev) => void;
  end: (p: Pend, e: Ev) => void;
}> {
  const src = await Bun.file("public/holotable.js").text();
  const grab = (needle: string) => {
    const a = src.indexOf(needle);
    if (a < 0) throw new Error(needle + " not found in holotable.js");
    return src.slice(a, src.indexOf("\n  }", a) + 4);
  };
  const body =
    "var pendSeq = 0;\n" +
    grab("function pendStart(pend, ev){") + "\n" +
    grab("function pendEnd(pend, ev){");
  const fn = new Function(body + "\nreturn { start: pendStart, end: pendEnd };");
  return fn() as { start: (p: Pend, e: Ev) => void; end: (p: Pend, e: Ev) => void };
}

const T0 = 1_700_000_000_000;

describe("pendStart", () => {
  test("stamps the event's own time, not the wall clock", async () => {
    const { start } = await extractPend();
    const pend: Pend = {};
    start(pend, { kind: "tool", id: "a", tool: "Bash", t: T0 });
    expect(pend.a.at).toBe(T0);
  });

  test("a replayed call keeps its real duration", async () => {
    const { start } = await extractPend();
    // the exact regression: a 45s call replayed hours later
    const pend: Pend = {};
    start(pend, { kind: "tool", id: "x", tool: "Bash", t: T0 });
    const resultAt = T0 + 45_000;
    expect(resultAt - pend.x.at).toBe(45_000);
  });

  test("falls back to the wall clock when the event has no time", async () => {
    const { start } = await extractPend();
    const pend: Pend = {};
    const before = Date.now();
    start(pend, { kind: "tool", id: "b", tool: "Read" });
    expect(pend.b.at).toBeGreaterThanOrEqual(before);
  });

  test("calls without an id still get tracked separately", async () => {
    const { start } = await extractPend();
    const pend: Pend = {};
    start(pend, { kind: "tool", tool: "Read", t: T0 });
    start(pend, { kind: "tool", tool: "Grep", t: T0 + 1000 });
    expect(Object.keys(pend).length).toBe(2);
  });
});

describe("pendEnd", () => {
  test("closes the matching call by id", async () => {
    const { start, end } = await extractPend();
    const pend: Pend = {};
    start(pend, { kind: "tool", id: "a", tool: "Bash", t: T0 });
    start(pend, { kind: "tool", id: "b", tool: "Read", t: T0 + 100 });
    end(pend, { kind: "result", forId: "a" });
    expect(pend.a).toBeUndefined();
    expect(pend.b).toBeDefined();
  });

  test("with no id, closes the oldest — which needs correct timestamps", async () => {
    const { start, end } = await extractPend();
    // with Date.now() stamps inside one replay tick every call shared a
    // timestamp, so "oldest" was arbitrary. Event time makes it real.
    const pend: Pend = {};
    start(pend, { kind: "tool", id: "old", tool: "Bash", t: T0 });
    start(pend, { kind: "tool", id: "new", tool: "Read", t: T0 + 60_000 });
    end(pend, { kind: "result" });
    expect(pend.old).toBeUndefined();
    expect(pend.new).toBeDefined();
  });

  test("an unmatched result does not throw", async () => {
    const { end } = await extractPend();
    const pend: Pend = {};
    expect(() => end(pend, { kind: "result", forId: "ghost" })).not.toThrow();
  });
});

describe("scene time", () => {
  test("expiry is measured against the scene, not the wall clock", async () => {
    const src = await Bun.file("public/holotable.js").text();
    // applyPending must not compare an event timestamp to Date.now():
    // replaying a two-hour-old session would age every call past
    // PEND_MAX at once and nothing would ever read as in flight
    const a = src.indexOf("function applyPending(pend, m){");
    expect(a).toBeGreaterThan(-1);
    const body = src.slice(a, src.indexOf("\n  }", a));
    expect(body).toContain("sceneNow()");
    expect(body).not.toContain("Date.now()");
  });

  test("the seconds shown on a callout follow scene time too", async () => {
    const src = await Bun.file("public/holotable.js").text();
    // otherwise a replayed call counts up from the wall clock and shows
    // a number that has nothing to do with what is on screen
    expect(src).toContain("sceneNow() - aFlight.at");
    expect(src).toContain("sceneNow()-inflight.at");
  });
});

/**
 * waitPulse() maps how long a call has been open to how fast its station
 * beats. The constraint is measured, not guessed: 104 real tool calls had
 * a median of 3.3s and a longest of 97s, with only 5 over 30s — so a
 * linear mapping would leave 95% of events looking identical.
 */
async function extractWaitPulse(): Promise<(ms: number) => number> {
  const src = await Bun.file("public/holotable.js").text();
  const c = src.indexOf("var WAIT_FLOOR");
  const a = src.indexOf("function waitPulse(ms){");
  if (c < 0 || a < 0) throw new Error("waitPulse() not found in holotable.js");
  const fn = new Function("ms",
    src.slice(c, src.indexOf("\n", c)) + "\n" +
    src.slice(a, src.indexOf("\n  }", a) + 4) + "\nreturn waitPulse(ms);");
  return fn as (ms: number) => number;
}

describe("waitPulse", () => {
  test("a typical call does not change the beat", async () => {
    const waitPulse = await extractWaitPulse();
    // median measured at 3.3s: the common case must stay unremarkable,
    // or the wall flickers constantly and the signal means nothing
    for (const s of [0.2, 1, 3.3, 4]) expect(waitPulse(s * 1000)).toBe(1);
  });

  test("a long wait slows the beat", async () => {
    const waitPulse = await extractWaitPulse();
    expect(waitPulse(30_000)).toBeLessThan(waitPulse(10_000));
    expect(waitPulse(97_000)).toBeLessThan(waitPulse(30_000));
  });

  test("it is monotonic: longer never beats faster", async () => {
    const waitPulse = await extractWaitPulse();
    let prev = Infinity;
    for (let s = 1; s <= 600; s += 3) {
      const v = waitPulse(s * 1000);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });

  test("it bottoms out rather than stopping", async () => {
    const waitPulse = await extractWaitPulse();
    // a station that stops pulsing entirely reads as broken, not as busy
    for (const s of [300, 3600, 86_400]) {
      expect(waitPulse(s * 1000)).toBeGreaterThan(0.2);
    }
  });

  test("the measured spread is actually distinguishable", async () => {
    const waitPulse = await extractWaitPulse();
    // the whole point: the real tail (30s, 60s, 97s) must not collapse
    // into one another the way a linear mapping would make them
    const a = waitPulse(30_000), b = waitPulse(60_000), c = waitPulse(97_000);
    expect(a - b).toBeGreaterThan(0.05);
    expect(b - c).toBeGreaterThan(0.05);
  });

  test("junk input does not produce a broken beat", async () => {
    const waitPulse = await extractWaitPulse();
    for (const bad of [0, -5000, NaN, undefined as unknown as number]) {
      const v = waitPulse(bad);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });
});

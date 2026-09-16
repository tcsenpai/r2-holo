/**
 * activeIn() in public/holotable.js picks which sessions the wall display
 * cycles through. Its window is the difference between a screen showing
 * live work and one flicking through sessions that died hours ago —
 * and either way it throws nothing, so only a test catches it.
 */
import { describe, expect, test } from "bun:test";

type S = { path: string; mtime: number };

async function extractActiveIn(): Promise<(l: S[], now: number, w: number) => S[]> {
  const src = await Bun.file("public/holotable.js").text();
  const start = src.indexOf("function activeIn(list, nowMs, windowMs){");
  if (start < 0) throw new Error("activeIn() not found in holotable.js");
  const end = src.indexOf("\n  }", start) + 4;
  const fn = new Function("list", "nowMs", "windowMs",
    src.slice(start, end) + "\nreturn activeIn(list, nowMs, windowMs);");
  return fn as (l: S[], now: number, w: number) => S[];
}

const NOW = 1_700_000_000_000;
const MIN = 60_000;

describe("activeIn", () => {
  test("keeps what moved inside the window", async () => {
    const activeIn = await extractActiveIn();
    const list = [
      { path: "a", mtime: NOW - 1_000 },      // a second ago
      { path: "b", mtime: NOW - 59_000 },     // just inside
    ];
    expect(activeIn(list, NOW, MIN).map((s) => s.path)).toEqual(["a", "b"]);
  });

  test("drops what has gone quiet", async () => {
    const activeIn = await extractActiveIn();
    const list = [
      { path: "live", mtime: NOW - 5_000 },
      { path: "stale", mtime: NOW - 10 * MIN },
      { path: "ancient", mtime: NOW - 86_400_000 },
    ];
    expect(activeIn(list, NOW, MIN).map((s) => s.path)).toEqual(["live"]);
  });

  test("the edge is exclusive", async () => {
    const activeIn = await extractActiveIn();
    // exactly one window old is out: otherwise a session flickers in and
    // out of the rotation on every poll
    expect(activeIn([{ path: "x", mtime: NOW - MIN }], NOW, MIN)).toEqual([]);
    expect(activeIn([{ path: "x", mtime: NOW - MIN + 1 }], NOW, MIN).length).toBe(1);
  });

  test("an empty or all-quiet list rotates nothing", async () => {
    const activeIn = await extractActiveIn();
    expect(activeIn([], NOW, MIN)).toEqual([]);
    expect(activeIn([{ path: "old", mtime: 0 }], NOW, MIN)).toEqual([]);
  });

  test("a missing mtime counts as quiet, not as now", async () => {
    const activeIn = await extractActiveIn();
    // treating undefined as 0 keeps a malformed row out of the rotation;
    // treating it as now would pin the wall to a session that never moves
    expect(activeIn([{ path: "broken" } as S], NOW, MIN)).toEqual([]);
  });

  test("clock skew does not wedge the rotation", async () => {
    const activeIn = await extractActiveIn();
    // a file mtime slightly in the future (NFS, VM clock drift) is still
    // recent activity, not a reason to hide the session
    expect(activeIn([{ path: "future", mtime: NOW + 5_000 }], NOW, MIN).length).toBe(1);
  });
});

/**
 * nextInRotation() picks the destination. Reported from a real wall
 * display: the rotation pinned itself on one session that had gone
 * quiet, with live sessions available. The cause was counting active
 * sessions rather than destinations — once the session on screen goes
 * quiet it leaves the active list, and a single live session elsewhere
 * is still somewhere to go.
 */
async function extractNextInRotation(): Promise<(a: S[], cur: string) => string | null> {
  const src = await Bun.file("public/holotable.js").text();
  const start = src.indexOf("function nextInRotation(act, current){");
  if (start < 0) throw new Error("nextInRotation() not found in holotable.js");
  const end = src.indexOf("\n  }", start) + 4;
  const fn = new Function("act", "current",
    src.slice(start, end) + "\nreturn nextInRotation(act, current);");
  return fn as (a: S[], cur: string) => string | null;
}

const P = (...paths: string[]) => paths.map((p) => ({ path: p, mtime: 0 }));

describe("nextInRotation", () => {
  test("the reported stall: on a quiet session, one live one left", async () => {
    const next = await extractNextInRotation();
    // "dead" is no longer in the active list; "live" is the only one going
    expect(next(P("live"), "dead")).toBe("live");
  });

  test("advances through the live ones in order", async () => {
    const next = await extractNextInRotation();
    expect(next(P("a", "b", "c"), "a")).toBe("b");
    expect(next(P("a", "b", "c"), "b")).toBe("c");
    expect(next(P("a", "b", "c"), "c")).toBe("a");   // wraps
  });

  test("stays put when the only live session is the one on screen", async () => {
    const next = await extractNextInRotation();
    // moving here would mean reconnecting to the same session on a timer
    expect(next(P("only"), "only")).toBe(null);
  });

  test("nothing live at all means nowhere to go", async () => {
    const next = await extractNextInRotation();
    expect(next([], "anything")).toBe(null);
  });

  test("a quiet session never traps the display", async () => {
    const next = await extractNextInRotation();
    // whatever the live set looks like, being on a dead session must
    // always produce a move — this is the property that was broken
    for (const live of [P("x"), P("x", "y"), P("x", "y", "z")]) {
      const dest = next(live, "dead-session");
      expect(dest).not.toBe(null);
      expect(dest).not.toBe("dead-session");
    }
  });
});

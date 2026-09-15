/**
 * canClaim() in public/holotable.js: decides which droid gets a workshop
 * bench. Extracted from source the same way esc.test.ts does it, since
 * holotable.js is one browser IIFE with nothing exported.
 *
 * The rule that matters: a bench held last frame cannot be taken by someone
 * else, or two subagents wanting the same station swap it every frame and
 * visibly jitter between the two spots.
 */
import { describe, expect, test } from "bun:test";

type Holder = string | undefined;

async function extractCanClaim(): Promise<(n: Holder, p: Holder, id: string) => boolean> {
  const src = await Bun.file("public/holotable.js").text();
  const start = src.indexOf("function canClaim(now, prev, id){");
  if (start < 0) throw new Error("canClaim() not found in holotable.js");
  const end = src.indexOf("\n  }", start) + 4;
  const fn = new Function("now", "prev", "id",
    src.slice(start, end) + "\nreturn canClaim(now, prev, id);");
  return fn as (n: Holder, p: Holder, id: string) => boolean;
}

describe("canClaim", () => {
  test("a free bench is takeable", async () => {
    const canClaim = await extractCanClaim();
    expect(canClaim(undefined, undefined, "a1")).toBe(true);
  });

  test("the holder keeps it across frames", async () => {
    const canClaim = await extractCanClaim();
    expect(canClaim(undefined, "a1", "a1")).toBe(true);
    expect(canClaim("a1", "a1", "a1")).toBe(true);
  });

  test("someone else's bench is refused", async () => {
    const canClaim = await extractCanClaim();
    expect(canClaim("a2", undefined, "a1")).toBe(false);   // booked this frame
    expect(canClaim(undefined, "a2", "a1")).toBe(false);   // held last frame
    expect(canClaim("a2", "a2", "a1")).toBe(false);
  });

  test("the primary outranks a subagent that held it", async () => {
    const canClaim = await extractCanClaim();
    // the primary books before the agent loop runs, so now === "main"
    expect(canClaim("main", "a1", "a1")).toBe(false);
  });

  test("no jitter: a contested bench never flips between two agents", async () => {
    const canClaim = await extractCanClaim();
    // a1 holds; a2 wants it. Whatever the frame order, a2 is refused and a1
    // keeps it — the property that stops the two spots from oscillating.
    let prev: Holder = "a1";
    for (let frame = 0; frame < 5; frame++) {
      const now: Record<string, Holder> = {};
      for (const id of ["a1", "a2"]) {
        if (canClaim(now.bench, prev, id)) now.bench = id;
      }
      expect(now.bench).toBe("a1");
      prev = now.bench;
    }
  });
});

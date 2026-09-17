/**
 * Room mode showed ONE droid no matter how many sessions were live.
 *
 * The backlog handler builds `aliveFilter` — the set of agent ids allowed
 * to spawn a droid — and then replays the events through handle(). It
 * built that set from the RAW events, but handle() receives ROUTED ones,
 * and routed() rewrites `.agent` onto the session's own droid id
 * ("ses:xxxxxx"). So the filter never contained the id it was about to be
 * asked about, ensureAgent refused every non-primary session, and nothing
 * threw: the room just stayed empty except for the primary.
 *
 * Verified against live data at the time: aliveFilter came back empty
 * while the expected id was "ses:f73d96".
 */
import { describe, expect, test } from "bun:test";

type Ev = { t: number; agent?: string; ses?: string };

/** routed() as the page applies it, reduced to what matters here. */
function route(ev: Ev, primary: string, sesOf: Record<string, string>): Ev | null {
  if (!ev.ses || ev.ses === primary) return ev;
  const id = sesOf[ev.ses];
  if (!id) return null;
  return { ...ev, agent: id };
}

/** The filter the backlog handler builds, given whichever events it walks. */
function buildAlive(evs: Ev[], ttl: number): Set<string> {
  const lastByAgent: Record<string, number> = {};
  let newest = 0;
  for (const ev of evs) {
    if (ev.agent) lastByAgent[ev.agent] = Math.max(lastByAgent[ev.agent] || 0, ev.t);
    if (ev.t > newest) newest = ev.t;
  }
  const alive = new Set<string>();
  for (const id of Object.keys(lastByAgent)) {
    if (newest - lastByAgent[id] < ttl) alive.add(id);
  }
  return alive;
}

const NOW = 1_700_000_000_000;
const TTL = 60_000;
const PRIMARY = "/p/primary.jsonl";
const OTHER = "/p/other.jsonl";
const SES_OF = { [OTHER]: "ses:abc123" };

describe("Room backlog", () => {
  test("the source order is what was broken: raw ids never match routed ones", () => {
    const evs: Ev[] = [
      { t: NOW, ses: PRIMARY },
      { t: NOW, ses: OTHER },                      // the session's own work
      { t: NOW, ses: OTHER, agent: "sub999" },     // one of its subagents
    ];
    const fromRaw = buildAlive(evs, TTL);
    // the reported failure, reproduced: the id ensureAgent will be asked
    // about is absent, so the second session never gets a droid
    expect(fromRaw.has("ses:abc123")).toBe(false);
  });

  test("building it from routed events admits the session droid", () => {
    const evs: Ev[] = [
      { t: NOW, ses: PRIMARY },
      { t: NOW, ses: OTHER },
      { t: NOW, ses: OTHER, agent: "sub999" },
    ];
    const routed = evs.map((e) => route(e, PRIMARY, SES_OF)).filter(Boolean) as Ev[];
    expect(buildAlive(routed, TTL).has("ses:abc123")).toBe(true);
  });

  test("a session with no recent activity still stays out", () => {
    // the filter's original job must survive the fix: long-finished work
    // does not get to repopulate the floor on connect
    const evs: Ev[] = [
      { t: NOW - 10 * TTL, ses: OTHER },   // stale
      { t: NOW, ses: PRIMARY },            // newest
    ];
    const routed = evs.map((e) => route(e, PRIMARY, SES_OF)).filter(Boolean) as Ev[];
    expect(buildAlive(routed, TTL).has("ses:abc123")).toBe(false);
  });

  test("several live sessions each earn their own droid", () => {
    const third = "/p/third.jsonl";
    const sesOf = { [OTHER]: "ses:abc123", [third]: "ses:def456" };
    const evs: Ev[] = [
      { t: NOW, ses: PRIMARY },
      { t: NOW, ses: OTHER },
      { t: NOW, ses: third },
    ];
    const routed = evs.map((e) => route(e, PRIMARY, sesOf)).filter(Boolean) as Ev[];
    const alive = buildAlive(routed, TTL);
    expect(alive.has("ses:abc123")).toBe(true);
    expect(alive.has("ses:def456")).toBe(true);
  });

  test("the live source builds the filter from the routed events", async () => {
    // The four cases above exercise local copies of the logic, which is
    // useful for stating the rule but cannot catch a regression in the
    // file. This one reads the real thing: the loop that fills
    // lastByAgent must walk routedEvs, not the raw evs.
    const src = await Bun.file("public/holotable.js").text();
    const a = src.indexOf("// Only spawn droids for subagents");
    expect(a).toBeGreaterThan(-1);
    const block = src.slice(a, a + 1400);

    const fill = block.indexOf("lastByAgent[ev.agent]");
    expect(fill).toBeGreaterThan(-1);
    // the forEach that owns that line has to be over routedEvs
    const loop = block.lastIndexOf("forEach", fill);
    const owner = block.slice(Math.max(0, loop - 40), loop);
    expect(owner).toContain("routedEvs");

    // and the replay into handle() must use the same already-routed list,
    // otherwise the filter and the events it gates come from two places
    expect(block).toContain("routedEvs.forEach(function(ev){ handle(ev, true); })");
  });
});

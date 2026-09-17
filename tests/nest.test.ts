/**
 * nestParentFor() in public/holotable.js decides whether a newly-seen droid
 * gets nested under the last agent that called Task. Reported bug: in Room
 * mode (several independent top-level sessions on screen at once), two
 * unrelated sessions sometimes rendered as parent/child — one droid orbiting
 * and tethered to another session's droid, when they were just two separate
 * sessions running at the same time.
 *
 * Root cause: the transcript has no parentUuid on sidechains, so nesting is
 * inferred purely from timing (a Task call "claims" the next agent that
 * shows up within NEST_WINDOW). That inference used one single global slot
 * (lastTask), shared by every session flowing through the same handle()
 * path. A Task seen in session A could claim a droid that actually belonged
 * to session B. The fix scopes the slot per session (sesKey, stamped by
 * routed()) and additionally forbids a session droid from ever being a
 * parent or a child — it is always a peer.
 */
import { describe, expect, test } from "bun:test";

type Agent = { isSession?: boolean };
type Task = { agent: string; at: number } | undefined;

async function extractNestParentFor(): Promise<
  (sesKey: string, id: string, now: number, agents: Record<string, Agent>,
   tasks: Record<string, Task>, nestWindow: number) => string | null
> {
  const src = await Bun.file("public/holotable.js").text();
  const start = src.indexOf("function nestParentFor(sesKey, id, now, agents, tasks, nestWindow){");
  if (start < 0) throw new Error("nestParentFor() not found in holotable.js");
  const end = src.indexOf("\n  }", start) + 4;
  // SES_PREFIX is declared elsewhere in the same IIFE; nestParentFor reads
  // it, so the extracted copy needs it in scope too.
  const fn = new Function("sesKey", "id", "now", "agents", "tasks", "nestWindow",
    'var SES_PREFIX = "ses:";\n' +
    src.slice(start, end) + "\nreturn nestParentFor(sesKey, id, now, agents, tasks, nestWindow);");
  return fn as any;
}

const NOW = 1_700_000_000_000;
const WIN = 120_000;

describe("nestParentFor", () => {
  test("nests within the same session, inside the window", async () => {
    const nestParentFor = await extractNestParentFor();
    const agents = { subA: {} };
    const tasks = { sesA: { agent: "subA", at: NOW - 1000 } };
    expect(nestParentFor("sesA", "newAgent", NOW, agents, tasks, WIN)).toBe("subA");
  });

  test("the reported bug: session A's Task never claims a droid from session B", async () => {
    const nestParentFor = await extractNestParentFor();
    // session A's subagent called Task moments ago
    const agents = { subA: {} };
    const tasks = { sesA: { agent: "subA", at: NOW - 1000 } };
    // a brand new droid shows up, but it belongs to session B
    expect(nestParentFor("sesB", "subB", NOW, agents, tasks, WIN)).toBe(null);
  });

  test("a session droid is never nested under anything, even its own last task", async () => {
    const nestParentFor = await extractNestParentFor();
    const agents = { subA: {} };
    const tasks = { sesA: { agent: "subA", at: NOW - 1000 } };
    // "ses:xxxxxx" showing up in the same session is still a peer, not a child
    expect(nestParentFor("sesA", "ses:xxxxxx", NOW, agents, tasks, WIN)).toBe(null);
  });

  test("a session droid is never claimed as a parent", async () => {
    const nestParentFor = await extractNestParentFor();
    const agents = { "ses:aaaaaa": { isSession: true } };
    const tasks = { sesA: { agent: "ses:aaaaaa", at: NOW - 1000 } };
    expect(nestParentFor("sesA", "newAgent", NOW, agents, tasks, WIN)).toBe(null);
  });

  test("no task recorded yet for this session: no parent", async () => {
    const nestParentFor = await extractNestParentFor();
    expect(nestParentFor("sesA", "newAgent", NOW, {}, {}, WIN)).toBe(null);
  });

  test("outside the nest window: no parent", async () => {
    const nestParentFor = await extractNestParentFor();
    const agents = { subA: {} };
    const tasks = { sesA: { agent: "subA", at: NOW - WIN - 1 } };
    expect(nestParentFor("sesA", "newAgent", NOW, agents, tasks, WIN)).toBe(null);
  });

  test("the claimed agent must still be alive", async () => {
    const nestParentFor = await extractNestParentFor();
    const tasks = { sesA: { agent: "goneAgent", at: NOW - 1000 } };
    expect(nestParentFor("sesA", "newAgent", NOW, {}, tasks, WIN)).toBe(null);
  });

  test("an agent cannot nest under itself", async () => {
    const nestParentFor = await extractNestParentFor();
    const agents = { subA: {} };
    const tasks = { sesA: { agent: "subA", at: NOW - 1000 } };
    expect(nestParentFor("sesA", "subA", NOW, agents, tasks, WIN)).toBe(null);
  });

  test("two unrelated sessions running Task at once nest independently, never cross", async () => {
    const nestParentFor = await extractNestParentFor();
    const agents = { subA: {}, subB: {} };
    const tasks: Record<string, Task> = {
      sesA: { agent: "subA", at: NOW - 500 },
      sesB: { agent: "subB", at: NOW - 500 },
    };
    expect(nestParentFor("sesA", "childOfA", NOW, agents, tasks, WIN)).toBe("subA");
    expect(nestParentFor("sesB", "childOfB", NOW, agents, tasks, WIN)).toBe("subB");
  });
});

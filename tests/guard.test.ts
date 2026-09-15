/**
 * Guards that fail silently if broken: insideRoot is the only thing standing
 * between a client-supplied path and the filesystem, and agentIdOf decides
 * which droid an event belongs to.
 */
import { expect, test, describe } from "bun:test";
import { sep } from "node:path";
import { insideRoot } from "../server/stream.ts";
import { agentIdOf, subDirOf } from "../server/subagents.ts";
import { ROOT } from "../server/config.ts";

describe("insideRoot", () => {
  test("accepts the root itself and paths under it", () => {
    expect(insideRoot(ROOT)).toBe(true);
    expect(insideRoot(ROOT + sep + "proj" + sep + "s.jsonl")).toBe(true);
  });

  test("rejects paths outside the root", () => {
    expect(insideRoot("/etc/passwd")).toBe(false);
    expect(insideRoot("/")).toBe(false);
  });

  test("rejects traversal that climbs back out", () => {
    expect(insideRoot(ROOT + sep + ".." + sep + ".." + sep + "etc" + sep + "passwd")).toBe(false);
    expect(insideRoot(ROOT + sep + "a" + sep + ".." + sep + ".." + sep + "elsewhere")).toBe(false);
  });

  test("rejects a sibling dir sharing the root's name prefix", () => {
    // ROOT + "-evil" starts with ROOT as a string: only the separator check
    // rejects it. A regression to plain startsWith(ROOT) would pass this path.
    expect(insideRoot(ROOT + "-evil" + sep + "s.jsonl")).toBe(false);
  });
});

describe("agentIdOf", () => {
  test("strips the agent- prefix and the extension, keeping 6 chars", () => {
    expect(agentIdOf("/x/agent-abcdef1234.jsonl")).toBe("abcdef");
  });

  test("shorter ids survive intact", () => {
    expect(agentIdOf("/x/agent-ab12.jsonl")).toBe("ab12");
  });

  test("ignores parent directories that look like the prefix", () => {
    expect(agentIdOf("/agent-decoy/agent-99ff00aa.jsonl")).toBe("99ff00");
  });
});

describe("subDirOf", () => {
  test("swaps the .jsonl suffix for the subagents dir", () => {
    expect(subDirOf("/x/sess.jsonl")).toBe("/x/sess" + sep + "subagents");
  });
});

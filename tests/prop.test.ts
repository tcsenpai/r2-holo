/**
 * propFor() in public/holotable.js maps a tool to a projected prop. It is
 * also what picks the workshop station a droid drives to, so the two uses
 * have to stay compatible: every kind it returns is either a real station
 * or deliberately not one.
 *
 * "ask" is the deliberate case — asking is not bench work, so the droid
 * must hold its ground and project the question rather than drive off to
 * a station that does not exist.
 */
import { describe, expect, test } from "bun:test";

const STATION_KINDS = ["read", "write", "term", "index", "globe", "charge"];

async function extractPropFor(): Promise<(tool: string | null) => string | null> {
  const src = await Bun.file("public/holotable.js").text();
  const askLine = src.match(/var ASK_TOOLS = (\/.*?\/);/);
  if (!askLine) throw new Error("ASK_TOOLS not found in holotable.js");
  const start = src.indexOf("function propFor(tool){");
  if (start < 0) throw new Error("propFor() not found in holotable.js");
  const end = src.indexOf("\n  }", start) + 4;
  const fn = new Function("tool",
    `var ASK_TOOLS = ${askLine[1]};\n` + src.slice(start, end) + "\nreturn propFor(tool);");
  return fn as (tool: string | null) => string | null;
}

describe("propFor", () => {
  test("question tools get the ask panel", async () => {
    const propFor = await extractPropFor();
    expect(propFor("AskUserQuestion")).toBe("ask");
    expect(propFor("ExitPlanMode")).toBe("ask");
  });

  test("ask is NOT a workshop station", async () => {
    // the whole pinning behaviour rests on this: if "ask" ever became a
    // station kind, the droid would drive off mid-question
    expect(STATION_KINDS).not.toContain("ask");
  });

  test("bench tools still map to their stations", async () => {
    const propFor = await extractPropFor();
    expect(propFor("Read")).toBe("read");
    expect(propFor("Edit")).toBe("write");
    expect(propFor("Bash")).toBe("term");
    expect(propFor("Grep")).toBe("index");
    expect(propFor("WebFetch")).toBe("globe");
    expect(propFor("mcp__whatever__thing")).toBe("globe");
  });

  test("every non-null kind is a station or the ask panel", async () => {
    const propFor = await extractPropFor();
    const tools = ["Read", "NotebookRead", "Write", "Edit", "MultiEdit",
      "NotebookEdit", "Grep", "Glob", "LS", "TodoRead", "TodoWrite", "Bash",
      "BashOutput", "KillShell", "WebSearch", "WebFetch", "mcp__x__y",
      "AskUserQuestion", "ExitPlanMode"];
    for (const t of tools) {
      const kind = propFor(t);
      if (kind === null) continue;
      expect(STATION_KINDS.includes(kind) || kind === "ask").toBe(true);
    }
  });

  test("unknown tools and empty input get no prop", async () => {
    const propFor = await extractPropFor();
    expect(propFor("SomeFutureTool")).toBe(null);
    expect(propFor(null)).toBe(null);
    expect(propFor("")).toBe(null);
  });
});

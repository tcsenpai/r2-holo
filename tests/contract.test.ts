/**
 * Contract tests: shared/*.json stays the single source of truth.
 * - shared/systems.json must equal the SYSTEMS table in public/holotable.js
 * - index.html modal + README must mention every module tag
 * - every kind normalize() emits must be in shared/protocol.json
 */
import { describe, expect, test } from "bun:test";
import { normalize } from "../server/transcript.ts";

const IDS = ["sns", "scp", "man", "trx", "vck", "ext", "int", "loc"];

function extractSystems(src: string): any[] {
  const start = src.indexOf("var SYSTEMS = [");
  const end = src.indexOf("var MODKEYS");
  if (start < 0 || end < 0) throw new Error("SYSTEMS markers not found in holotable.js");
  const fn = new Function(src.slice(start, end) + "\nreturn SYSTEMS;");
  return fn();
}

describe("shared contract", () => {
  test("systems.json matches holotable.js SYSTEMS", async () => {
    const shared = await Bun.file("shared/systems.json").json();
    const src = await Bun.file("public/holotable.js").text();
    const inline = extractSystems(src);
    expect(shared.map((s: any) => s.id)).toEqual(IDS);
    expect(inline).toEqual(shared);
  });

  test("index.html modal + README mention every module", async () => {
    const html = await Bun.file("public/index.html").text();
    const readme = await Bun.file("README.md").text();
    const systems: any[] = await Bun.file("shared/systems.json").json();
    for (const s of systems) {
      expect(html.includes(s.tag)).toBe(true);
      expect(readme.includes(s.tag)).toBe(true);
    }
  });

  test("normalize kinds are all declared in protocol.json", async () => {
    const protocol = await Bun.file("shared/protocol.json").json();
    const kinds: string[] = protocol.event.properties.kind.enum;
    const samples = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "x" }] } }),
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result" }] } }),
      JSON.stringify({ type: "user", message: { content: "hi" } }),
      JSON.stringify({ type: "system", subtype: "x" }),
      JSON.stringify({ type: "permission-mode", permissionMode: "m" }),
      JSON.stringify({ type: "custom-title", customTitle: "t" }),
      JSON.stringify({ type: "cost-state" }),
      JSON.stringify({ type: "file-history-delta", trackingPath: "/tmp/x" }),
      JSON.stringify({ type: "queue-operation", operation: "enqueue" }),
    ];
    for (const s of samples) {
      for (const e of normalize(s)) expect(kinds).toContain(e.kind);
    }
  });
});

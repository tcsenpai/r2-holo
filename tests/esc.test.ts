/**
 * esc() in public/holotable.js: transcript-controlled strings must not
 * reach innerHTML raw. Extracts the helper the same way contract.test.ts
 * extracts SYSTEMS, then checks behaviour + call sites.
 */
import { describe, expect, test } from "bun:test";

function extractEsc(src: string): (s: unknown) => string {
  const start = src.indexOf("function esc(s){");
  if (start < 0) throw new Error("esc() not found in holotable.js");
  const end = src.indexOf("\n  }", start) + 4;
  const fn = new Function("s", src.slice(start, end) + "\nreturn esc(s);");
  return fn as (s: unknown) => string;
}

describe("esc", () => {
  test("neutralises markup", async () => {
    const src = await Bun.file("public/holotable.js").text();
    const esc = extractEsc(src);
    expect(esc('<img src=x onerror=alert(1)>')).toBe("&lt;img src=x onerror=alert(1)&gt;");
    expect(esc("a&b\"c'd")).toBe("a&amp;b&quot;c&#39;d");
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
    expect(esc("Bash")).toBe("Bash");
  });

  test("session-derived sinks go through esc()", async () => {
    const src = await Bun.file("public/holotable.js").text();
    for (const sink of [
      "esc(live.lastTool)",
      "esc(live.model)",
      "esc(live.lastFile)",
      "esc(live.perm)",
      "<span class=\"nm\">'+esc(name)",
      "esc(ev.agent)",
      "esc(isDroid ? droidSpeak()",
      "esc(A.model",
      "esc(A.atype",
      "esc(A.lastTool)",
      "esc(S.label)",
    ]) {
      expect(src.includes(sink)).toBe(true);
    }
  });
});

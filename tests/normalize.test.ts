import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { normalize } from "../server/transcript.ts";

const T = "2026-09-15T12:00:00.000Z";

describe("normalize", () => {
  test("assistant tool_use -> tool event", () => {
    const line = JSON.stringify({
      timestamp: T, type: "assistant",
      message: {
        model: "claude-opus-4-1", usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ type: "tool_use", id: "tu_1", name: "Bash" }],
      },
    });
    const [e] = normalize(line);
    expect(e.kind).toBe("tool");
    expect(e.tool).toBe("Bash");
    expect(e.id).toBe("tu_1");
    expect(e.model).toBe("claude-opus-4-1");
    expect(e.tokens).toBe(15);
  });

  test("assistant text (blank ignored)", () => {
    const line = JSON.stringify({
      timestamp: T, type: "assistant",
      message: { content: [{ type: "text", text: "  " }, { type: "text", text: "hi" }] },
    });
    const evs = normalize(line);
    expect(evs.length).toBe(1);
    expect(evs[0].kind).toBe("text");
  });

  test("user tool_result -> result with error + forId", () => {
    const line = JSON.stringify({
      timestamp: T, type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "tu_1", is_error: true }] },
    });
    const [e] = normalize(line);
    expect(e.kind).toBe("result");
    expect(e.error).toBe(true);
    expect(e.forId).toBe("tu_1");
  });

  test("user string content -> user", () => {
    const [e] = normalize(JSON.stringify({ timestamp: T, type: "user", message: { content: "hello" } }));
    expect(e.kind).toBe("user");
  });

  test("system / permission-mode / title", () => {
    expect(normalize(JSON.stringify({ timestamp: T, type: "system", subtype: "turn_duration", durationMs: 123 }))[0]).toMatchObject({ kind: "system", label: "turn_duration", ms: 123 });
    expect(normalize(JSON.stringify({ type: "permission-mode", permissionMode: "bypassPermissions" }))[0]).toMatchObject({ kind: "mode", label: "bypassPermissions" });
    expect(normalize(JSON.stringify({ type: "custom-title", customTitle: "X" }))[0]).toMatchObject({ kind: "title", label: "X" });
  });

  test("cost-state -> digest, top models by usd", () => {
    const [e] = normalize(JSON.stringify({
      type: "cost-state", totalCostUSD: 1.5, totalLinesAdded: 10, totalLinesRemoved: 2,
      totalToolDuration: 3, totalAPIDuration: 4, totalDuration: 5,
      modelUsage: {
        a: { costUSD: 0.1, outputTokens: 1, cacheReadInputTokens: 2 },
        b: { costUSD: 0.9, outputTokens: 3, cacheReadInputTokens: 4 },
      },
    }));
    expect(e.kind).toBe("cost");
    expect(e.cost?.usd).toBe(1.5);
    expect(e.cost?.models[0].name).toBe("b");
    expect(e.cost?.models.length).toBe(2);
  });

  test("file-history-delta -> home-relative path only", () => {
    const [e] = normalize(JSON.stringify({ type: "file-history-delta", trackingPath: homedir() + "/x/y.ts" }));
    expect(e.kind).toBe("file");
    expect(e.path).toBe("~/x/y.ts");
    expect(normalize(JSON.stringify({ type: "file-history-delta" })).length).toBe(0);
  });

  test("queue-operation -> queue", () => {
    expect(normalize(JSON.stringify({ type: "queue-operation", operation: "enqueue" }))[0]).toMatchObject({ kind: "queue", op: "enqueue" });
  });

  test("invalid JSON -> []", () => {
    expect(normalize("not json")).toEqual([]);
  });

  test("agent tagging carries agent + atype", () => {
    const line = JSON.stringify({
      timestamp: T, type: "assistant", attributionAgent: "general-purpose",
      message: { content: [{ type: "tool_use", id: "t", name: "Read" }] },
    });
    const [e] = normalize(line, "abc123");
    expect(e.agent).toBe("abc123");
    expect(e.atype).toBe("general-purpose");
    expect(e.sidechain).toBe(true);
  });
});

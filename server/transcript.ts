/**
 * Event normalisation + prelude scan.
 *
 * A transcript line becomes a minimal event: what the droid needs to
 * react to, without carrying any session content with it.
 */
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { PRELUDE_FILES, PRELUDE_MAX, PRELUDE_CHUNK } from "./config.ts";
import type { Ev } from "./types.ts";

const HOME = homedir();

export function shortPath(p: unknown): string | undefined {
  if (typeof p !== "string" || !p) return undefined;
  return p.startsWith(HOME) ? "~" + p.slice(HOME.length) : p;
}

export function normalize(line: string, agent?: string): Ev[] {
  let o: any;
  try {
    o = JSON.parse(line);
  } catch {
    return [];
  }
  const t = o.timestamp ? Date.parse(o.timestamp) : Date.now();
  const side = !!o.isSidechain || !!agent;
  // attributionAgent is the agent TYPE (general-purpose / fork), not a parent
  const atype = typeof o.attributionAgent === "string" ? o.attributionAgent : undefined;
  const tag = (e: Ev): Ev =>
    agent ? { ...e, agent, ...(atype ? { atype } : {}) } : e;
  const evs: Ev[] = [];

  if (o.type === "assistant") {
    const usage = o.message?.usage;
    const tokens =
      (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0) || undefined;
    // Two very different numbers with the same name in conversation: context
    // read back out of the cache costs almost nothing, context sent fresh is
    // what you actually pay for. Keeping them apart is the whole point.
    const cache = usage?.cache_read_input_tokens ?? undefined;
    const fresh =
      (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0) ||
      undefined;
    const effort = o.effort ?? o.message?.effort ?? undefined;
    const speed = o.speed ?? o.message?.speed ?? undefined;
    const meta = { model: o.message?.model, tokens, cache, fresh, effort, speed };
    for (const b of o.message?.content ?? []) {
      if (b?.type === "tool_use") {
        evs.push(tag({
          t, kind: "tool", tool: String(b.name ?? "?"),
          id: b.id ? String(b.id) : undefined,
          sidechain: side, ...meta,
        }));
      } else if (b?.type === "text" && String(b.text ?? "").trim()) {
        evs.push(tag({ t, kind: "text", sidechain: side, ...meta }));
      }
    }
  } else if (o.type === "user") {
    const blocks = o.message?.content;
    if (Array.isArray(blocks)) {
      let sawResult = false;
      for (const b of blocks) {
        if (b?.type === "tool_result") {
          sawResult = true;
          evs.push(tag({
            t, kind: "result", error: !!b.is_error,
            forId: b.tool_use_id ? String(b.tool_use_id) : undefined,
            sidechain: side,
          }));
        }
      }
      if (!sawResult) evs.push(tag({ t, kind: "user", sidechain: side }));
    } else if (typeof blocks === "string") {
      evs.push(tag({ t, kind: "user", sidechain: side }));
    }
  } else if (o.type === "system") {
    evs.push(tag({
      t, kind: "system", label: o.subtype ?? undefined, sidechain: side,
      ms: typeof o.durationMs === "number" ? o.durationMs : undefined,
    }));
  } else if (o.type === "permission-mode") {
    evs.push({ t, kind: "mode", label: o.permissionMode ?? undefined });
  } else if (o.type === "custom-title" || o.type === "ai-title") {
    evs.push({ t, kind: "title", label: o.customTitle ?? o.aiTitle });
  } else if (o.type === "cost-state") {
    const mu = o.modelUsage && typeof o.modelUsage === "object" ? o.modelUsage : {};
    const models = Object.keys(mu)
      .map((name) => ({
        name,
        usd: Number(mu[name]?.costUSD ?? 0),
        out: Number(mu[name]?.outputTokens ?? 0),
        cr: Number(mu[name]?.cacheReadInputTokens ?? 0),
      }))
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 4);
    evs.push({
      t, kind: "cost",
      cost: {
        usd: Number(o.totalCostUSD ?? 0),
        added: Number(o.totalLinesAdded ?? 0),
        removed: Number(o.totalLinesRemoved ?? 0),
        toolMs: Number(o.totalToolDuration ?? 0),
        apiMs: Number(o.totalAPIDuration ?? 0),
        durMs: Number(o.totalDuration ?? 0),
        models,
      },
    });
  } else if (o.type === "file-history-delta") {
    // Only the path, and only relative to $HOME: which files the session is
    // working on, never a byte of what is in them.
    const p = shortPath(o.trackingPath);
    if (p) evs.push(tag({ t, kind: "file", path: p, sidechain: side }));
  } else if (o.type === "queue-operation") {
    evs.push({ t, kind: "queue", op: String(o.operation ?? "?") });
  }
  return evs;
}

/**
 * Prelude scan.
 *
 * cost-state is written a handful of times in a whole session and
 * file-history-delta only when a file is actually edited, so both are
 * usually far behind the 512 KB tail the backlog reads — on a 27 MB
 * transcript the last cost-state sat 10 MB from the end. Without this the
 * ledger and the bench would stay empty for the rest of the run.
 *
 * So the file is swept once at connect, but only lines already containing
 * the marker are parsed: two substring tests per line instead of a JSON
 * parse, which keeps a multi-megabyte sweep in the tens of milliseconds.
 */
export async function prelude(path: string): Promise<Ev[]> {
  let cost: Ev | null = null;
  const files: Ev[] = [];
  const f = await open(path, "r");
  try {
    const { size } = await f.stat();
    const from = Math.max(0, size - PRELUDE_MAX);
    const buf = Buffer.alloc(PRELUDE_CHUNK);
    let pos = from;
    let rest = "";
    while (pos < size) {
      const len = Math.min(PRELUDE_CHUNK, size - pos);
      const { bytesRead } = await f.read(buf, 0, len, pos);
      if (bytesRead <= 0) break;
      pos += bytesRead;
      const lines = (rest + buf.toString("utf8", 0, bytesRead)).split("\n");
      rest = lines.pop() ?? "";
      for (const l of lines) {
        if (l.indexOf('"cost-state"') < 0 && l.indexOf('"file-history-delta"') < 0) continue;
        for (const e of normalize(l)) {
          if (e.kind === "cost") cost = e;
          else if (e.kind === "file") files.push(e);
        }
      }
    }
    for (const e of normalize(rest)) {
      if (e.kind === "cost") cost = e;
      else if (e.kind === "file") files.push(e);
    }
  } catch {
  } finally {
    await f.close();
  }
  // oldest first, so the bench tiles land in the order they were edited
  const out = files.slice(-PRELUDE_FILES);
  if (cost) out.push(cost);
  return out;
}

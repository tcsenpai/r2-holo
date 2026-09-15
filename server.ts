/**
 * R2 Holotable — local server
 *
 * Indexes Claude Code sessions under ~/.claude/projects, tails the one you
 * pick, and pushes normalised events to the page over SSE.
 *
 *   bun run server.ts            -> http://localhost:4242
 *   PORT=8080 bun run server.ts
 *
 * It never leaves the loopback interface and never writes: it only reads.
 *
 * IMPORTANT NOTE ON THE FORMAT
 * A session with subagents writes almost everything OUTSIDE the parent file:
 * the parent gets the `Task` line when the subagent starts and the
 * `tool_result` when it ends, while every tool the subagent calls lands in
 *   <session-id>/subagents/agent-<id>.jsonl
 * Watching only the parent means missing ~95% of the work. So this follows
 * the parent AND the whole subagents directory, including files that appear
 * after the stream is already open.
 */

import { watch, type FSWatcher } from "node:fs";
import { readdir, stat, open } from "node:fs/promises";
import { join, resolve, sep, basename } from "node:path";
import { homedir } from "node:os";

const ROOT = resolve(join(homedir(), ".claude", "projects"));
const PORT = Number(process.env.PORT ?? 4242);
const PUBLIC = join(import.meta.dir, "public");

/* ------------------------------------------------------------------ *
 * Sliced reads
 * ------------------------------------------------------------------ */

async function readSlice(path: string, start: number, length: number) {
  const f = await open(path, "r");
  try {
    const { size } = await f.stat();
    const from = Math.max(0, Math.min(start, size));
    const len = Math.max(0, Math.min(length, size - from));
    if (len === 0) return "";
    const buf = Buffer.alloc(len);
    await f.read(buf, 0, len, from);
    return buf.toString("utf8");
  } finally {
    await f.close();
  }
}

async function readTail(path: string, bytes: number) {
  const f = await open(path, "r");
  try {
    const { size } = await f.stat();
    const from = Math.max(0, size - bytes);
    const len = size - from;
    if (len === 0) return { text: "", size };
    const buf = Buffer.alloc(len);
    await f.read(buf, 0, len, from);
    return { text: buf.toString("utf8"), size };
  } finally {
    await f.close();
  }
}

/* ------------------------------------------------------------------ *
 * Session index
 * ------------------------------------------------------------------ */

type SessionInfo = {
  id: string;
  path: string;
  project: string;
  cwd: string | null;
  branch: string | null;
  title: string | null;
  size: number;
  mtime: number;
};

/** Head lines carry the cwd, tail lines carry the title. */
async function describe(path: string): Promise<Partial<SessionInfo>> {
  const out: Partial<SessionInfo> = {};
  try {
    const head = await readSlice(path, 0, 64 * 1024);
    for (const line of head.split("\n").slice(0, 40)) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        if (o.cwd && !out.cwd) out.cwd = o.cwd;
        if (o.gitBranch && !out.branch) out.branch = o.gitBranch;
      } catch {}
      if (out.cwd) break;
    }
  } catch {}
  try {
    const { text } = await readTail(path, 48 * 1024);
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        if (o.type === "custom-title" && o.customTitle) out.title = o.customTitle;
        else if (o.type === "ai-title" && o.aiTitle && !out.title) out.title = o.aiTitle;
      } catch {}
    }
  } catch {}
  return out;
}

/** True last activity: the newest mtime across the parent and its subagents. */
async function effectiveMtime(parentPath: string, parentMtime: number) {
  let best = parentMtime;
  for (const f of await listSubFiles(subDirOf(parentPath))) {
    try {
      const s = await stat(f);
      if (s.mtimeMs > best) best = s.mtimeMs;
    } catch {}
  }
  return best;
}

async function listSessions(limit = 40): Promise<SessionInfo[]> {
  let dirs: string[];
  try {
    dirs = (await readdir(ROOT, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }

  const rough: SessionInfo[] = [];
  for (const d of dirs) {
    let files: string[];
    try {
      files = (await readdir(join(ROOT, d), { withFileTypes: true }))
        .filter((f) => f.isFile() && f.name.endsWith(".jsonl"))
        .map((f) => f.name);
    } catch {
      continue;
    }
    for (const f of files) {
      const path = join(ROOT, d, f);
      try {
        const s = await stat(path);
        if (s.size < 1024) continue;              // empty or aborted sessions
        rough.push({
          id: f.replace(/\.jsonl$/, ""),
          path,
          project: d,
          cwd: null,
          branch: null,
          title: null,
          size: s.size,
          mtime: s.mtimeMs,
        });
      } catch {}
    }
  }

  rough.sort((a, b) => b.mtime - a.mtime);
  const top = rough.slice(0, Math.min(limit * 2, rough.length));

  // A parent can sit still while its subagents hammer away, so ordering by
  // "most recent activity" has to consider them too.
  await Promise.all(
    top.map(async (s) => {
      Object.assign(s, await describe(s.path));
      s.mtime = await effectiveMtime(s.path, s.mtime);
    })
  );
  top.sort((a, b) => b.mtime - a.mtime);
  return top.slice(0, limit);
}

/* ------------------------------------------------------------------ *
 * Event normalisation
 *
 * A transcript line becomes a minimal event: what the droid needs to
 * react to, without carrying any session content with it.
 * ------------------------------------------------------------------ */

type Ev = {
  t: number;
  kind:
    | "tool" | "result" | "text" | "user" | "system" | "mode" | "title"
    | "cost"      // the session's own running totals
    | "file"      // a file the transcript records as edited
    | "queue";    // a message queued, sent or dropped
  tool?: string;
  error?: boolean;
  label?: string;
  sidechain?: boolean;
  id?: string;         // tool_use id, so a call can be paired with its result
  forId?: string;      // tool_use_id carried by the matching tool_result
  agent?: string;      // short agent id, from the filename
  atype?: string;      // agent type: general-purpose, fork, ...
  model?: string;
  tokens?: number;
  cache?: number;      // cache_read_input_tokens: context reused, cheaply
  fresh?: number;      // input_tokens: context paid for again
  effort?: string;
  speed?: string;
  ms?: number;         // durationMs, on the system lines that carry one
  path?: string;       // trackingPath, home-relative
  op?: string;         // queue-operation: enqueue / dequeue / remove / popAll
  cost?: CostDigest;
};

/** The useful half of a cost-state line. Totals, not content. */
type CostDigest = {
  usd: number;
  added: number;
  removed: number;
  toolMs: number;
  apiMs: number;
  durMs: number;
  models: { name: string; usd: number; out: number; cr: number }[];
};

const HOME = homedir();
function shortPath(p: unknown): string | undefined {
  if (typeof p !== "string" || !p) return undefined;
  return p.startsWith(HOME) ? "~" + p.slice(HOME.length) : p;
}

function normalize(line: string, agent?: string): Ev[] {
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

/* ------------------------------------------------------------------ *
 * Prelude scan
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
 * ------------------------------------------------------------------ */

const PRELUDE_FILES = 24;                 // how many edited files to restore
const PRELUDE_MAX = 512 * 1024 * 1024;    // don't sweep an absurd transcript

async function prelude(path: string): Promise<Ev[]> {
  let cost: Ev | null = null;
  const files: Ev[] = [];
  const f = await open(path, "r");
  try {
    const { size } = await f.stat();
    const from = Math.max(0, size - PRELUDE_MAX);
    const CHUNK = 8 * 1024 * 1024;
    const buf = Buffer.alloc(CHUNK);
    let pos = from;
    let rest = "";
    while (pos < size) {
      const len = Math.min(CHUNK, size - pos);
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

/* ------------------------------------------------------------------ *
 * Subagents
 * ------------------------------------------------------------------ */

function subDirOf(parentPath: string) {
  return parentPath.replace(/\.jsonl$/, "") + sep + "subagents";
}
function agentIdOf(path: string) {
  return basename(path).replace(/^agent-/, "").replace(/\.jsonl$/, "").slice(0, 6);
}
async function listSubFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((f) => f.isFile() && f.name.endsWith(".jsonl"))
      .map((f) => join(dir, f.name));
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ *
 * SSE: backlog plus live tail, parent and subagents
 * ------------------------------------------------------------------ */

function insideRoot(p: string) {
  const r = resolve(p);
  return r === ROOT || r.startsWith(ROOT + sep);
}

const BACKLOG_AGENTS = 4;            // how many recent subagents to replay
const RECENT_MS = 15 * 60 * 1000;    // what counts as "recent" for the replay

function streamSession(parentPath: string): Response {
  const subDir = subDirOf(parentPath);
  let watchers: FSWatcher[] = [];
  let closed = false;
  let poll: ReturnType<typeof setInterval> | null = null;
  let beat: ReturnType<typeof setInterval> | null = null;

  const tracked = new Map<string, { offset: number; rest: string; agent?: string }>();

  const stop = () => {
    closed = true;
    if (poll) clearInterval(poll);
    if (beat) clearInterval(beat);
    for (const w of watchers) { try { w.close(); } catch {} }
    watchers = [];
  };

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {}
      };

      // --- session-wide state that lives outside the tail window ---
      const pre = await prelude(parentPath);
      const backlog: Ev[] = [];

      // --- parent backlog ---
      let parentSize = 0;
      try {
        const { text, size } = await readTail(parentPath, 512 * 1024);
        parentSize = size;
        tracked.set(parentPath, { offset: size, rest: "" });
        const lines = text.split("\n");
        lines.shift();                     // first line is almost surely cut
        for (const l of lines) backlog.push(...normalize(l));
      } catch (e) {
        send("error", { message: String(e) });
      }

      // --- subagents: replay only the freshest, the rest start at EOF ---
      const subs = await listSubFiles(subDir);
      const stats: { path: string; size: number; mtime: number }[] = [];
      for (const p of subs) {
        try {
          const s = await stat(p);
          stats.push({ path: p, size: s.size, mtime: s.mtimeMs });
        } catch {}
      }
      stats.sort((a, b) => b.mtime - a.mtime);

      const now = Date.now();
      for (let i = 0; i < stats.length; i++) {
        const { path, size, mtime } = stats[i];
        const agent = agentIdOf(path);
        const fresh = i < BACKLOG_AGENTS && now - mtime < RECENT_MS;
        if (fresh) {
          try {
            const { text } = await readTail(path, 192 * 1024);
            const lines = text.split("\n");
            lines.shift();
            for (const l of lines) backlog.push(...normalize(l, agent));
          } catch {}
        }
        tracked.set(path, { offset: size, rest: "", agent });
      }

      backlog.sort((a, b) => a.t - b.t);
      // the prelude goes in front of the window, not into it: its events are
      // older than everything here and would be cut by the slice
      send("backlog", pre.concat(backlog.slice(-220)));
      send("ready", { path: parentPath, agents: subs.length, size: parentSize });

      // --- live tail ---
      let busy = false;
      const pump = async () => {
        if (busy || closed) return;
        busy = true;
        const out: Ev[] = [];
        for (const [path, st] of tracked) {
          try {
            const { size } = await stat(path);
            if (size < st.offset) { st.offset = 0; st.rest = ""; }
            if (size > st.offset) {
              const chunk = await readSlice(path, st.offset, size - st.offset);
              st.offset = size;
              const lines = (st.rest + chunk).split("\n");
              st.rest = lines.pop() ?? "";   // partial line: wait for the rest
              for (const l of lines) out.push(...normalize(l, st.agent));
            }
          } catch {}
        }
        if (out.length) {
          out.sort((a, b) => a.t - b.t);
          send("events", out);
        }
        busy = false;
      };

      // new subagents can appear mid-session and must be read from zero
      let scanning = false;
      const rescan = async () => {
        if (scanning || closed) return;
        scanning = true;
        try {
          for (const p of await listSubFiles(subDir)) {
            if (!tracked.has(p)) {
              tracked.set(p, { offset: 0, rest: "", agent: agentIdOf(p) });
            }
          }
        } catch {}
        scanning = false;
      };

      try { watchers.push(watch(parentPath, { persistent: false }, () => void pump())); } catch {}
      try { watchers.push(watch(subDir, { persistent: false }, () => { void rescan(); void pump(); })); } catch {}

      let tick = 0;
      poll = setInterval(() => {
        tick++;
        if (tick % 4 === 0) void rescan();   // ~5 s
        void pump();
      }, 1200);
      beat = setInterval(() => send("beat", { t: Date.now() }), 15000);
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

/* ------------------------------------------------------------------ *
 * HTTP
 * ------------------------------------------------------------------ */

Bun.serve({
  port: PORT,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/api/sessions") {
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 40), 200);
      return Response.json(await listSessions(limit));
    }

    if (url.pathname === "/api/stream") {
      const p = url.searchParams.get("path") ?? "";
      if (!p || !insideRoot(p)) {
        return new Response("path outside ~/.claude/projects", { status: 403 });
      }
      try {
        await stat(p);
      } catch {
        return new Response("session not found", { status: 404 });
      }
      return streamSession(resolve(p));
    }

    const file =
      url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    const asset = Bun.file(join(PUBLIC, file));
    if (await asset.exists()) return new Response(asset);
    return new Response("not found", { status: 404 });
  },
});

console.log(`\n  R2 Holotable`);
console.log(`  sessions from  ${ROOT}`);
console.log(`  listening on   http://localhost:${PORT}\n`);

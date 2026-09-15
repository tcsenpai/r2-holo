/** SSE: backlog plus live tail, parent and subagents. */
import { watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import {
  ROOT,
  BACKLOG_AGENTS,
  RECENT_MS,
  BACKLOG_PARENT_BYTES,
  BACKLOG_AGENT_BYTES,
  BACKLOG_CAP,
  POLL_MS,
  RESCAN_EVERY_TICKS,
  BEAT_MS,
} from "./config.ts";
import { readSlice, readTail } from "./fsutil.ts";
import { normalize, prelude } from "./transcript.ts";
import { subDirOf, agentIdOf, listSubFiles } from "./subagents.ts";
import type { Ev } from "./types.ts";

export function insideRoot(p: string) {
  const r = resolve(p);
  return r === ROOT || r.startsWith(ROOT + sep);
}

export function streamSession(parentPath: string): Response {
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
        const { text, size } = await readTail(parentPath, BACKLOG_PARENT_BYTES);
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
            const { text } = await readTail(path, BACKLOG_AGENT_BYTES);
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
      send("backlog", pre.concat(backlog.slice(-BACKLOG_CAP)));
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
        if (tick % RESCAN_EVERY_TICKS === 0) void rescan();   // ~5 s
        void pump();
      }, POLL_MS);
      beat = setInterval(() => send("beat", { t: Date.now() }), BEAT_MS);
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

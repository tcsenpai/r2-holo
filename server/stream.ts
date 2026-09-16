/** SSE: backlog plus live tail, parent and subagents. */
import { watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import {
  ROOT,
  MAX_SESSIONS,
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

/**
 * Split a tail window into lines. The first line is only dropped when the
 * read was actually truncated (file bigger than the window) — otherwise it
 * is complete and dropping it would lose a real event on small sessions.
 */
export function splitTailLines(text: string, truncated: boolean): string[] {
  const lines = text.split("\n");
  if (truncated) lines.shift();   // first line is almost surely cut
  return lines;
}

/**
 * One SSE connection, one or many sessions.
 *
 * Browsers cap HTTP/1.1 at six connections per origin, so a room showing
 * every active session cannot open one stream each — the seventh silently
 * never connects. Multiplexing here keeps that ceiling out of the client:
 * events carry `ses`, the session path they came from, and a single
 * session behaves exactly as it did before.
 */
export function streamSession(paths: string | string[]): Response {
  const sessions = (Array.isArray(paths) ? paths : [paths]).slice(0, MAX_SESSIONS);
  const parentPath = sessions[0];
  let watchers: FSWatcher[] = [];
  let closed = false;
  let poll: ReturnType<typeof setInterval> | null = null;
  let beat: ReturnType<typeof setInterval> | null = null;

  // `ses` is the session a file belongs to: the parent's own path, carried
  // on every event so the client can route it to the right droid.
  const tracked = new Map<
    string,
    { offset: number; rest: string; agent?: string; ses: string }
  >();

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

      // --- per session: prelude, parent tail, subagent tails ---
      // The backlog cap is per session, not shared: one busy session must not
      // starve the others out of the window.
      const pre: Ev[] = [];
      const backlog: Ev[] = [];
      const opened: { path: string; agents: number; size: number }[] = [];

      for (const ses of sessions) {
        const sesSubDir = subDirOf(ses);
        const mine: Ev[] = [];

        for (const e of await prelude(ses)) pre.push({ ...e, ses });

        let parentSize = 0;
        try {
          const { text, size } = await readTail(ses, BACKLOG_PARENT_BYTES);
          parentSize = size;
          tracked.set(ses, { offset: size, rest: "", ses });
          for (const l of splitTailLines(text, size > BACKLOG_PARENT_BYTES)) mine.push(...normalize(l));
        } catch (e) {
          send("error", { message: String(e), ses });
        }

        // subagents: replay only the freshest, the rest start at EOF
        const subs = await listSubFiles(sesSubDir);
        const stats: { path: string; size: number; mtime: number }[] = [];
        for (const p of subs) {
          try {
            const st = await stat(p);
            stats.push({ path: p, size: st.size, mtime: st.mtimeMs });
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
              const { text, size: sz } = await readTail(path, BACKLOG_AGENT_BYTES);
              for (const l of splitTailLines(text, sz > BACKLOG_AGENT_BYTES)) mine.push(...normalize(l, agent));
            } catch {}
          }
          tracked.set(path, { offset: size, rest: "", agent, ses });
        }

        mine.sort((a, b) => a.t - b.t);
        for (const e of mine.slice(-BACKLOG_CAP)) backlog.push({ ...e, ses });
        opened.push({ path: ses, agents: subs.length, size: parentSize });
      }

      backlog.sort((a, b) => a.t - b.t);
      // the prelude goes in front of the window, not into it: its events are
      // older than everything here and would be cut by the slice
      send("backlog", pre.concat(backlog));
      send("ready", {
        path: parentPath,                      // unchanged for single-session
        sessions: opened,
        agents: opened[0] ? opened[0].agents : 0,
        size: opened[0] ? opened[0].size : 0,
      });

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
              for (const l of lines) {
                for (const e of normalize(l, st.agent)) out.push({ ...e, ses: st.ses });
              }
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
        for (const ses of sessions) {
          try {
            for (const p of await listSubFiles(subDirOf(ses))) {
              if (!tracked.has(p)) {
                tracked.set(p, { offset: 0, rest: "", agent: agentIdOf(p), ses });
              }
            }
          } catch {}
        }
        scanning = false;
      };

      for (const ses of sessions) {
        try { watchers.push(watch(ses, { persistent: false }, () => void pump())); } catch {}
        try {
          watchers.push(watch(subDirOf(ses), { persistent: false }, () => { void rescan(); void pump(); }));
        } catch {}
      }

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

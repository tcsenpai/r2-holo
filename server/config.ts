/**
 * Single tuning + environment config.
 * Previously these constants were scattered through server.ts;
 * behaviour is unchanged — only the location moved.
 */
import { join, resolve } from "node:path";
import { homedir } from "node:os";

export const ROOT = resolve(join(homedir(), ".claude", "projects"));
export const PORT = Number(process.env.PORT ?? 4242);
export const PUBLIC = join(import.meta.dir, "..", "public");

// Session index
export const SESSION_LIMIT_DEFAULT = 40;
export const SESSION_LIMIT_MAX = 200;
export const SESSION_MIN_BYTES = 1024; // skip empty or aborted sessions
export const DESCRIBE_HEAD_BYTES = 64 * 1024;
export const DESCRIBE_TAIL_BYTES = 48 * 1024;

// SSE backlog + live tail
export const BACKLOG_AGENTS = 4;            // how many recent subagents to replay
export const RECENT_MS = 15 * 60 * 1000;    // what counts as "recent" for the replay
export const BACKLOG_PARENT_BYTES = 512 * 1024;
export const BACKLOG_AGENT_BYTES = 192 * 1024;
export const BACKLOG_CAP = 220;             // events kept after time-sort
export const POLL_MS = 1200;                // safety poll (fs.watch sleeps on macOS)
export const RESCAN_EVERY_TICKS = 4;        // subagent rescan cadence (~5 s)
export const BEAT_MS = 15_000;              // SSE heartbeat

// Prelude scan (cost-state + file-history-delta live far behind the tail)
export const PRELUDE_FILES = 24;                 // how many edited files to restore
export const PRELUDE_MAX = 512 * 1024 * 1024;    // don't sweep an absurd transcript
export const PRELUDE_CHUNK = 8 * 1024 * 1024;

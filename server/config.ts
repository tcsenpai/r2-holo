/**
 * Single tuning + environment config.
 * Previously these constants were scattered through server.ts;
 * behaviour is unchanged — only the location moved.
 */
import { join, resolve } from "node:path";
import { homedir, networkInterfaces } from "node:os";

export const ROOT = resolve(join(homedir(), ".claude", "projects"));
const portRaw = Number(process.env.PORT ?? 4242);
export const PORT = Number.isFinite(portRaw) ? portRaw : 4242;
/** Loopback by default: this server hands out the contents of your Claude
 *  transcripts, so on a shared network anyone who knows the port could read
 *  your prompts and project paths. Set HOST to expose it deliberately. */
export const HOST = (process.env.HOST ?? (Bun.argv.includes("--lan") ? "0.0.0.0" : "127.0.0.1"));

/** Best guess at the address other devices on the network should use.
 *  Tunnel interfaces (VPNs, Tailscale) also report non-internal IPv4, so
 *  private LAN ranges win over anything else before falling back. */
export function lanAddress(): string | null {
  const isPrivate = (ip: string) =>
    ip.startsWith("192.168.") || ip.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  let fallback: string | null = null;
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      if (isPrivate(a.address)) return a.address;
      fallback ??= a.address;
    }
  }
  return fallback;
}
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
/** Ceiling on one multiplexed stream. Each session costs a parent watcher,
 *  a subagent-dir watcher and a droid rig on the client, so the room stops
 *  being readable long before the server stops coping. */
export const MAX_SESSIONS = 8;
export const POLL_MS = 1200;                // safety poll (fs.watch sleeps on macOS)
export const RESCAN_EVERY_TICKS = 4;        // subagent rescan cadence (~5 s)
export const BEAT_MS = 15_000;              // SSE heartbeat

// Prelude scan (cost-state + file-history-delta live far behind the tail)
export const PRELUDE_FILES = 24;                 // how many edited files to restore
export const PRELUDE_MAX = 512 * 1024 * 1024;    // don't sweep an absurd transcript
export const PRELUDE_CHUNK = 8 * 1024 * 1024;

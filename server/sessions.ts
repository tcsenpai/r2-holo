/**
 * Session index under ~/.claude/projects.
 * Ordering uses the newest mtime across parent + subagents, so a parent
 * that sits still while its subagents hammer away still climbs to the top.
 */
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  ROOT,
  SESSION_MIN_BYTES,
  DESCRIBE_HEAD_BYTES,
  DESCRIBE_TAIL_BYTES,
} from "./config.ts";
import { readSlice, readTail } from "./fsutil.ts";
import { listSubFiles, subDirOf } from "./subagents.ts";
import type { SessionInfo } from "./types.ts";

/** Head lines carry the cwd, tail lines carry the title. */
export async function describe(path: string): Promise<Partial<SessionInfo>> {
  const out: Partial<SessionInfo> = {};
  try {
    const head = await readSlice(path, 0, DESCRIBE_HEAD_BYTES);
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
    const { text } = await readTail(path, DESCRIBE_TAIL_BYTES);
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
export async function effectiveMtime(parentPath: string, parentMtime: number) {
  let best = parentMtime;
  for (const f of await listSubFiles(subDirOf(parentPath))) {
    try {
      const s = await stat(f);
      if (s.mtimeMs > best) best = s.mtimeMs;
    } catch {}
  }
  return best;
}

export async function listSessions(limit = 40): Promise<SessionInfo[]> {
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
        if (s.size < SESSION_MIN_BYTES) continue;   // empty or aborted sessions
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

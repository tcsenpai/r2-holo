/**
 * Subagent file conventions.
 * A session with subagents writes almost everything OUTSIDE the parent file:
 *   <session-id>/subagents/agent-<id>.jsonl
 */
import { readdir } from "node:fs/promises";
import { join, basename, sep } from "node:path";

export function subDirOf(parentPath: string) {
  return parentPath.replace(/\.jsonl$/, "") + sep + "subagents";
}

export function agentIdOf(path: string) {
  return basename(path).replace(/^agent-/, "").replace(/\.jsonl$/, "").slice(0, 6);
}

export async function listSubFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((f) => f.isFile() && f.name.endsWith(".jsonl"))
      .map((f) => join(dir, f.name));
  } catch {
    return [];
  }
}

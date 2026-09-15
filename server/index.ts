/**
 * R2 Holotable — local server (entrypoint).
 *
 * Thin HTTP layer: everything else lives in ./server/*.
 * Kept as Bun.serve so `bun run server.ts` keeps working.
 */
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PORT, PUBLIC, ROOT, SESSION_LIMIT_DEFAULT, SESSION_LIMIT_MAX } from "./config.ts";
import { listSessions } from "./sessions.ts";
import { insideRoot, streamSession } from "./stream.ts";

Bun.serve({
  port: PORT,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/api/sessions") {
      const limit = Math.min(Number(url.searchParams.get("limit") ?? SESSION_LIMIT_DEFAULT), SESSION_LIMIT_MAX);
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

    // Shared contract served for inspection (source of truth is shared/*.json).
    if (url.pathname === "/api/systems" || url.pathname === "/api/protocol") {
      const asset = Bun.file(join(import.meta.dir, "..", "shared", url.pathname.replace("/api/", "") + ".json"));
      if (await asset.exists()) return new Response(asset);
      return new Response("not found", { status: 404 });
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

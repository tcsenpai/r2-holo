/**
 * R2 Holotable — local server (entrypoint).
 *
 * Thin HTTP layer: everything else lives in ./server/*.
 * Kept as Bun.serve so `bun run server.ts` keeps working.
 */
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { HOST, PORT, PUBLIC, ROOT, lanAddress } from "./config.ts";
import { clampLimit, listSessions } from "./sessions.ts";
import { insideRoot, streamSession } from "./stream.ts";

Bun.serve({
  port: PORT,
  hostname: HOST,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/api/sessions") {
      const limit = clampLimit(url.searchParams.get("limit") ?? undefined);
      return Response.json(await listSessions(limit));
    }

    if (url.pathname === "/api/stream") {
      // One or many: ?path=a&path=b streams both down one connection, which
      // is the only way past the browser's six-connection ceiling.
      const all = url.searchParams.getAll("path").filter(Boolean);
      const p = all[0] ?? "";
      if (!p || all.some((x) => !insideRoot(x))) {
        return new Response("path outside ~/.claude/projects", { status: 403 });
      }
      try {
        await stat(p);
      } catch {
        return new Response("session not found", { status: 404 });
      }
      return streamSession(all.map((x) => resolve(x)));
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

const onLan = HOST !== "127.0.0.1" && HOST !== "localhost";
const lan = onLan ? lanAddress() : null;

console.log(`\n  R2 Holotable`);
console.log(`  sessions from  ${ROOT}`);
console.log(`  listening on   http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
if (lan) console.log(`  on this network http://${lan}:${PORT}`);
if (onLan) {
  console.log(`  ⚠ anyone who can reach this port can read your session`);
  console.log(`    names, tools and costs. There is no password.`);
} else {
  console.log(`  (localhost only — bun run server.ts --lan opens it to the network)`);
}
console.log("");

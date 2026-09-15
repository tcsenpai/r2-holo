/**
 * R2 Holotable — local server (compat entrypoint).
 *
 * The implementation moved to ./server/* (see server/index.ts).
 * `bun run server.ts` keeps working: this file only boots the new entry.
 *
 *   bun run server.ts          # http://localhost:4242
 *   PORT=8080 bun run server.ts
 */
import "./server/index.ts";

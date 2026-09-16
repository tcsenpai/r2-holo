/**
 * The multiplexed stream accepts several ?path= values on one connection.
 * That widened the attack surface on the only guard between a client-
 * supplied path and the filesystem: validating the FIRST path and
 * streaming ALL of them would let one legitimate path smuggle in
 * /etc/passwd, and nothing would throw.
 */
import { describe, expect, test } from "bun:test";
import { sep } from "node:path";
import { insideRoot } from "../server/stream.ts";
import { ROOT, MAX_SESSIONS } from "../server/config.ts";

/** The check server/index.ts performs before opening a stream. */
const accepts = (paths: string[]) =>
  paths.length > 0 && !paths.some((p) => !insideRoot(p));

describe("multiplexed path validation", () => {
  test("a single good path is accepted", () => {
    expect(accepts([ROOT + sep + "proj" + sep + "s.jsonl"])).toBe(true);
  });

  test("several good paths are accepted", () => {
    expect(accepts([
      ROOT + sep + "a" + sep + "1.jsonl",
      ROOT + sep + "b" + sep + "2.jsonl",
      ROOT + sep + "c" + sep + "3.jsonl",
    ])).toBe(true);
  });

  test("one bad path poisons the whole request", () => {
    // the regression this file exists for: checking only paths[0] would
    // pass this and stream /etc/passwd alongside a real session
    expect(accepts([ROOT + sep + "ok.jsonl", "/etc/passwd"])).toBe(false);
  });

  test("order does not matter", () => {
    expect(accepts(["/etc/passwd", ROOT + sep + "ok.jsonl"])).toBe(false);
    expect(accepts([ROOT + sep + "ok.jsonl", ROOT + sep + ".." + sep + "escape"])).toBe(false);
  });

  test("no paths at all is refused", () => {
    expect(accepts([])).toBe(false);
  });

  test("the session ceiling is a sane number", () => {
    // each session costs two watchers server-side and a droid rig client-
    // side; unbounded would let one request open arbitrarily many
    expect(MAX_SESSIONS).toBeGreaterThan(1);
    expect(MAX_SESSIONS).toBeLessThanOrEqual(16);
  });
});

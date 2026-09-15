/** Regression tests for the bug-scan fixes (backend). */
import { describe, expect, test } from "bun:test";
import { splitTailLines } from "../server/stream.ts";
import { clampLimit } from "../server/sessions.ts";

describe("splitTailLines", () => {
  test("small file: first line is complete, keep it", () => {
    expect(splitTailLines('{"a":1}\n{"b":2}\n', false)).toEqual(['{"a":1}', '{"b":2}', ""]);
  });
  test("truncated tail: first line is cut, drop it", () => {
    expect(splitTailLines('cut-mid-lin\n{"b":2}\n', true)).toEqual(['{"b":2}', ""]);
  });
});

describe("clampLimit", () => {
  test("garbage falls back to default", () => {
    expect(clampLimit("abc")).toBe(40);
    expect(clampLimit(undefined)).toBe(40);
    expect(clampLimit(NaN)).toBe(40);
    expect(clampLimit(null)).toBe(40);
  });
  test("bounds respected", () => {
    expect(clampLimit("10")).toBe(10);
    expect(clampLimit(9999)).toBe(200);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit("7.9")).toBe(7);
  });
});

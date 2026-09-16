/**
 * skyAt() drives how bright the whole display sits, from the wall clock.
 * The failure it exists to prevent is silent: a wall screen at full
 * brightness at 2am is a lamp, not a picture, and nothing throws.
 *
 * Extracted from source the way esc.test.ts does — holotable.js is one
 * browser IIFE with nothing exported.
 */
import { describe, expect, test } from "bun:test";

type Sky = { elev: number[]; light: number; warmth: number };

async function extractSkyAt(): Promise<(h: number) => Sky> {
  const src = await Bun.file("public/holotable.js").text();
  const grab = (needle: string) => {
    const a = src.indexOf(needle);
    if (a < 0) throw new Error(needle + " not found in holotable.js");
    return src.slice(a, src.indexOf("\n  }", a) + 4);
  };
  const sunsStart = src.indexOf("var SUNS = [");
  if (sunsStart < 0) throw new Error("SUNS not found in holotable.js");
  const suns = src.slice(sunsStart, src.indexOf("];", sunsStart) + 2);
  const fn = new Function("h",
    grab("function clamp") + "\n" + suns + "\n" + grab("function skyAt(hours){") +
    "\nreturn skyAt(h);");
  return fn as (h: number) => Sky;
}

describe("skyAt", () => {
  test("midday is the brightest the room gets", async () => {
    const skyAt = await extractSkyAt();
    expect(skyAt(13).light).toBeGreaterThan(0.9);
  });

  test("the small hours are dark but never black", async () => {
    const skyAt = await extractSkyAt();
    // the hologram is its own light source: going to zero would put the
    // droid out entirely, which is a broken display, not a night mode
    for (const h of [0, 2, 3, 23]) {
      expect(skyAt(h).light).toBeLessThan(0.2);
      expect(skyAt(h).light).toBeGreaterThan(0.05);
    }
  });

  test("night is darker than day at every comparison", async () => {
    const skyAt = await extractSkyAt();
    expect(skyAt(2).light).toBeLessThan(skyAt(9).light);
    expect(skyAt(2).light).toBeLessThan(skyAt(12).light);
    expect(skyAt(23).light).toBeLessThan(skyAt(16).light);
  });

  test("light stays in range across a whole day", async () => {
    const skyAt = await extractSkyAt();
    for (let h = 0; h < 24; h += 0.25) {
      const s = skyAt(h);
      expect(s.light).toBeGreaterThanOrEqual(0.12);
      expect(s.light).toBeLessThanOrEqual(1);
      expect(s.warmth).toBeGreaterThanOrEqual(0);
      expect(s.warmth).toBeLessThanOrEqual(1);
      expect(Number.isFinite(s.light)).toBe(true);
    }
  });

  test("the suns are genuinely offset, not one sun drawn twice", async () => {
    const skyAt = await extractSkyAt();
    // the whole point of a binary system: at some hour one is up and the
    // other is down, which is what makes the long double sunset
    const split = [8, 10, 18, 20].some((h) => {
      const e = skyAt(h).elev;
      return (e[0] > 0) !== (e[1] > 0);
    });
    expect(split).toBe(true);
  });

  test("sunset runs long: light lingers after the primary is down", async () => {
    const skyAt = await extractSkyAt();
    const dusk = skyAt(18);
    expect(dusk.elev[0]).toBeLessThanOrEqual(0.01);   // primary at the horizon
    expect(dusk.elev[1]).toBeGreaterThan(0.3);        // the other still up
    expect(dusk.light).toBeGreaterThan(skyAt(22).light);
  });

  test("warmth peaks at the horizon, not at noon", async () => {
    const skyAt = await extractSkyAt();
    // a high sun is white; the colour comes from a low one
    expect(skyAt(18).warmth).toBeGreaterThan(skyAt(13).warmth);
  });

  test("hours outside 0-24 do not produce nonsense", async () => {
    const skyAt = await extractSkyAt();
    for (const h of [-3, 25, 48]) {
      const s = skyAt(h);
      expect(Number.isFinite(s.light)).toBe(true);
      expect(s.light).toBeGreaterThanOrEqual(0.12);
      expect(s.light).toBeLessThanOrEqual(1);
    }
  });
});

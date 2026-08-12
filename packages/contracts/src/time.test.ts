import { describe, expect, it } from "vitest";
import {
  addTime,
  compareTime,
  fromSeconds,
  frameTime,
  normalizeRate,
  rescaleTime,
  toSeconds,
} from "./time.js";

describe("rational time", () => {
  it("normalizes rates and preserves frame-accurate values", () => {
    expect(normalizeRate({ numerator: 60_000, denominator: 2_002 })).toEqual({
      numerator: 30_000,
      denominator: 1_001,
    });
    const time = frameTime(300, { numerator: 30, denominator: 1 });
    expect(toSeconds(time)).toBe(10);
    expect(addTime(time, time)).toEqual(
      frameTime(600, { numerator: 30, denominator: 1 }),
    );
  });

  it("reports rounding when convenience seconds do not land on a frame", () => {
    const result = fromSeconds(1.01, { numerator: 30, denominator: 1 });
    expect(result.time.value).toBe(30);
    expect(result.rounded).toBe(true);
    expect(
      compareTime(
        result.time,
        frameTime(31, { numerator: 30, denominator: 1 }),
      ),
    ).toBe(-1);
  });

  it("rejects invalid seconds", () => {
    expect(() => fromSeconds(-1, { numerator: 30, denominator: 1 })).toThrow(
      RangeError,
    );
    expect(() =>
      fromSeconds(Number.NaN, { numerator: 30, denominator: 1 }),
    ).toThrow(RangeError);
  });

  it("compares and rescales mixed fractional rates with integer arithmetic", () => {
    const tenSecondsAtNtsc = frameTime(300, {
      numerator: 30_000,
      denominator: 1_001,
    });
    const tenSecondsAtFilm = frameTime(240, {
      numerator: 24_000,
      denominator: 1_001,
    });
    expect(compareTime(tenSecondsAtNtsc, tenSecondsAtFilm)).toBe(0);
    expect(
      rescaleTime(tenSecondsAtNtsc, { numerator: 24_000, denominator: 1_001 }),
    ).toEqual({
      time: tenSecondsAtFilm,
      rounded: false,
    });
    const oneNtscFrameAtFilm = rescaleTime(
      frameTime(1, { numerator: 30_000, denominator: 1_001 }),
      { numerator: 24_000, denominator: 1_001 },
    );
    expect(oneNtscFrameAtFilm.time.value).toBe(1);
    expect(oneNtscFrameAtFilm.rounded).toBe(true);
  });
});

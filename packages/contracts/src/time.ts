import { z } from "zod";

export const rationalRateSchema = z
  .object({
    numerator: z.int().positive().max(1_000_000),
    denominator: z.int().positive().max(1_000_000),
  })
  .strict();

export const rationalTimeSchema = z
  .object({
    value: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
    rate: rationalRateSchema,
  })
  .strict();

export const signedRationalTimeSchema = z
  .object({
    value: z.int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
    rate: rationalRateSchema,
  })
  .strict();

export const timeRangeSchema = z
  .object({
    start: rationalTimeSchema,
    duration: rationalTimeSchema,
  })
  .strict();

export type RationalRate = z.infer<typeof rationalRateSchema>;
export type RationalTime = z.infer<typeof rationalTimeSchema>;
export type SignedRationalTime = z.infer<typeof signedRationalTimeSchema>;
export type TimeRange = z.infer<typeof timeRangeSchema>;

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a || 1;
}

export function normalizeRate(rate: RationalRate): RationalRate {
  const divisor = greatestCommonDivisor(rate.numerator, rate.denominator);
  return {
    numerator: rate.numerator / divisor,
    denominator: rate.denominator / divisor,
  };
}

export function frameTime(value: number, rate: RationalRate): RationalTime {
  return rationalTimeSchema.parse({ value, rate: normalizeRate(rate) });
}

export function toSeconds(time: RationalTime): number {
  return (time.value * time.rate.denominator) / time.rate.numerator;
}

export function compareTime(left: RationalTime, right: RationalTime): number {
  const leftScaled =
    BigInt(left.value) *
    BigInt(left.rate.denominator) *
    BigInt(right.rate.numerator);
  const rightScaled =
    BigInt(right.value) *
    BigInt(right.rate.denominator) *
    BigInt(left.rate.numerator);
  return leftScaled === rightScaled ? 0 : leftScaled < rightScaled ? -1 : 1;
}

export function rescaleTime(
  time: RationalTime,
  targetRate: RationalRate,
): { time: RationalTime; rounded: boolean } {
  const normalizedRate = normalizeRate(targetRate);
  const numerator =
    BigInt(time.value) *
    BigInt(time.rate.denominator) *
    BigInt(normalizedRate.numerator);
  const denominator =
    BigInt(time.rate.numerator) * BigInt(normalizedRate.denominator);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const roundedValue = quotient + (remainder * 2n >= denominator ? 1n : 0n);
  if (roundedValue > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Rescaled time exceeds the JSON safe-integer range");
  }
  return {
    time: frameTime(Number(roundedValue), normalizedRate),
    rounded: remainder !== 0n,
  };
}

export function addTime(left: RationalTime, right: RationalTime): RationalTime {
  const leftRate = normalizeRate(left.rate);
  const rightRate = normalizeRate(right.rate);
  if (
    leftRate.numerator === rightRate.numerator &&
    leftRate.denominator === rightRate.denominator
  ) {
    return frameTime(left.value + right.value, leftRate);
  }

  const rescaled = rescaleTime(right, leftRate);
  return frameTime(left.value + rescaled.time.value, leftRate);
}

export function fromSeconds(
  seconds: number,
  rate: RationalRate,
): { time: RationalTime; rounded: boolean; requestedSeconds: number } {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError("Seconds must be a finite, non-negative number");
  }
  const normalizedRate = normalizeRate(rate);
  const exactValue =
    (seconds * normalizedRate.numerator) / normalizedRate.denominator;
  const value = Math.round(exactValue);
  return {
    time: frameTime(value, normalizedRate),
    rounded: Math.abs(exactValue - value) > Number.EPSILON,
    requestedSeconds: seconds,
  };
}

export function sameRate(left: RationalTime, right: RationalTime): boolean {
  const a = normalizeRate(left.rate);
  const b = normalizeRate(right.rate);
  return a.numerator === b.numerator && a.denominator === b.denominator;
}

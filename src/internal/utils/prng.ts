import { canonicalSerialize } from "./canonical.ts";
import { computeSHA256 } from "./crypto.ts";

export function createPrng(seed32: number): () => number {
  let state = seed32 >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function deriveSeed32(input: Uint8Array | string): number {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = computeSHA256(bytes);
  return (
    digest[0]! |
    (digest[1]! << 8) |
    (digest[2]! << 16) |
    (digest[3]! << 24)
  ) >>> 0;
}

export function deriveDeterministicSeedHex(value: unknown): string {
  const payload = new TextEncoder().encode(canonicalSerialize(value));
  return Array.from(computeSHA256(payload))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function createExecutionSeed(): number {
  const seed = new Uint32Array(1);
  crypto.getRandomValues(seed);
  return seed[0]!;
}

export function withScopedMathRandom<T>(prng: () => number, fn: () => T): T {
  const originalRandom = Math.random;
  Math.random = prng;
  try {
    return fn();
  } finally {
    Math.random = originalRandom;
  }
}

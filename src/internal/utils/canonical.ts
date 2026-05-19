import { computeSHA256Hex } from "./crypto.ts";

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

export function canonicalSerialize(value: unknown): string {
  return JSON.stringify(toCanonicalValue(value));
}

export function fingerprintCanonicalValue(value: unknown): string {
  return computeSHA256Hex(new TextEncoder().encode(canonicalSerialize(value)));
}

function toCanonicalValue(value: unknown): CanonicalValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    if (Number.isNaN(value)) return { $number: "NaN" };
    if (!Number.isFinite(value)) {
      return { $number: value > 0 ? "Infinity" : "-Infinity" };
    }
    return value;
  }

  if (typeof value === "bigint") {
    return { $bigint: value.toString() };
  }

  if (value instanceof Uint8Array) {
    return {
      $bytes: Array.from(value),
    };
  }

  if (Array.isArray(value)) {
    return value.map((entry) =>
      entry === undefined ? { $undefined: true } : toCanonicalValue(entry)
    );
  }

  if (value instanceof Date) {
    return { $date: value.toISOString() };
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, toCanonicalValue(entry)] as const);
    return Object.fromEntries(entries);
  }

  if (value === undefined) {
    return { $undefined: true };
  }

  return String(value);
}

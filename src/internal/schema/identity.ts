import {
  BOND_FIELD_ID_MAX,
  BOND_FIELD_ID_MIN,
  CORE_FIELD_ID_MAX,
  CORE_FIELD_ID_MIN,
  TEXTURE_FIELD_ID_MAX,
  TEXTURE_FIELD_ID_MIN,
} from "../compat/seed-format.ts";
import { computeCRC32, computeSHA256Hex, createSha256UuidV8 } from "../utils/crypto.ts";
import { SchemaDeclarationError } from "../utils/errors.ts";

export interface HiddenIds {
  fieldIds: Record<string, number>;
  relationIds: Record<string, number>;
}

const DOMAIN_UUID_NAMESPACE = "cultivar-js:domain-uuid";
const textEncoder = new TextEncoder();

export function domainUuidFromStableId(stableId: string): string {
  // This is a deterministic identifier derivation, not a security boundary.
  // UUIDs only carry 128 bits, so we fold the full SHA-256 digest into a UUIDv8
  // instead of truncating the first 16 bytes and labelling it as a random UUID.
  return createSha256UuidV8(
    textEncoder.encode(`${DOMAIN_UUID_NAMESPACE}\u0000${stableId}`),
  );
}

export function legacyDomainUuidFromStableId(stableId: string): string {
  const hex = computeSHA256Hex(textEncoder.encode(stableId)).slice(0, 32);
  const bytes = hex.match(/.{1,2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? [];
  if (bytes.length !== 16) {
    throw new SchemaDeclarationError(`Failed to derive UUID bytes for ${stableId}`);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const normalized = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20)}`;
}

export function acceptedDomainUuidsFromStableId(stableId: string): string[] {
  const current = domainUuidFromStableId(stableId);
  const legacy = legacyDomainUuidFromStableId(stableId);
  return current === legacy ? [current] : [current, legacy];
}

export function createIdFactory(
  stableId: string,
  version: string,
): {
  fieldId(name: string, tier: "core" | "texture"): number;
  relationId(name: string): number;
} {
  const fieldCollisions = new Set<number>();
  const relationCollisions = new Set<number>();
  const fieldCache = new Map<string, number>();
  const relationCache = new Map<string, number>();

  return {
    fieldId(name, tier) {
      const key = `${tier}:${name}`;
      const cached = fieldCache.get(key);
      if (cached !== undefined) return cached;
      const range =
        tier === "core"
          ? [CORE_FIELD_ID_MIN, CORE_FIELD_ID_MAX]
          : [TEXTURE_FIELD_ID_MIN, TEXTURE_FIELD_ID_MAX];
      const id = allocateInRange(
        `field:${stableId}:${version}:${tier}:${name}`,
        range[0],
        range[1],
        fieldCollisions,
      );
      fieldCache.set(key, id);
      return id;
    },

    relationId(name) {
      const cached = relationCache.get(name);
      if (cached !== undefined) return cached;
      const id = allocateInRange(
        `relation:${stableId}:${version}:${name}`,
        BOND_FIELD_ID_MIN,
        BOND_FIELD_ID_MAX,
        relationCollisions,
      );
      relationCache.set(name, id);
      return id;
    },
  };
}

function allocateInRange(
  source: string,
  min: number,
  max: number,
  taken: Set<number>,
): number {
  const span = max - min + 1;
  let candidate = min + (computeCRC32(new TextEncoder().encode(source)) % span);
  while (taken.has(candidate)) {
    candidate += 1;
    if (candidate > max) {
      candidate = min;
    }
  }
  taken.add(candidate);
  return candidate;
}

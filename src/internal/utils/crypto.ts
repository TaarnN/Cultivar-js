import { createHash, randomUUID as nodeRandomUUID } from "node:crypto";

const CRC32_TABLE = buildCrc32Table();
const UUID_BYTE_LENGTH = 16;

export function computeSHA256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(data).digest());
}

export function computeSHA256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function computeCRC32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createSha256UuidV8(data: Uint8Array): string {
  const hash = computeSHA256(data);
  if (hash.byteLength < UUID_BYTE_LENGTH * 2) {
    throw new Error(`Expected at least ${UUID_BYTE_LENGTH * 2} hash bytes, received ${hash.byteLength}`);
  }

  // UUIDs can only carry 128 bits, so fold both halves of the SHA-256 digest
  // together instead of truncating to the first 16 bytes.
  const bytes = new Uint8Array(UUID_BYTE_LENGTH);
  for (let index = 0; index < UUID_BYTE_LENGTH; index += 1) {
    bytes[index] = hash[index]! ^ hash[index + UUID_BYTE_LENGTH]!;
  }

  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  return formatUuid(bytes);
}

export function createRuntimeUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return nodeRandomUUID();
}

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 1) === 1 ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    table[i] = crc >>> 0;
  }
  return table;
}

function formatUuid(bytes: Uint8Array): string {
  if (bytes.byteLength !== UUID_BYTE_LENGTH) {
    throw new Error(`Expected ${UUID_BYTE_LENGTH} UUID bytes, received ${bytes.byteLength}`);
  }

  const normalized = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20)}`;
}

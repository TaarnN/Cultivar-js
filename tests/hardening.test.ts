import { describe, expect, test } from "bun:test";

import {
  InteractiveIOUnavailableError,
  SchemaDeclarationError,
  SeedCorruptedError,
  UnsupportedSeedVersionError,
} from "../src/errors.ts";
import { seed } from "../src/index.ts";
import { normalizeMeta } from "../src/internal/schema/discovery.ts";
import {
  domainUuidFromStableId,
  legacyDomainUuidFromStableId,
} from "../src/internal/schema/identity.ts";
import { createExploratorySeed } from "../src/internal/seed/mutation.ts";
import { parseSeedBytes, serializeSeed } from "../src/internal/seed/binary.ts";
import { snapshotToManifest } from "../src/internal/seed/snapshot.ts";
import { createWrapperState } from "../src/internal/runtime/state.ts";
import { invokeSeededFunction } from "../src/internal/runtime/invocation.ts";
import { FieldTypeTag, RelationshipType, SEED_MAGIC, SEED_VERSION_V2, type Seed } from "../src/internal/compat/seed-format.ts";
import type { DomainManifest } from "../src/internal/compat/domain.ts";
import { computeCRC32, computeSHA256, computeSHA256Hex } from "../src/internal/utils/crypto.ts";

type PromptFn = (message?: string) => string | null;
const TEST_DOMAIN_UUID = "11111111-1111-4111-8111-111111111111";

function runtimeGlobal(): typeof globalThis & { prompt: PromptFn | undefined } {
  return globalThis as typeof globalThis & { prompt: PromptFn | undefined };
}

describe("hardening", () => {
  test("matches checksum golden vectors", () => {
    const empty = new TextEncoder().encode("");
    const classic = new TextEncoder().encode("123456789");

    expect(computeSHA256Hex(empty)).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(computeSHA256Hex(classic)).toBe(
      "15e2b0d3c33891ebb0f1ef609ec419420c20e320ce94c65fbc8c3312448eb225",
    );
    expect(computeCRC32(empty)).toBe(0);
    expect(computeCRC32(classic)).toBe(0xcbf43926);
  });

  test("derives deterministic UUIDv8 domain ids and preserves legacy import compatibility", async () => {
    const stableId = "demo.domain-uuid";
    const currentDomainUuid = domainUuidFromStableId(stableId);
    const legacyDomainUuid = legacyDomainUuidFromStableId(stableId);

    expect(currentDomainUuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );

    const normalized = normalizeMeta({ id: stableId, version: "1" });
    expect(normalized.domainUuid).toBe(currentDomainUuid);
    expect(normalized.acceptedDomainUuids).toContain(currentDomainUuid);
    expect(normalized.acceptedDomainUuids).toContain(legacyDomainUuid);

    const wrapped = seed(
      async ($) => $("value", { type: "u8", range: [1, 5], default: 3 }),
      { id: stableId, version: "1" },
    );

    await wrapped();
    const legacySeed = parseSeedBytes(wrapped.exportBytes());
    legacySeed.header.domainId = legacyDomainUuid;

    const mirror = seed(
      async ($) => $("value", { type: "u8", range: [1, 5], default: 3 }),
      { id: stableId, version: "1" },
    );

    mirror.importBytes(serializeSeed(legacySeed));
    await expect(mirror()).resolves.toBe(3);
  });

  test("assigns portable ephemeral runtime ids", () => {
    const normalized = normalizeMeta();

    expect(normalized.runtimeId).toMatch(
      /^ephemeral:[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(normalized.acceptedDomainUuids).toEqual([normalized.domainUuid]);
    expect(normalized.domainUuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  test("schema fingerprints stay stable across declaration order", async () => {
    const left = seed(
      async ($) => {
        $("alpha", { type: "f64", range: [0, 1], default: 0.2 });
        $("beta", { type: "u8", range: [1, 4], default: 2, tier: "texture" });
        return "left";
      },
      { id: "demo.schema-fingerprint", version: "1" },
    );
    const right = seed(
      async ($) => {
        $("beta", { type: "u8", range: [1, 4], default: 2, tier: "texture" });
        $("alpha", { type: "f64", range: [0, 1], default: 0.2 });
        return "right";
      },
      { id: "demo.schema-fingerprint", version: "1" },
    );

    await left();
    await right();

    expect(left.schema({ internal: true })?.internal?.schemaFingerprint).toBe(
      right.schema({ internal: true })?.internal?.schemaFingerprint,
    );
  });

  test("surfaces typed binary errors", async () => {
    const wrapped = seed(
      async ($) => $("value", { type: "u8", range: [1, 5], default: 3 }),
      { id: "demo.parse-errors", version: "1" },
    );

    await wrapped();
    const bytes = wrapped.exportBytes();

    const brokenVersion = new Uint8Array(bytes);
    brokenVersion[4] = 0xff;
    brokenVersion[5] = 0xff;
    const contentPart = brokenVersion.slice(0, brokenVersion.length - 32);
    contentPart.fill(0, 44, 48);
    new DataView(contentPart.buffer, contentPart.byteOffset, contentPart.byteLength)
      .setUint32(44, computeCRC32(contentPart), false);
    brokenVersion.set(contentPart, 0);
    brokenVersion.set(computeSHA256(contentPart), contentPart.length);
    expect(() => parseSeedBytes(brokenVersion)).toThrow(UnsupportedSeedVersionError);

    const corrupted = new Uint8Array(bytes);
    corrupted[20] = corrupted[20]! ^ 0xff;
    expect(() => parseSeedBytes(corrupted)).toThrow(SeedCorruptedError);
  });

  test("human tuning without IO support throws a dedicated interactive error", async () => {
    const runtime = runtimeGlobal();
    const previousDescriptor = Object.getOwnPropertyDescriptor(runtime, "prompt");
    Object.defineProperty(runtime, "prompt", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    try {
      const wrapped = seed(
        async ($) => $("value", { type: "u8", range: [1, 5], default: 3 }),
        { id: "demo.interactive-error", version: "1" },
      );

      await expect(
        wrapped.tune({ generations: 1, batchSize: 1 }),
      ).rejects.toThrow(InteractiveIOUnavailableError);
    } finally {
      if (previousDescriptor) {
        Object.defineProperty(runtime, "prompt", previousDescriptor);
      } else {
        Reflect.deleteProperty(runtime, "prompt");
      }
    }
  });

  test("normalizes valid conditional blend conditions through manifest generation", async () => {
    const state = createWrapperState(
      async ($) => {
        $("temperature", { type: "f64", range: [0, 1], default: 0.5 });
        $("palette", { type: "f64", range: [0, 1], default: 0.25, tier: "texture" });
        $.rel("temperature", "palette", {
          kind: "conditional_blend",
          params: {
            conditions: [
              { field: "temperature", op: ">=", value: 0.4 },
              { field: "palette", op: "in", value: ["warm", "cool"] },
            ],
          },
        });
        return "ok";
      },
      normalizeMeta({ id: "demo.conditions", version: "1" }),
    );

    const run = await invokeSeededFunction(state, []);
    const manifest = snapshotToManifest(run.schema);
    const params = manifest.bondFields[0]?.defaultParameters;

    expect(params?.type).toBeDefined();
    if (!params || params.type !== RelationshipType.CONDITIONAL_BLEND) {
      throw new Error("Expected conditional blend parameters");
    }
    expect(params.conditions).toEqual([
      { field: "temperature", op: ">=", value: 0.4 },
      { field: "palette", op: "in", value: ["warm", "cool"] },
    ]);
  });

  test("rejects invalid conditional blend conditions predictably", async () => {
    const state = createWrapperState(
      async ($) => {
        $("temperature", { type: "f64", range: [0, 1], default: 0.5 });
        $("palette", { type: "f64", range: [0, 1], default: 0.25, tier: "texture" });
        $.rel("temperature", "palette", {
          kind: "conditional_blend",
          params: {
            conditions: [{ field: "temperature", op: "???", value: 0.4 }],
          },
        });
        return "ok";
      },
      normalizeMeta({ id: "demo.conditions.invalid", version: "1" }),
    );

    await expect(invokeSeededFunction(state, [])).rejects.toThrow(SchemaDeclarationError);
  });

  test("materializes sane non-numeric defaults for exploratory texture growth", () => {
    const baseSeed = createBaseSeed();

    const boolSeed = createExploratorySeed(
      stripTextureFields(baseSeed),
      buildTextureManifest("demo.bool", {
        id: 0x010001,
        name: "enabled",
        typeTag: FieldTypeTag.BOOL,
        semantics: "toggle",
      }),
      () => 0.25,
    );
    expect(boolSeed.textureFields[0]?.value).toBe(false);

    const stringSeed = createExploratorySeed(
      stripTextureFields(baseSeed),
      buildTextureManifest("demo.string", {
        id: 0x010002,
        name: "label",
        typeTag: FieldTypeTag.STRING,
        semantics: "label",
      }),
      () => 0.25,
    );
    expect(stringSeed.textureFields[0]?.value).toBe("");

    const bytesSeed = createExploratorySeed(
      stripTextureFields(baseSeed),
      buildTextureManifest("demo.bytes", {
        id: 0x010003,
        name: "blob",
        typeTag: FieldTypeTag.BYTES,
        semantics: "blob",
      }),
      () => 0.25,
    );
    expect(bytesSeed.textureFields[0]?.value).toBeInstanceOf(Uint8Array);
    expect((bytesSeed.textureFields[0]?.value as Uint8Array).byteLength).toBe(0);

    const arraySeed = createExploratorySeed(
      stripTextureFields(baseSeed),
      buildTextureManifest("demo.array", {
        id: 0x010004,
        name: "items",
        typeTag: FieldTypeTag.ARRAY,
        elementTypeTag: FieldTypeTag.FLOAT32,
        semantics: "items",
      }),
      () => 0.25,
    );
    expect(arraySeed.textureFields[0]?.value).toEqual({
      kind: "array",
      elementTypeTag: FieldTypeTag.FLOAT32,
      items: [],
    });

    const compositeSeed = createExploratorySeed(
      stripTextureFields(baseSeed),
      buildTextureManifest("demo.composite", {
        id: 0x010005,
        name: "profile",
        typeTag: FieldTypeTag.COMPOSITE,
        semantics: "profile",
      }),
      () => 0.25,
    );
    expect(compositeSeed.textureFields[0]?.value).toEqual({
      kind: "composite",
      schemaId: 0,
      fields: [],
    });
  });

  test("throws when exploratory numeric fields have no default or bounds", () => {
    const baseSeed = createBaseSeed();

    expect(() =>
      createExploratorySeed(
        stripTextureFields(baseSeed),
        buildTextureManifest("demo.numeric-missing-bounds", {
          id: 0x010006,
          name: "weight",
          typeTag: FieldTypeTag.FLOAT32,
          semantics: "weight",
        }),
        () => 0.25,
      ),
    ).toThrow(SchemaDeclarationError);
  });
});

function createBaseSeed(): Seed {
  return parseSeedBytes(
    serializeSeed({
      header: {
        magic: SEED_MAGIC,
        version: SEED_VERSION_V2,
        domainId: TEST_DOMAIN_UUID,
        generation: 0,
        entropyBudget: 64,
        coreSize: 0,
        textureSize: 0,
        bondSize: 0,
        flags: 0,
        crc32: 0,
        domainSchemaVersion: "1",
      },
      coreFields: [],
      textureFields: [],
      bondFields: [],
      contentHash: "",
    }),
  );
}

function stripTextureFields(seed: Seed): Seed {
  return parseSeedBytes(
    serializeMinimalSeed({
      ...seed,
      textureFields: [],
      contentHash: "",
    }),
  );
}

function buildTextureManifest(
  id: string,
  field: DomainManifest["textureFields"][number],
): DomainManifest {
  return {
    id: TEST_DOMAIN_UUID,
    name: id,
    version: "1",
    description: `${id} test manifest`,
    determinism: "nondeterministic",
    entropyBudgetDefault: 64,
    coreFields: [],
    textureFields: [{ growthWeight: 1, ...field }],
    bondFields: [],
    constraints: [],
    knowledge: {
      description: "test",
      defaultBehavior: "test",
    },
  };
}

function serializeMinimalSeed(seed: Seed): Uint8Array {
  return serializeSeed(seed);
}

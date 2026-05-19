import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { seed } from "../src/index.ts";
import { parseSeedBytes, wrapSeed, unwrapSeed } from "../src/internal/seed/binary.ts";
import { createIdFactory, domainUuidFromStableId } from "../src/internal/schema/identity.ts";

describe("binary compatibility", () => {
  test("persists legacy-compatible seeds through files and bytes", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cultivar-js-binary-"));
    const seedPath = join(tempDir, "binary.seed");

    try {
      const wrapped = seed(
        async ($) => {
          const gain = $("gain", {
            type: "f64",
            range: [0, 1],
            default: 0.25,
          });
          const mode = $("mode", {
            type: "u8",
            range: [1, 4],
            default: 2,
            tier: "texture",
          });
          return { gain, mode };
        },
        { id: "demo.binary", version: "7" },
      );

      await wrapped();
      const exportedBytes = wrapped.exportBytes();
      await wrapped.save(seedPath);
      const savedBytes = new Uint8Array(readFileSync(seedPath));
      expect(Array.from(savedBytes)).toEqual(Array.from(exportedBytes));

      const parsed = parseSeedBytes(exportedBytes);
      expect(parsed.header.version).toBe(0x0002);
      expect(parsed.header.domainId).toBe(domainUuidFromStableId("demo.binary"));
      expect(parsed.header.domainSchemaVersion).toBe("7");

      const wrappedString = wrapSeed(parsed);
      const unwrapped = unwrapSeed(wrappedString);
      expect(unwrapped.contentHash).toBe(parsed.contentHash);

      const mirror = seed(
        async ($) => {
          const gain = $("gain", {
            type: "f64",
            range: [0, 1],
            default: 0.25,
          });
          const mode = $("mode", {
            type: "u8",
            range: [1, 4],
            default: 2,
            tier: "texture",
          });
          return { gain, mode };
        },
        { id: "demo.binary", version: "7" },
      );

      mirror.importBytes(exportedBytes);
      expect(await mirror()).toEqual({ gain: 0.25, mode: 2 });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("keeps hidden field ids stable for the same meta and names", () => {
    const idsA = createIdFactory("demo.identity", "1");
    const idsB = createIdFactory("demo.identity", "1");

    expect(idsA.fieldId("gain", "core")).toBe(idsB.fieldId("gain", "core"));
    expect(idsA.fieldId("mode", "texture")).toBe(idsB.fieldId("mode", "texture"));
    expect(idsA.relationId("gain->mode")).toBe(idsB.relationId("gain->mode"));
  });
});

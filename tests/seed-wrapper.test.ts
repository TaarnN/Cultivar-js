import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { seed } from "../src/index.ts";
import { parseSeedBytes, serializeSeed } from "../src/internal/seed/binary.ts";

describe("seed wrapper", () => {
  test("discovers schema, supports import/export bytes, and keeps direct calls sticky", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cultivar-js-wrapper-"));
    const seedPath = join(tempDir, "mix.seed");

    try {
      const mix = seed(
        async ($, input: string) => {
          const emphasis = $("emphasis", {
            type: "f64",
            range: [0, 1],
            default: 0.4,
          });
          const repetition = $("repetition", {
            type: "u8",
            range: [1, 5],
            default: 2,
            tier: "texture",
          });
          return `${input}:${emphasis.toFixed(2)}:${repetition}`;
        },
        { id: "demo.mix", version: "1" },
      );

      expect(mix.schema()).toBeNull();
      const first = await mix("hello");
      expect(first).toBe("hello:0.40:2");
      expect(mix.seed.values).toEqual({
        emphasis: 0.4,
        repetition: 2,
      });
      expect(mix.seed.meta?.generation).toBe(0);
      expect(mix.schema()?.meta.id).toBe("demo.mix");

      const descriptor = mix.schema({ internal: true });
      const emphasisId = descriptor?.internal?.params.find((param) => param.name === "emphasis")?.fieldId;
      const repetitionId = descriptor?.internal?.params.find((param) => param.name === "repetition")?.fieldId;
      expect(emphasisId).toBeDefined();
      expect(repetitionId).toBeDefined();

      const modified = parseSeedBytes(mix.exportBytes());
      const emphasisField = modified.coreFields.find((field) => field.id === emphasisId);
      const repetitionField = modified.textureFields.find((field) => field.id === repetitionId);
      if (!emphasisField || !repetitionField) {
        throw new Error("Expected emphasis and repetition fields to exist in the exported seed");
      }
      emphasisField.value = 0.9;
      repetitionField.value = 4;
      const modifiedBytes = serializeSeed(modified);

      mix.importBytes(modifiedBytes);
      expect(mix.seed.values).toEqual({
        emphasis: 0.9,
        repetition: 4,
      });

      const replay = await mix("hello");
      expect(replay).toBe("hello:0.90:4");
      const stickyReplay = await mix("hello");
      expect(stickyReplay).toBe(replay);

      writeFileSync(seedPath, modifiedBytes);
      mix.reset();
      expect(mix.seed.values).toBeNull();
      expect(mix.schema()).not.toBeNull();

      const loadedReplay = await mix.load(seedPath, "hello");
      expect(loadedReplay).toBe("hello:0.90:4");
      expect(mix.seed.meta?.hash).toBeDefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("detects schema drift and asks for a version bump", async () => {
    let expanded = false;
    const wrapped = seed(
      async ($) => {
        const value = $("value", {
          type: "f64",
          range: expanded ? [0, 2] : [0, 1],
          default: 0.5,
        });
        return value;
      },
      { id: "demo.schema", version: "1" },
    );

    await wrapped();
    expanded = true;
    await expect(wrapped()).rejects.toThrow(/bump meta\.version/i);
  });

  test("reset all clears the frozen schema and allows rediscovery", async () => {
    let max = 1;
    const wrapped = seed(
      async ($) => {
        const value = $("value", {
          type: "f64",
          range: [0, max],
          default: 0.5,
        });
        return value;
      },
      { id: "demo.reset", version: "1" },
    );

    await wrapped();
    expect(wrapped.schema()?.params[0]?.range?.[1]).toBe(1);

    wrapped.reset("all");
    expect(wrapped.schema()).toBeNull();

    max = 2;
    await wrapped();
    expect(wrapped.schema()?.params[0]?.range?.[1]).toBe(2);
  });

  test("warn checks do not reject direct execution", async () => {
    const wrapped = seed(
      async ($) => {
        const value = $("value", {
          type: "u8",
          range: [1, 5],
          default: 3,
        });
        await $.check(
          "warn-only",
          () => false,
          { enforcement: "warn", message: "soft warning" },
        );
        return value;
      },
      { id: "demo.warn", version: "1" },
    );

    await expect(wrapped()).resolves.toBe(3);
  });

  test("blocks stable byte and file persistence for ephemeral wrappers", async () => {
    const wrapped = seed(async ($) => {
      const value = $("value", {
        type: "u8",
        range: [1, 5],
        default: 3,
      });
      return value;
    });

    await wrapped();
    expect(() => wrapped.exportBytes()).toThrow(/ephemeral/i);
    await expect(wrapped.save("./ephemeral.seed")).rejects.toThrow(/ephemeral/i);
  });
});

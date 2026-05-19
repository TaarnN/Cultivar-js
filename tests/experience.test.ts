import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { seed } from "../src/index.ts";
import { parseSeedBytes } from "../src/internal/seed/binary.ts";

describe("experience and habits", () => {
  test("captures all survivors for auto selection and persists objective vectors", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cultivar-js-experience-auto-"));
    const experiencePath = join(tempDir, "experience.jsonl");

    try {
      const wrapped = seed(
        async ($) => {
          const value = $("value", { type: "f64", range: [0, 10], default: 5 });
          const texture = $("texture", {
            type: "f64",
            range: [0, 1],
            default: 0.5,
            tier: "texture",
          });
          return { total: value + texture, value, texture };
        },
        { id: "demo.experience.auto", version: "1" },
      );

      const result = await wrapped.tune({
        generations: 1,
        batchSize: 4,
        selector: "auto",
        objectives: (output) => ({
          quality: Number(output.total.toFixed(6)),
          restraint: Number((10 - output.value).toFixed(6)),
        }),
        preference: { quality: 1, restraint: 0.05 },
        experience: { path: experiencePath },
      });

      const records = readJsonl(experiencePath);
      expect(records).toHaveLength(result.history[0]?.survivorCount ?? 0);
      expect(records.filter((record) => record.marks.includes("selected"))).toHaveLength(1);
      expect(records.some((record) => record.marks.includes("auto-selected"))).toBe(true);
      expect(records.some((record) => record.marks.includes("rejected"))).toBe(true);
      expect(records.every((record) => record.objectives?.quality !== undefined)).toBe(true);
      expect(result.score).toBeDefined();
      expect(result.objectives?.quality).toBeDefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("requires a preference profile for objective-only auto selection", async () => {
    const wrapped = seed(
      async ($) => {
        const value = $("value", { type: "f64", range: [0, 10], default: 5 });
        return { value };
      },
      { id: "demo.experience.preference", version: "1" },
    );

    await expect(
      wrapped.tune({
        generations: 1,
        batchSize: 2,
        selector: "auto",
        objectives: (output) => ({ quality: output.value }),
      }),
    ).rejects.toThrow(/preference/i);
  });

  test("shows objective vectors during human selection and stays side-effect free when experience is disabled", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cultivar-js-experience-human-"));
    const experiencePath = join(tempDir, "experience.jsonl");
    const lines: string[] = [];

    try {
      const wrapped = seed(
        async ($) => {
          const value = $("value", { type: "f64", range: [0, 10], default: 5 });
          return { value, summary: `value=${value.toFixed(2)}` };
        },
        { id: "demo.experience.human", version: "1" },
      );

      await wrapped.tune({
        generations: 1,
        batchSize: 2,
        objectives: (output) => ({ clarity: Number(output.value.toFixed(3)) }),
        preview: (output) => output.summary,
        io: {
          prompt: () => "0",
          print: (line) => lines.push(line),
          color: false,
        },
      });

      expect(lines.some((line) => line.includes("objectives=clarity="))).toBe(true);
      expect(existsSync(experiencePath)).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("captures custom selector winners without auto or human marks", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cultivar-js-experience-custom-"));
    const experiencePath = join(tempDir, "experience.jsonl");

    try {
      const wrapped = seed(
        async ($) => {
          const value = $("value", { type: "f64", range: [0, 10], default: 5 });
          return value;
        },
        { id: "demo.experience.custom", version: "1" },
      );

      await wrapped.tune({
        generations: 1,
        batchSize: 3,
        score: (output) => output,
        selector: (candidates) => candidates[candidates.length - 1]?.position ?? 0,
        experience: { path: experiencePath },
      });

      const records = readJsonl(experiencePath);
      const selected = records.find((record) => record.marks.includes("selected"));
      expect(selected).toBeDefined();
      expect(selected?.marks.includes("auto-selected")).toBe(false);
      expect(selected?.marks.includes("human-selected")).toBe(false);
      expect(records.some((record) => record.marks.includes("rejected"))).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("records CLI saves, human selections, and surfaces active habits in settings/current", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cultivar-js-experience-cli-"));
    const experiencePath = join(tempDir, "experience.jsonl");
    const savedSeedPath = join(tempDir, "picked.seed");
    const lines: string[] = [];
    const habitTrainingRadius = {
      coreMutationRate: 1,
      coreMutationMagnitude: 0.8,
      textureGrowthCount: 0,
      textureEditRate: 0,
      textureEditMagnitude: 0,
      bondGrowthCount: 0,
      bondEditRate: 0,
    } as const;

    try {
      const buildWrapped = () =>
        seed(
          async ($) => {
            const value = $("value", { type: "f64", range: [0, 10], default: 10 });
            return { value, summary: `value=${value.toFixed(2)}` };
          },
          { id: "demo.experience.cli", version: "1" },
        );

      for (let round = 0; round < 6; round++) {
        await buildWrapped().tune({
          generations: 1,
          batchSize: 4,
          selector: "auto",
          score: (output) => -output.value,
          radius: habitTrainingRadius,
          experience: { path: experiencePath },
        });
      }

      const wrapped = buildWrapped();
      const answers = ["settings", `save 0 ${savedSeedPath}`, "current", "done 0"];
      await wrapped.tuneCli({
        generations: 1,
        batchSize: 3,
        preview: (output) => output.summary,
        experience: { path: experiencePath },
        io: {
          prompt: () => answers.shift() ?? "done",
          print: (line) => lines.push(line),
          color: false,
        },
      });

      const records = readJsonl(experiencePath);
      expect(records.some((record) => record.marks.includes("saved"))).toBe(true);
      expect(records.some((record) => record.marks.includes("human-selected"))).toBe(true);
      expect(lines.some((line) => line.includes("activeHabits:"))).toBe(true);
      expect(lines.some((line) => line.includes("active habits:"))).toBe(true);
      expect(readFileSync(savedSeedPath).byteLength).toBeGreaterThan(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("derived habits bias later candidates without changing the seed binary format", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cultivar-js-habits-"));
    const experiencePath = join(tempDir, "experience.jsonl");
    const radius = {
      coreMutationRate: 1,
      coreMutationMagnitude: 0.8,
      textureGrowthCount: 0,
      textureEditRate: 0,
      textureEditMagnitude: 0,
      bondGrowthCount: 0,
      bondEditRate: 0,
    } as const;

    try {
      const buildWrapped = () =>
        seed(
          async ($) => {
            const value = $("value", { type: "f64", range: [0, 10], default: 5 });
            return { value };
          },
          { id: "demo.habits.bias", version: "1" },
        );

      const trainer = buildWrapped();
      for (let round = 0; round < 4; round++) {
        await trainer.tune({
          generations: 1,
          batchSize: 4,
          selector: "auto",
          score: (output) => output.value,
          radius,
          experience: { path: experiencePath },
        });
      }

      const baselineValues: number[] = [];
      await buildWrapped().tune({
        generations: 1,
        batchSize: 4,
        radius,
        selector: (candidates) => {
          baselineValues.push(
            ...candidates.map((candidate) => candidate.values.value as number),
          );
          return 0;
        },
      });

      const guidedWrapped = buildWrapped();
      await guidedWrapped();
      const beforeBytes = guidedWrapped.exportBytes();
      const guidedValues: number[] = [];
      await guidedWrapped.tune({
        generations: 1,
        batchSize: 4,
        radius,
        selector: (candidates) => {
          guidedValues.push(
            ...candidates.map((candidate) => candidate.values.value as number),
          );
          return 0;
        },
        experience: { path: experiencePath },
      });
      const afterBytes = guidedWrapped.exportBytes();

      expect(average(guidedValues)).toBeGreaterThan(average(baselineValues));
      expect(parseSeedBytes(beforeBytes).header.version).toBe(0x0002);
      expect(parseSeedBytes(afterBytes).header.version).toBe(0x0002);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("child-domain habits bias only the matching sub-domain parameter", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cultivar-js-habits-child-"));
    const experiencePath = join(tempDir, "experience.jsonl");
    const radius = {
      coreMutationRate: 1,
      coreMutationMagnitude: 0.8,
      textureGrowthCount: 0,
      textureEditRate: 0,
      textureEditMagnitude: 0,
      bondGrowthCount: 0,
      bondEditRate: 0,
    } as const;

    try {
      const buildChild = (id: string) =>
        seed(
          async ($) => {
            const value = $("value", { type: "f64", range: [0, 10], default: 2 });
            return value;
          },
          { id, version: "1" },
        );

      const buildWrapped = () =>
        seed(
          async ($) => {
            const left = await $.domain("left", buildChild("demo.habits.child.left"), [] as []);
            const right = await $.domain("right", buildChild("demo.habits.child.right"), [] as []);
            return { left, right };
          },
          { id: "demo.habits.child.parent", version: "1" },
        );

      for (let round = 0; round < 8; round++) {
        await buildWrapped().tune({
          generations: 1,
          batchSize: 8,
          selector: (candidates) => {
            let best = candidates[0]?.position ?? 0;
            let bestValue = Number.NEGATIVE_INFINITY;
            for (const candidate of candidates) {
              const leftValue = Number(candidate.seed.subSeed("left")?.values?.value ?? 0);
              if (leftValue > bestValue) {
                bestValue = leftValue;
                best = candidate.position;
              }
            }
            return best;
          },
          domainFocus: ["left"],
          radius,
          experience: { path: experiencePath },
        });
      }

      const guidedLeft: number[] = [];
      const guidedRight: number[] = [];
      const appliedHabitCounts: number[] = [];
      await buildWrapped().tune({
        generations: 1,
        batchSize: 4,
        radius,
        domainFocus: ["left"],
        selector: (candidates) => {
          for (const candidate of candidates) {
            guidedLeft.push(Number(candidate.seed.subSeed("left")?.values?.value ?? 0));
            guidedRight.push(Number(candidate.seed.subSeed("right")?.values?.value ?? 0));
            appliedHabitCounts.push(
              (((candidate as unknown as { appliedHabitIds?: string[] }).appliedHabitIds) ?? []).length,
            );
          }
          return 0;
        },
        experience: { path: experiencePath },
      });

      expect(average(guidedLeft)).not.toBe(2);
      expect(appliedHabitCounts.every((count) => count > 0)).toBe(true);
      expect(average(guidedRight)).toBe(2);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

function readJsonl(path: string): Array<Record<string, any>> {
  const text = readFileSync(path, "utf8");
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

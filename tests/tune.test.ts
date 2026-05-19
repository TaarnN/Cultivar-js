import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { seed } from "../src/index.ts";

describe("tuning", () => {
  test("requires a score function for selector:auto", async () => {
    const wrapped = seed(
      async ($) => $("value", { type: "f64", range: [0, 10], default: 5 }),
      { id: "demo.auto", version: "1" },
    );

    await expect(
      wrapped.tune({
        selector: "auto",
      }),
    ).rejects.toThrow(/requires a score function/i);
  });

  test("supports the shorthand tune(scoreFn, options) form", async () => {
    const wrapped = seed(
      async ($) => {
        const value = $("value", {
          type: "f64",
          range: [0, 10],
          default: 5,
        });
        const texture = $("texture", {
          type: "f64",
          range: [0, 1],
          default: 0.5,
          tier: "texture",
        });
        return Number((value + texture).toFixed(6));
      },
      { id: "demo.shorthand", version: "1" },
    );

    const result = await wrapped.tune(
      (output) => output,
      {
        generations: 1,
        batchSize: 3,
      },
    );

    expect(result.history).toHaveLength(1);
    expect(result.history[0]?.selectedPosition).toBeGreaterThanOrEqual(0);
    expect(result.history[0]?.attemptedBatchSize).toBe(3);
    expect(result.history[0]?.survivorCount).toBeGreaterThan(0);
    expect(wrapped.seed.meta?.hash).toBe(result.seed.meta?.hash);
  });

  test("uses default human selection when selector is omitted", async () => {
    const wrapped = seed(
      async ($) => {
        const value = $("value", {
          type: "f64",
          range: [0, 10],
          default: 5,
        });
        return { value, summary: `value=${value.toFixed(2)}` };
      },
      { id: "demo.human", version: "1" },
    );

    const result = await wrapped.tune({
      generations: 1,
      batchSize: 2,
      preview: (output) => output.summary,
      io: {
        prompt: () => "0",
        print: () => {},
        color: false,
      },
    });

    expect(result.output.summary).toContain("value=");
    expect(wrapped.seed.meta?.hash).toBe(result.seed.meta?.hash);
    expect(result.history[0]?.selectedPosition).toBe(0);
  });

  test("supports custom selection by survivor position and writes lineage", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cultivar-js-tune-"));
    const lineagePath = join(tempDir, "lineage.jsonl");

    try {
      const wrapped = seed(
        async ($) => {
          const value = $("value", {
            type: "f64",
            range: [0, 10],
            default: 5,
          });
          const texture = $("texture", {
            type: "f64",
            range: [0, 1],
            default: 0.5,
            tier: "texture",
          });
          return Number((value + texture).toFixed(6));
        },
        { id: "demo.custom", version: "1" },
      );

      const result = await wrapped.tune({
        generations: 2,
        batchSize: 4,
        score: (output) => output,
        selector: (candidates) =>
          candidates[candidates.length - 1]?.position ?? 0,
        lineage: { path: lineagePath },
      });

      expect(result.history).toHaveLength(2);
      expect(result.seed.meta?.hash).toBe(wrapped.seed.meta?.hash);
      expect(readFileSync(lineagePath, "utf8").trim().length).toBeGreaterThan(0);
      expect(result.history[0]?.selectedPosition).toBe(result.history[0]!.survivorCount - 1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("supports built-in CLI tuning with save and finish commands", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cultivar-js-cli-tune-"));
    const seedPath = join(tempDir, "picked.seed");
    const answers = [`save 0 ${seedPath}`, "done 0"];

    try {
      const wrapped = seed(
        async ($) => {
          const value = $("value", {
            type: "f64",
            range: [0, 10],
            default: 5,
          });
          const texture = $("texture", {
            type: "f64",
            range: [0, 1],
            default: 0.5,
            tier: "texture",
          });
          return {
            total: Number((value + texture).toFixed(6)),
            summary: `total=${Number((value + texture).toFixed(6)).toFixed(2)}`,
          };
        },
        { id: "demo.cli", version: "1" },
      );

      const result = await wrapped.tuneCli({
        generations: 2,
        batchSize: 3,
        score: (output) => output.total,
        preview: (output) => output.summary,
        io: {
          prompt: () => answers.shift() ?? "done",
          print: () => {},
          color: false,
        },
      });

      expect(result.history).toHaveLength(1);
      expect(result.history[0]?.selectedPosition).toBe(0);
      expect(readFileSync(seedPath).byteLength).toBeGreaterThan(0);
      expect(wrapped.seed.meta?.hash).toBe(result.seed.meta?.hash);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("supports advanced CLI editing and continuing to the next generation", async () => {
    const answers = [
      "advanced",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "2",
      "1",
      "0",
      "done 0",
    ];

    const wrapped = seed(
      async ($) => {
        const value = $("value", {
          type: "f64",
          range: [0, 10],
          default: 5,
        });
        return {
          value,
          summary: `value=${value.toFixed(2)}`,
        };
      },
      { id: "demo.cli.advanced", version: "1" },
    );

    const result = await wrapped.tuneCli({
      generations: 1,
      batchSize: 4,
      preview: (output) => output.summary,
      io: {
        prompt: () => answers.shift() ?? "done",
        print: () => {},
        color: false,
      },
    });

    expect(result.history).toHaveLength(2);
    expect(result.history[0]?.attemptedBatchSize).toBe(2);
    expect(result.history[0]?.selectedPosition).toBe(0);
    expect(result.history[1]?.attemptedBatchSize).toBe(2);
  });

  test("throws a generation exhausted error when every candidate is rejected", async () => {
    let rejectAll = false;
    const wrapped = seed(
      async ($) => {
        const value = $("value", {
          type: "f64",
          range: [0, 10],
          default: 5,
        });
        await $.check(
          "always-fail",
          () => !rejectAll,
          { message: "reject everything", enforcement: "reject" },
        );
        return value;
      },
      { id: "demo.exhausted", version: "1" },
    );

    await wrapped();
    rejectAll = true;

    await expect(
      wrapped.tune({
        generations: 1,
        batchSize: 2,
      }),
    ).rejects.toThrow(/attempted=2, rejected=2, timedOut=0/i);
  });

  test("keeps shorthand auto tuning deterministic across fresh wrappers", async () => {
    const buildWrapped = () =>
      seed(
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
        { id: "demo.deterministic", version: "1" },
      );

    const left = buildWrapped();
    const right = buildWrapped();

    const leftResult = await left.tune(
      (output) => output.length,
      { args: ["hello"], generations: 2, batchSize: 3 },
    );
    const rightResult = await right.tune(
      (output) => output.length,
      { args: ["hello"], generations: 2, batchSize: 3 },
    );

    expect(leftResult.history).toEqual(rightResult.history);
    expect(leftResult.seed.meta?.hash).toBe(rightResult.seed.meta?.hash);
    expect(leftResult.history[0]?.batchAttempt).toBe(0);
    expect(leftResult.history[0]?.sessionSeed).toBeDefined();
  });

  test("treats prompt cancellation as a graceful CLI finish when a current seed exists", async () => {
    const wrapped = seed(
      async ($) => {
        const value = $("value", { type: "f64", range: [0, 10], default: 5 });
        return { value, summary: `value=${value.toFixed(2)}` };
      },
      { id: "demo.cli.cancel", version: "1" },
    );

    await wrapped();
    const currentHash = wrapped.seed.meta?.hash;

    const result = await wrapped.tuneCli({
      generations: 1,
      batchSize: 2,
      preview: (output) => output.summary,
      io: {
        prompt: () => null,
        print: () => {},
        color: false,
      },
    });

    expect(result.history).toHaveLength(0);
    expect(result.seed.meta?.hash).toBe(currentHash);
  });

  test("treats interrupt-like prompt failures as a graceful CLI finish when a current seed exists", async () => {
    const wrapped = seed(
      async ($) => {
        const value = $("value", { type: "f64", range: [0, 10], default: 5 });
        return { value, summary: `value=${value.toFixed(2)}` };
      },
      { id: "demo.cli.sigint", version: "1" },
    );

    await wrapped();
    const currentHash = wrapped.seed.meta?.hash;

    const result = await wrapped.tuneCli({
      generations: 1,
      batchSize: 2,
      preview: (output) => output.summary,
      io: {
        prompt: () => {
          throw new Error("SIGINT");
        },
        print: () => {},
        color: false,
      },
    });

    expect(result.history).toHaveLength(0);
    expect(result.seed.meta?.hash).toBe(currentHash);
  });

  test("materializes an initial current state before the first CLI prompt", async () => {
    const wrapped = seed(
      async ($) => {
        const value = $("value", { type: "f64", range: [0, 10], default: 5 });
        return { value, summary: `value=${value.toFixed(2)}` };
      },
      { id: "demo.cli.abort-empty", version: "1" },
    );

    const result = await wrapped.tuneCli({
      generations: 1,
      batchSize: 2,
      preview: (output) => output.summary,
      io: {
        prompt: () => null,
        print: () => {},
        color: false,
      },
    });

    expect(result.history).toHaveLength(0);
    expect(result.seed.meta?.hash).toBe(wrapped.seed.meta?.hash);
  });

  test("prints a helpful message for malformed mixed-order CLI commands", async () => {
    const lines: string[] = [];
    const answers = ["0 done", "done 0"];

    const wrapped = seed(
      async ($) => {
        const value = $("value", { type: "f64", range: [0, 10], default: 5 });
        return { value, summary: `value=${value.toFixed(2)}` };
      },
      { id: "demo.cli.malformed", version: "1" },
    );

    const result = await wrapped.tuneCli({
      generations: 1,
      batchSize: 2,
      preview: (output) => output.summary,
      io: {
        prompt: () => answers.shift() ?? "done",
        print: (line) => lines.push(line),
        color: false,
      },
    });

    expect(result.history).toHaveLength(1);
    expect(lines.some((line) => line.includes("Mixed-order commands are not supported"))).toBe(true);
  });
});

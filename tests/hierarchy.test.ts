import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { seed } from "../src/index.ts";
import {
  appendTreeToSeedBank,
  ensureSeedBankService,
} from "../src/internal/hierarchical/seed-bank.ts";
import { getWrapperState } from "../src/internal/runtime/state.ts";
import { parseSeedBytes, serializeSeed } from "../src/internal/seed/binary.ts";

describe("hierarchical domains", () => {
  test("keeps child wrappers isolated while exposing domain schema metadata and tree replay", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cultivar-js-hierarchy-"));
    const treePath = join(tempDir, "pipeline.sdtree.json");

    try {
      const buildChild = () =>
        seed(
          async ($, label: string) => {
            const intensity = $("intensity", {
              type: "u8",
              range: [1, 9],
              default: 2,
            });
            $.behavior("confidence", intensity);
            return `${label}:${intensity}`;
          },
          { id: "demo.hierarchy.child", version: "1" },
        );

      const child = buildChild();
      await child("solo");
      const originalChildHash = child.seed.meta?.hash;
      child.importBytes(mutateNumericParam(child, "intensity", 6));
      expect(await child("solo")).toBe("solo:6");
      const stickyChildHash = child.seed.meta?.hash;

      const parent = seed(
        async ($, label: string) => {
          const mood = $("mood", {
            type: "u8",
            range: [1, 5],
            default: 3,
          });
          $.behavior("stability", mood);
          const childOutput = await $.domain("child", child, [label] as [string]);
          $.domainRel("child", "behavior:stability", { kind: "correlate", weight: 0.5 });
          return `${mood}|${childOutput}`;
        },
        { id: "demo.hierarchy.parent", version: "1" },
      );

      const first = await parent("hello");
      expect(first).toBe("3|hello:2");
      expect(child.seed.meta?.hash).toBe(stickyChildHash);
      expect(child.seed.meta?.hash).not.toBe(originalChildHash);

      const schema = parent.schema({ internal: true });
      expect(schema?.domainSlots).toEqual([
        expect.objectContaining({
          name: "child",
          path: "child",
          mode: "single",
        }),
      ]);
      expect(schema?.behaviors).toEqual([
        expect.objectContaining({ name: "stability", valueType: "number" }),
      ]);
      expect(schema?.domainRelations).toEqual([
        expect.objectContaining({
          source: "child",
          target: "behavior:stability",
          kind: "correlate",
        }),
      ]);
      expect(schema?.internal?.domainSlots[0]?.childSchemaFingerprint).toBeDefined();

      expect(parent.listSubSeeds()).toEqual(["child"]);
      const childSeed = parent.subSeed("child");
      expect(childSeed?.path).toBe("child");
      expect(childSeed?.meta?.hash).toBeDefined();

      const childMirror = buildChild();
      childMirror.importBytes(childSeed!.exportBytes());
      await expect(childMirror("hello")).resolves.toBe("hello:2");

      await parent.saveTree(treePath);

      const replay = seed(
        async ($, label: string) => {
          const mood = $("mood", {
            type: "u8",
            range: [1, 5],
            default: 3,
          });
          $.behavior("stability", mood);
          const childOutput = await $.domain("child", buildChild(), [label] as [string]);
          $.domainRel("child", "behavior:stability", { kind: "correlate", weight: 0.5 });
          return `${mood}|${childOutput}`;
        },
        { id: "demo.hierarchy.parent", version: "1" },
      );

      expect(await replay.loadTree(treePath, "hello")).toBe("3|hello:2");
      expect(replay.subSeed("child")?.meta?.hash).toBe(childSeed?.meta?.hash);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("allows sub-seed injection into a parent tree", async () => {
    const buildChild = () =>
      seed(
        async ($, label: string) => {
          const intensity = $("intensity", {
            type: "u8",
            range: [1, 9],
            default: 2,
          });
          return `${label}:${intensity}`;
        },
        { id: "demo.hierarchy.inject.child", version: "1" },
      );

    const child = buildChild();
    await child("solo");
    const injectedBytes = mutateNumericParam(child, "intensity", 7);

    const parent = seed(
      async ($, label: string) => {
        const mood = $("mood", {
          type: "u8",
          range: [1, 5],
          default: 3,
        });
        const childOutput = await $.domain("child", buildChild(), [label] as [string]);
        return `${mood}|${childOutput}`;
      },
      { id: "demo.hierarchy.inject.parent", version: "1" },
    );

    expect(await parent("hello")).toBe("3|hello:2");
    parent.setSubSeed("child", injectedBytes);
    expect(await parent("hello")).toBe("3|hello:7");
    expect(parent.subSeed("child")?.meta?.hash).toBeDefined();
  });

  test("detects parent schema drift when a child schema changes", async () => {
    let expanded = false;
    const child = seed(
      async ($) => {
        const value = $("value", {
          type: "f64",
          range: expanded ? [0, 2] : [0, 1],
          default: 0.5,
        });
        return value;
      },
      { id: "demo.hierarchy.drift.child", version: "1" },
    );

    const parent = seed(
      async ($) => {
        const value = await $.domain("child", child, [] as []);
        return value;
      },
      { id: "demo.hierarchy.drift.parent", version: "1" },
    );

    await parent();
    expanded = true;
    await expect(parent()).rejects.toThrow(/bump meta\.version/i);
  });

  test("tree-aware tuning mutates child seeds and reports mutation traces", async () => {
    const child = seed(
      async ($) => {
        const intensity = $("intensity", {
          type: "u8",
          range: [1, 9],
          default: 2,
        });
        return intensity;
      },
      { id: "demo.hierarchy.tune.child", version: "1" },
    );

    const parent = seed(
      async ($) => {
        return await $.domain("child", child, [] as []);
      },
      { id: "demo.hierarchy.tune.parent", version: "1" },
    );

    expect(await parent()).toBe(2);
    const beforeChildHash = parent.subSeed("child")?.meta?.hash;
    const generations: Array<{
      candidates: Array<{ mutations?: Array<{ path: string; strategy: string }> }>;
      winner: { mutations?: Array<{ path: string; strategy: string }> };
    }> = [];

    const result = await parent.tune({
      generations: 1,
      batchSize: 5,
      selector: "auto",
      score: (output) => output,
      domainFocus: ["child"],
      radius: {
        coreMutationRate: 1,
        coreMutationMagnitude: 0.8,
        textureGrowthCount: 0,
        textureEditRate: 0,
        textureEditMagnitude: 0,
        bondGrowthCount: 0,
        bondEditRate: 0,
      },
      onGeneration: (event) => {
        generations.push(event as typeof generations[number]);
      },
    });

    expect(result.output).toBeGreaterThan(2);
    expect(result.seed.subSeed("child")?.meta?.hash).not.toBe(beforeChildHash);
    expect(
      generations[0]?.candidates.some((candidate) =>
        candidate.mutations?.some((mutation) => mutation.path === "child"),
      ),
    ).toBe(true);
    expect(generations[0]?.winner.mutations?.length).toBeGreaterThan(0);
    expect(result.trace?.children[0]?.path).toBe("child");
  });

  test("domain lock and focus constrain hierarchical mutation targets", async () => {
    const left = seed(
      async ($) => {
        const value = $("value", {
          type: "u8",
          range: [1, 9],
          default: 2,
        });
        return value;
      },
      { id: "demo.hierarchy.scope.left", version: "1" },
    );
    const right = seed(
      async ($) => {
        const value = $("value", {
          type: "u8",
          range: [1, 9],
          default: 2,
        });
        return value;
      },
      { id: "demo.hierarchy.scope.right", version: "1" },
    );

    const parent = seed(
      async ($) => {
        const leftValue = await $.domain("left", left, [] as []);
        const rightValue = await $.domain("right", right, [] as []);
        return { left: leftValue, right: rightValue };
      },
      { id: "demo.hierarchy.scope.parent", version: "1" },
    );

    const allMutations: Array<{ path: string }> = [];
    await parent();
    const lockedLeftHash = parent.subSeed("left")?.meta?.hash;
    const result = await parent.tune({
      generations: 1,
      batchSize: 5,
      selector: "auto",
      score: (output) => output.right,
      domainLock: ["left"],
      domainFocus: ["right"],
      radius: {
        coreMutationRate: 1,
        coreMutationMagnitude: 0.8,
        textureGrowthCount: 0,
        textureEditRate: 0,
        textureEditMagnitude: 0,
        bondGrowthCount: 0,
        bondEditRate: 0,
      },
      onGeneration: (event) => {
        for (const candidate of event.candidates) {
          allMutations.push(...(candidate.mutations ?? []));
        }
      },
    });

    expect(allMutations.length).toBeGreaterThan(0);
    expect(allMutations.every((mutation) => mutation.path === "right")).toBe(true);
    expect(result.output.left).toBe(2);
    expect(result.output.right).toBeGreaterThan(2);
    expect(result.seed.subSeed("left")?.meta?.hash).toBe(lockedLeftHash);
  });

  test("CLI tree commands can inspect, inject, save, and credit hierarchical sub-seeds", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cultivar-js-hierarchy-cli-"));
    const savedSubPath = join(tempDir, "saved-child.seed");
    const injectedSubPath = join(tempDir, "injected-child.seed");
    const lines: string[] = [];

    try {
      const child = seed(
        async ($) => {
          const intensity = $("intensity", {
            type: "u8",
            range: [1, 9],
            default: 2,
          });
          $.behavior("confidence", intensity);
          return intensity;
        },
        { id: "demo.hierarchy.cli.child", version: "1" },
      );

      await child();
      writeFileSync(injectedSubPath, mutateNumericParam(child, "intensity", 8));

      const parent = seed(
        async ($) => {
          const root = $("root", {
            type: "u8",
            range: [1, 5],
            default: 2,
          });
          $.behavior("stability", root);
          const childValue = await $.domain("child", child, [] as []);
          return {
            root,
            child: childValue,
            summary: `${root}/${childValue}`,
          };
        },
        { id: "demo.hierarchy.cli.parent", version: "1" },
      );

      const answers = [
        "tree",
        `save-sub child ${savedSubPath}`,
        `set-sub child ${injectedSubPath}`,
        "values child",
        "behavior child",
        "0",
        "credit",
        "done 0",
      ];

      const result = await parent.tuneCli({
        generations: 2,
        batchSize: 4,
        score: (output) => output.child,
        preview: (output) => output.summary,
        domainFocus: ["child"],
        io: {
          prompt: () => answers.shift() ?? "done 0",
          print: (line) => lines.push(line),
          color: false,
        },
      });

      expect(Object.keys(result.domainCredits ?? {})).not.toHaveLength(0);
      expect(lines.some((line) => line.includes("Current domain tree"))).toBe(true);
      expect(lines.some((line) => line.includes("Behaviors child"))).toBe(true);
      expect(lines.some((line) => line.includes("confidence"))).toBe(true);
      expect(lines.some((line) => line.includes("\"intensity\": 8"))).toBe(true);
      expect(lines.some((line) => line.includes("Mutation credits"))).toBe(true);
      expect(readFileSync(savedSubPath).byteLength).toBeGreaterThan(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("targeted credit probes preserve the selected winner seed and produce domain summaries", async () => {
    const child = seed(
      async ($) => {
        const intensity = $("intensity", {
          type: "u8",
          range: [1, 9],
          default: 2,
        });
        $.behavior("confidence", intensity);
        return intensity;
      },
      { id: "demo.hierarchy.targeted.child", version: "1" },
    );

    const parent = seed(
      async ($) => {
        const root = $("root", {
          type: "u8",
          range: [1, 5],
          default: 2,
        });
        $.behavior("stability", root);
        const childValue = await $.domain("child", child, [] as []);
        return root + childValue;
      },
      { id: "demo.hierarchy.targeted.parent", version: "1" },
    );

    let winnerHash: string | undefined;
    const result = await parent.tune({
      generations: 1,
      batchSize: 4,
      selector: "auto",
      score: (output) => output,
      hierarchical: {
        credit: "targeted",
        maxCreditProbeEvaluations: 3,
      },
      onGeneration: (event) => {
        winnerHash = event.winner.seed.meta?.hash;
      },
    });

    expect(result.seed.meta?.hash).toBe(winnerHash);
    expect(result.domainCredits?.root).toBeDefined();
    expect(result.domainSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "root",
          credit: expect.objectContaining({
            samples: expect.any(Number),
          }),
        }),
        expect.objectContaining({
          path: "child",
          behaviors: expect.objectContaining({
            confidence: expect.any(Number),
          }),
        }),
      ]),
    );
    expect(
      result.domainSummaries?.some((summary) =>
        summary.paramCredits.some((entry) => entry.samples > 0),
      ),
    ).toBe(true);
  });

  test("tree cache avoids rerunning unchanged upstream domains in a linear pipeline", async () => {
    let generateRuns = 0;
    let transformRuns = 0;
    let gradeRuns = 0;

    const generate = seed(
      async ($) => {
        generateRuns += 1;
        const base = $("base", {
          type: "u8",
          range: [1, 9],
          default: 3,
        });
        return base;
      },
      { id: "demo.hierarchy.cache.generate", version: "1" },
    );

    const transform = seed(
      async ($, input: number) => {
        transformRuns += 1;
        const boost = $("boost", {
          type: "u8",
          range: [0, 4],
          default: 1,
        });
        return input + boost;
      },
      { id: "demo.hierarchy.cache.transform", version: "1" },
    );

    const grade = seed(
      async ($, input: number) => {
        gradeRuns += 1;
        const gain = $("gain", {
          type: "u8",
          range: [1, 9],
          default: 2,
        });
        return input * gain;
      },
      { id: "demo.hierarchy.cache.grade", version: "1" },
    );

    const pipeline = seed(
      async ($) => {
        const generated = await $.domain("generate", generate, [] as []);
        const transformed = await $.domain("transform", transform, [generated] as [number]);
        return await $.domain("grade", grade, [transformed] as [number]);
      },
      { id: "demo.hierarchy.cache.pipeline", version: "1" },
    );

    expect(await pipeline()).toBe(8);
    await pipeline.tune({
      generations: 1,
      batchSize: 4,
      selector: "auto",
      score: (output) => output,
      domainFocus: ["grade"],
      hierarchical: {
        credit: "off",
        cache: { maxEntries: 32 },
      },
    });

    expect(generateRuns).toBe(2);
    expect(transformRuns).toBe(2);
    expect(gradeRuns).toBeGreaterThan(transformRuns);
    expect(gradeRuns).toBeLessThanOrEqual(5);
  });

  test("seed bank survives wrapper restart and behavior targets pick the nearest stored seed", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cultivar-js-bank-"));
    try {
      const buildChild = () =>
        seed(
          async ($) => {
            const intensity = $("intensity", {
              type: "u8",
              range: [1, 9],
              default: 2,
            });
            $.behavior("warmth", intensity);
            return intensity;
          },
          { id: "demo.phase4.bank.child", version: "1" },
        );

      const low = buildChild();
      await low();
      ensureSeedBankService(getWrapperState(low as object)!, { path: tempDir });
      await appendTreeToSeedBank(getWrapperState(low as object)!, [] as [], {
        seedBank: { path: tempDir },
        includeRoot: true,
        savedCount: 1,
        tags: ["manual-save"],
      });

      const high = buildChild();
      await high();
      high.importBytes(mutateNumericParam(high, "intensity", 8));
      await high();
      ensureSeedBankService(getWrapperState(high as object)!, { path: tempDir });
      await appendTreeToSeedBank(getWrapperState(high as object)!, [] as [], {
        seedBank: { path: tempDir },
        includeRoot: true,
        savedCount: 1,
        tags: ["manual-save"],
      });

      const restartedChild = buildChild();
      ensureSeedBankService(getWrapperState(restartedChild as object)!, { path: tempDir });
      const parent = seed(
        async ($) => {
          return await $.domain(
            "child",
            restartedChild,
            [] as [],
            {
              reuse: "bank-nearest",
              behaviorTarget: { warmth: 8 },
            },
          );
        },
        { id: "demo.phase4.bank.parent", version: "1" },
      );

      expect(Number(await parent())).toBe(8);

      const restartedChild2 = buildChild();
      ensureSeedBankService(getWrapperState(restartedChild2 as object)!, { path: tempDir });
      const parent2 = seed(
        async ($) => {
          return await $.domain(
            "child",
            restartedChild2,
            [] as [],
            {
              reuse: "bank-nearest",
              behaviorTarget: { warmth: 2 },
            },
          );
        },
        { id: "demo.phase4.bank.parent2", version: "1" },
      );

      expect(await parent2()).toBe(2);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("swap mutation can pull a previously selected sub-seed from the bank", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cultivar-js-bank-swap-"));
    try {
      const child = seed(
        async ($) => {
          const intensity = $("intensity", {
            type: "u8",
            range: [1, 9],
            default: 2,
          });
          $.behavior("warmth", intensity);
          return intensity;
        },
        { id: "demo.phase4.swap.child", version: "1" },
      );

      await child();
      child.importBytes(mutateNumericParam(child, "intensity", 8));
      await child();
      ensureSeedBankService(getWrapperState(child as object)!, { path: tempDir });
      await appendTreeToSeedBank(getWrapperState(child as object)!, [] as [], {
        seedBank: { path: tempDir },
        includeRoot: true,
        savedCount: 1,
        tags: ["manual-save"],
      });

      const freshChild = seed(
        async ($) => {
          const intensity = $("intensity", {
            type: "u8",
            range: [1, 9],
            default: 2,
          });
          $.behavior("warmth", intensity);
          return intensity;
        },
        { id: "demo.phase4.swap.child", version: "1" },
      );
      ensureSeedBankService(getWrapperState(freshChild as object)!, { path: tempDir });

      const parent = seed(
        async ($) => {
          return await $.domain("child", freshChild, [] as []);
        },
        { id: "demo.phase4.swap.parent", version: "1" },
      );

      expect(await parent()).toBe(2);
      const result = await parent.tune({
        generations: 1,
        batchSize: 1,
        selector: "auto",
        score: (output) => output,
        domainFocus: ["child"],
        hierarchical: {
          seedBank: { path: tempDir },
          credit: "off",
          mutationMix: {
            singleTargetRatio: 0,
            highImpactRatio: 0,
            exploratorySwapRatio: 1,
            parentRootRatio: 0,
            domainRelationRatio: 0,
          },
        },
      });

      expect(Number(result.output)).toBe(8);
      expect(result.seed.subSeed("child")?.meta?.hash).toBeDefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("behavior constraints reject invalid child candidates and show the reason in CLI", async () => {
    const lines: string[] = [];

    const child = seed(
      async ($) => {
        const intensity = $("intensity", {
          type: "u8",
          range: [1, 9],
          default: 2,
        });
        $.behavior("warmth", intensity);
        return intensity;
      },
      { id: "demo.phase4.constraint.child", version: "1" },
    );

    const parent = seed(
      async ($) => {
        return await $.domain(
          "child",
          child,
          [] as [],
          {
            behaviorConstraints: {
              warmth: { eq: 2 },
            },
          },
        );
      },
      { id: "demo.phase4.constraint.parent", version: "1" },
    );

    const result = await parent.tuneCli({
      generations: 1,
      batchSize: 4,
      score: (output) => output,
      domainFocus: ["child"],
      io: {
        prompt: () => "quit",
        print: (line) => lines.push(line),
        color: false,
      },
    });

    expect(result.output).toBe(2);
    expect(
      lines.some((line) => line.includes("Behavior constraint failed")),
    ).toBe(true);
  });

  test("cross-domain edges accumulate credit and bias later mutation targets", async () => {
    const buildChild = (id: string) =>
      seed(
        async ($) => {
          const value = $("value", {
            type: "u8",
            range: [1, 9],
            default: 2,
          });
          return value;
        },
        { id, version: "1" },
      );

    const parent = seed(
      async ($) => {
        const left = await $.domain("left", buildChild("demo.phase5.edge.left"), [] as []);
        const right = await $.domain("right", buildChild("demo.phase5.edge.right"), [] as []);
        const other = await $.domain("other", buildChild("demo.phase5.edge.other"), [] as []);
        $.domainRel("left", "right", { kind: "amplify", weight: 1 });
        return {
          left,
          right,
          other,
          total: left + right + other,
        };
      },
      { id: "demo.phase5.edge.parent", version: "1" },
    );

    await parent();
    const edgeResult = await parent.tune({
      generations: 1,
      batchSize: 6,
      selector: "auto",
      score: (output) => output.total,
      hierarchical: {
        credit: "variance",
        mutationMix: {
          singleTargetRatio: 0,
          highImpactRatio: 0,
          exploratorySwapRatio: 0,
          parentRootRatio: 0,
          domainRelationRatio: 1,
        },
      },
    });

    const edgeCredit = Math.abs(edgeResult.domainCredits?.["root::left->right"] ?? 0);
    expect(edgeCredit).toBeGreaterThan(0);

    const mutationPaths: string[] = [];
    await parent.tune({
      generations: 1,
      batchSize: 9,
      selector: (candidates) => {
        mutationPaths.push(
          ...candidates.map((candidate) => candidate.mutations?.[0]?.path ?? "none"),
        );
        return 0;
      },
      score: (output) => output.total,
      hierarchical: {
        credit: "off",
        mutationMix: {
          singleTargetRatio: 1,
          highImpactRatio: 0,
          exploratorySwapRatio: 0,
          parentRootRatio: 0,
          domainRelationRatio: 0,
        },
      },
    });

    const relatedMutations = mutationPaths.filter((path) => path === "left" || path === "right").length;
    const unrelatedMutations = mutationPaths.filter((path) => path === "other").length;
    expect(relatedMutations).toBeGreaterThan(unrelatedMutations);
  });

  test("deep trees stay replayable while default mutation depth leaves deeper nodes untouched", async () => {
    const leaf = seed(
      async ($) => {
        const value = $("value", {
          type: "u8",
          range: [1, 9],
          default: 2,
        });
        return value;
      },
      { id: "demo.phase5.deep.leaf", version: "1" },
    );

    const branch = seed(
      async ($) => {
        return await $.domain("leaf", leaf, [] as []);
      },
      { id: "demo.phase5.deep.branch", version: "1" },
    );

    const trunk = seed(
      async ($) => {
        return await $.domain("branch", branch, [] as []);
      },
      { id: "demo.phase5.deep.trunk", version: "1" },
    );

    const root = seed(
      async ($) => {
        return await $.domain("trunk", trunk, [] as []);
      },
      { id: "demo.phase5.deep.root", version: "1" },
    );

    expect(await root()).toBe(2);
    const deepHashBefore = root.subSeed("trunk.branch.leaf")?.meta?.hash;
    const result = await root.tune({
      generations: 1,
      batchSize: 4,
      selector: "auto",
      score: (output) => output,
    });

    expect(result.output).toBe(2);
    expect(result.seed.subSeed("trunk.branch.leaf")?.meta?.hash).toBe(deepHashBefore);

    const replay = seed(
      async ($) => {
        return await $.domain("trunk", trunk, [] as []);
      },
      { id: "demo.phase5.deep.root", version: "1" },
    );
    replay.importTree(result.seed.exportTree());
    expect(await replay()).toBe(2);

    const lines: string[] = [];
    await root.tuneCli({
      generations: 1,
      batchSize: 2,
      score: (output) => output,
      depthLimit: 3,
      io: {
        prompt: () => "quit",
        print: (line) => lines.push(line),
        color: false,
      },
    });
    expect(
      lines.some((line) => line.includes("depthLimit is above 2")),
    ).toBe(true);
  });
});

function mutateNumericParam(
  wrapped: {
    schema(options?: { internal?: boolean }): {
      internal?: {
        params: Array<{ name: string; fieldId: number }>;
      };
    } | null;
    exportBytes(): Uint8Array;
  },
  name: string,
  nextValue: number,
): Uint8Array {
  const descriptor = wrapped.schema({ internal: true });
  const fieldId = descriptor?.internal?.params.find((param) => param.name === name)?.fieldId;
  if (fieldId === undefined) {
    throw new Error(`Could not find field id for ${name}`);
  }
  const parsed = parseSeedBytes(wrapped.exportBytes());
  const field = [...parsed.coreFields, ...parsed.textureFields].find((candidate) => candidate.id === fieldId);
  if (!field) {
    throw new Error(`Could not find seed field for ${name}`);
  }
  field.value = nextValue;
  return serializeSeed(parsed);
}

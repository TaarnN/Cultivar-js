import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { seed } from "../src/index.ts";

const generate = seed(
  async ($, prompt: string) => {
    const cfg = $("cfg", {
      type: "f64",
      range: [4, 12],
      default: 7.5,
    });
    const steps = $("steps", {
      type: "u16",
      range: [20, 80],
      default: 30,
      tier: "texture",
    });
    const composition = $("composition", {
      type: "f64",
      range: [0, 1],
      default: 0.6,
      tier: "texture",
    });

    await $.check(
      "sane-steps",
      () => steps % 2 === 0,
      { message: "steps should stay even", enforcement: "reject" },
    );

    const aesthetic =
      cfg * 0.7 +
      steps * 0.05 +
      composition * 3 +
      prompt.length * 0.01;

    return {
      prompt,
      cfg,
      steps,
      composition,
      aesthetic,
      summary: `${prompt} @ cfg=${cfg.toFixed(2)} steps=${steps}`,
    };
  },
  { id: "image.render", version: "3", name: "Advanced Image Render" },
);

const tempDir = mkdtempSync(join(tmpdir(), "cultivar-js-advanced-"));
const seedPath = join(tempDir, "best-image.seed");
const lineagePath = join(tempDir, "image-render.lineage.jsonl");

try {
  const autoBest = await generate.tune(
    (image) => image.aesthetic,
    {
      args: ["portrait of a kingfisher"],
      generations: 1,
      batchSize: 3,
    },
  );

  const curated = await generate.tune({
    args: ["portrait of a kingfisher"],
    generations: 1,
    batchSize: 2,
    selector: "human",
    preview: (image) => image.summary,
    score: (image) => image.aesthetic,
    lineage: { path: lineagePath },
    onGeneration: ({ generation, winner }) => {
      console.log("advanced:generation", generation, winner.score);
    },
  });

  await curated.seed.save(seedPath);
  const replay = await generate.load(seedPath, "portrait of a kingfisher");

  console.log("advanced:auto-best", autoBest.output);
  console.log("advanced:curated", curated.output);
  console.log("advanced:replay", replay);
  console.log("advanced:lineage", readFileSync(lineagePath, "utf8").trim());
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

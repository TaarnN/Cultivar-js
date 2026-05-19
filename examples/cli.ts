import { seed } from "../src/index.ts";

const tuneText = seed(
  async ($, input: string) => {
    const excitement = $("excitement", {
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

    const output = `${input}! ${"wow ".repeat(repetition).trim()} (${excitement.toFixed(2)})`;
    return {
      output,
      quality: excitement * 10 + repetition,
      summary: output,
    };
  },
  { id: "demo.cli.example", version: "1", name: "CLI Example" },
);

const result = await tuneText.tuneCli({
  args: ["hello"],
  generations: 2,
  batchSize: 3,
  score: (candidate) => candidate.quality,
  preview: (candidate) => candidate.summary,
  inspect: (candidate) => JSON.stringify(candidate, null, 2),
  title: "Seed Tuning CLI Example",
});

console.log("cli:result", result.output);
console.log("cli:history", result.history);

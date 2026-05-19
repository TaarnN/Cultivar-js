import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { seed } from "../src/index.ts";

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
    return `${input}! ${"wow ".repeat(repetition).trim()} (${emphasis.toFixed(2)})`;
  },
  { id: "demo.mix", version: "1" },
);

const tempDir = mkdtempSync(join(tmpdir(), "cultivar-js-simple-"));
const seedPath = join(tempDir, "mix.seed");

try {
  const first = await mix("hello");
  const bytes = mix.exportBytes();
  mix.reset();
  mix.importBytes(bytes);
  const replay = await mix("hello");
  const stickyReplay = await mix("hello");
  await mix.save(seedPath);

  console.log("simple:first", first);
  console.log("simple:replay", replay);
  console.log("simple:sticky", stickyReplay);
  console.log("simple:seed", mix.seed.meta);
  console.log("simple:schema", mix.schema());
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

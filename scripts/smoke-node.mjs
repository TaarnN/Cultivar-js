import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

import { seed as esmSeed } from "cultivar-js";
import { CultivarJsError } from "cultivar-js/errors";

const require = createRequire(import.meta.url);
const { seed: cjsSeed } = require("cultivar-js");
const { CultivarJsError: CjsCultivarJsError } = require("cultivar-js/errors");

const tempDir = await mkdtemp(join(tmpdir(), "cultivar-js-node-smoke-"));

try {
  if (typeof esmSeed !== "function" || typeof cjsSeed !== "function") {
    throw new Error("Expected both ESM and CommonJS exports to expose seed()");
  }
  if (CultivarJsError.name !== "CultivarJsError" || CjsCultivarJsError.name !== "CultivarJsError") {
    throw new Error("Expected the errors subpath to expose CultivarJsError");
  }

  const mix = esmSeed(
    async ($, input) => {
      const emphasis = $("emphasis", {
        type: "f64",
        range: [0, 1],
        default: 0.4,
      });
      return `${input}:${emphasis.toFixed(2)}`;
    },
    { id: "smoke.esm", version: "1" },
  );

  const first = await mix("hello");
  if (first !== "hello:0.40") {
    throw new Error(`Unexpected ESM output: ${first}`);
  }

  const seedPath = join(tempDir, "mix.seed");
  await mix.save(seedPath);
  if ((await readFile(seedPath)).byteLength === 0) {
    throw new Error("Expected save() to write seed bytes");
  }

  const cjsMix = cjsSeed(
    async ($) => $("value", { type: "u8", range: [1, 5], default: 3 }),
    { id: "smoke.cjs", version: "1" },
  );
  const cjsOutput = await cjsMix();
  if (cjsOutput !== 3) {
    throw new Error(`Unexpected CommonJS output: ${cjsOutput}`);
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

import {
  RADIUS_PRESETS,
  SeedMutator,
  type RadiusSetting,
} from "../compat/mutation.ts";
import { SeedParser, SeedSerializer, type Seed } from "../compat/seed-format.ts";
import type { DomainManifest } from "../compat/domain.ts";
import { createPrng, deriveSeed32, withScopedMathRandom } from "../utils/prng.ts";

export type PublicRadiusPreset = "narrow" | "medium" | "broad";

export function resolveRadius(
  radius?: PublicRadiusPreset | Partial<RadiusSetting>,
): RadiusSetting {
  if (!radius) {
    return { ...RADIUS_PRESETS.medium };
  }
  if (typeof radius === "string") {
    return { ...RADIUS_PRESETS[toLegacyRadiusPreset(radius)] };
  }
  return {
    ...RADIUS_PRESETS.medium,
    ...radius,
  };
}

export function mutateSeed(
  seed: Seed,
  manifest: DomainManifest,
  radius?: PublicRadiusPreset | Partial<RadiusSetting>,
  prng?: () => number,
): Seed {
  return withMutationPrng(seed, prng, () => {
    const child = SeedMutator.generateTuningBatch(
      seed,
      resolveRadius(radius),
      1,
      manifest,
    )[0];
    child.header.generation = seed.header.generation + 1;
    return rehash(child);
  });
}

export function createExploratorySeed(
  seed: Seed,
  manifest: DomainManifest,
  prng?: () => number,
): Seed {
  return withMutationPrng(seed, prng, () => {
    let exploratory = SeedMutator.coreShift(
      seed,
      { ...RADIUS_PRESETS.broad },
      manifest,
    );
    exploratory = SeedMutator.textureGrowth(
      exploratory,
      { ...RADIUS_PRESETS.broad },
      manifest,
    );
    exploratory.header.generation = seed.header.generation + 1;
    return rehash(exploratory);
  });
}

function withMutationPrng<T>(
  seed: Seed,
  prng: (() => number) | undefined,
  work: () => T,
): T {
  const scopedPrng = prng ?? createPrng(deriveSeed32(seed.contentHash));
  return withScopedMathRandom(scopedPrng, work);
}

function rehash(seed: Seed): Seed {
  // Structural sharing is deliberately deferred. This reparse keeps the legacy
  // binary compatibility contract intact for now, even though it is not the
  // final performance shape we want long-term.
  return SeedParser.parse(SeedSerializer.serialize(seed));
}

export function coercePublicRadiusPreset(radius: string): PublicRadiusPreset | null {
  switch (radius) {
    case "fine":
    case "narrow":
      return "narrow";
    case "medium":
      return "medium";
    case "broad":
    case "wild":
      return "broad";
    default:
      return null;
  }
}

function toLegacyRadiusPreset(radius: PublicRadiusPreset): keyof typeof RADIUS_PRESETS {
  switch (radius) {
    case "narrow":
      return "fine";
    case "medium":
      return "medium";
    case "broad":
      return "broad";
  }
}

import {
  StagnationDetector,
  type RadiusRecommendation,
  type SelectedSeedSnapshot,
  type StagnationAssessment,
} from "../compat/stagnation.ts";
import type { DomainManifest } from "../compat/domain.ts";
import type { Seed } from "../compat/seed-format.ts";
import { createExploratorySeed } from "../seed/mutation.ts";
import { createPrng, deriveDeterministicSeedHex, deriveSeed32 } from "../utils/prng.ts";

export {
  StagnationDetector,
  type RadiusRecommendation,
  type SelectedSeedSnapshot,
  type StagnationAssessment,
};

export function applyStagnationStrategy(
  batch: Seed[],
  parent: Seed,
  domain: DomainManifest,
  assessment: StagnationAssessment,
  seedContext: {
    sessionSeed: string;
    generation: number;
    batchAttempt: number;
  },
): { batch: Seed[]; recommendation: RadiusRecommendation | null } {
  if (
    !assessment.recommendation ||
    assessment.recommendation.exploratoryRestartRatio <= 0
  ) {
    return { batch: [...batch], recommendation: assessment.recommendation };
  }

  const exploratoryCount = Math.max(
    1,
    Math.round(batch.length * assessment.recommendation.exploratoryRestartRatio),
  );
  const nextBatch = [...batch];

  for (let offset = 0; offset < exploratoryCount; offset++) {
    const position = nextBatch.length - 1 - offset;
    if (position < 0) break;
    const candidateSeed = deriveDeterministicSeedHex({
      type: "stagnation-exploratory",
      sessionSeed: seedContext.sessionSeed,
      generation: seedContext.generation,
      batchAttempt: seedContext.batchAttempt,
      position,
    });
    nextBatch[position] = createExploratorySeed(
      parent,
      domain,
      createPrng(deriveSeed32(candidateSeed)),
    );
  }

  return { batch: nextBatch, recommendation: assessment.recommendation };
}

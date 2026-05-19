import type {
  CandidateContext,
  CliTuneOptions,
  ObjectiveScores,
  ScoreContext,
  TuneOptions,
} from "../../public/tune.ts";
import { summarizeOutput } from "../runtime/preview.ts";
import { SelectionError } from "../utils/errors.ts";
import { withTimeout } from "../utils/timeout.ts";

interface CandidateEvaluationOptions<Args extends unknown[], Output> {
  score?: (output: Output, ctx: ScoreContext<Args>) => number | Promise<number>;
  objectives?: (
    output: Output,
    ctx: ScoreContext<Args>,
  ) => ObjectiveScores | Promise<ObjectiveScores>;
  preference?:
    | Record<string, number>
    | ((objectives: ObjectiveScores, ctx: ScoreContext<Args>) => number | Promise<number>);
  preview?: (output: Output, ctx: CandidateContext<Args>) => string | Promise<string>;
  timeouts?: { scoreMs?: number };
}

export function resolveSelectorMode<Output, Args extends unknown[]>(
  selector: TuneOptions<Args, Output>["selector"] | undefined,
): "human" | "auto" | "custom" {
  if (selector === "auto" || selector === "human") {
    return selector;
  }
  return typeof selector === "function" ? "custom" : "human";
}

export function validateAutoSelectionConfig<Args extends unknown[], Output>(
  selector: TuneOptions<Args, Output>["selector"] | undefined,
  options: CandidateEvaluationOptions<Args, Output>,
): void {
  if (selector !== "auto") {
    return;
  }
  if (options.score) {
    return;
  }
  if (options.objectives && options.preference) {
    return;
  }
  throw new SelectionError(
    "selector: 'auto' requires a score function or objectives plus a preference profile",
  );
}

export async function evaluateCandidateQuality<Args extends unknown[], Output>(
  output: Output,
  context: CandidateContext<Args>,
  options: CandidateEvaluationOptions<Args, Output>,
): Promise<{
  preview: string;
  objectives?: ObjectiveScores;
  score?: number;
}> {
  const preview = options.preview
    ? await Promise.resolve(options.preview(output, context))
    : summarizeOutput(output);

  const scoreContext = context as ScoreContext<Args>;
  const objectives = options.objectives
    ? await withTimeout(
        Promise.resolve(options.objectives(output, scoreContext)).then(validateObjectiveScores),
        options.timeouts?.scoreMs,
        "Candidate objectives",
      )
    : undefined;

  const score = options.score
    ? await withTimeout(
        Promise.resolve(options.score(output, scoreContext)).then(validateScalarScore),
        options.timeouts?.scoreMs,
        "Candidate scoring",
      )
    : objectives && options.preference
      ? await withTimeout(
          Promise.resolve(resolvePreferenceScore(options.preference, objectives, scoreContext)).then(
            validateScalarScore,
          ),
          options.timeouts?.scoreMs,
          "Candidate preference scoring",
        )
      : undefined;

  return { preview, objectives, score };
}

export function summarizeObjectiveScores(objectives: ObjectiveScores | undefined): string | null {
  if (!objectives || Object.keys(objectives).length === 0) {
    return null;
  }
  return Object.entries(objectives)
    .slice(0, 4)
    .map(([name, value]) => `${name}=${formatObjectiveNumber(value)}`)
    .join(", ");
}

async function resolvePreferenceScore<Args extends unknown[]>(
  preference:
    | Record<string, number>
    | ((objectives: ObjectiveScores, ctx: ScoreContext<Args>) => number | Promise<number>),
  objectives: ObjectiveScores,
  context: ScoreContext<Args>,
): Promise<number> {
  if (typeof preference === "function") {
    return preference(objectives, context);
  }
  let total = 0;
  for (const [name, value] of Object.entries(objectives)) {
    total += value * (preference[name] ?? 0);
  }
  return total;
}

function validateObjectiveScores(objectives: ObjectiveScores): ObjectiveScores {
  for (const [name, value] of Object.entries(objectives)) {
    if (!Number.isFinite(value)) {
      throw new SelectionError(
        `Objective "${name}" produced a non-finite value: ${String(value)}`,
      );
    }
  }
  return objectives;
}

function validateScalarScore(score: number): number {
  if (!Number.isFinite(score)) {
    throw new SelectionError(`Score produced a non-finite value: ${String(score)}`);
  }
  return score;
}

function formatObjectiveNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

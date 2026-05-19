import type { Candidate } from "../../public/tune.ts";
import { summarizeOutput } from "../runtime/preview.ts";
import { resolveInteractiveIO } from "../platform/interactive.ts";
import { SelectionError } from "../utils/errors.ts";
import { withTimeout } from "../utils/timeout.ts";
import { summarizeObjectiveScores } from "./evaluation.ts";

export async function selectCandidate<Output, Args extends unknown[]>(
  candidates: Candidate<Output, Args>[],
  selector: "human" | "auto" | ((candidates: Candidate<Output, Args>[]) => number | Promise<number>),
  options?: {
    timeoutMs?: number;
    io?: {
      prompt?: (message: string) => string | Promise<string | null> | null;
      print?: (line: string) => void;
      color?: boolean;
    };
  },
): Promise<number> {
  if (candidates.length === 0) {
    throw new SelectionError("Cannot select from an empty candidate batch");
  }

  if (selector === "auto") {
    const scored = candidates.filter((candidate) => candidate.score !== undefined);
    if (scored.length !== candidates.length) {
      throw new SelectionError(
        "selector: 'auto' requires a score function so every candidate has a score",
      );
    }
    let bestPosition = 0;
    let bestScore = candidates[0].score ?? Number.NEGATIVE_INFINITY;
    for (let position = 1; position < candidates.length; position++) {
      const score = candidates[position].score ?? Number.NEGATIVE_INFINITY;
      if (score > bestScore) {
        bestScore = score;
        bestPosition = position;
      }
    }
    return bestPosition;
  }

  if (selector === "human") {
    return selectHuman(candidates, options?.io);
  }

  return withTimeout(
    Promise.resolve(selector(candidates)).then((position) => {
      if (!Number.isInteger(position)) {
        throw new SelectionError(`Selector returned a non-integer position: ${String(position)}`);
      }
      if (position < 0 || position >= candidates.length) {
        throw new SelectionError(`Selector returned an out-of-range position: ${String(position)}`);
      }
      return position;
    }),
    options?.timeoutMs,
    "Candidate selection",
  );
}

async function selectHuman<Output, Args extends unknown[]>(
  candidates: Candidate<Output, Args>[],
  io?: {
    prompt?: (message: string) => string | Promise<string | null> | null;
    print?: (line: string) => void;
    color?: boolean;
  },
): Promise<number> {
  const interactive = resolveInteractiveIO(io);

  interactive.print("Select a candidate:");
  for (const candidate of candidates) {
    const score =
      candidate.score === undefined ? "n/a" : candidate.score.toFixed(3);
    const objectives = summarizeObjectiveScores(candidate.objectives);
    interactive.print(
      `[${candidate.position}] score=${score}${objectives ? ` objectives=${objectives}` : ""} seed=${candidate.seed.meta?.hash.slice(0, 12) ?? "unknown"} preview=${candidate.preview || summarizeOutput(candidate.output)}`,
    );
  }

  const answer = await interactive.prompt(`Choose position 0-${candidates.length - 1}`);
  const selected = Number(answer);
  if (!Number.isInteger(selected) || selected < 0 || selected >= candidates.length) {
    throw new SelectionError(`Invalid human selection position: ${String(answer)}`);
  }
  return selected;
}

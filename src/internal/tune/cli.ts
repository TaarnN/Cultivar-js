import type {
  Candidate,
  CandidateContext,
  CliTuneOptions,
  GenerationEvent,
  GenerationSummary,
  Habit,
  TuneResult,
} from "../../public/tune.ts";
import { LineageService } from "../compat/lineage.ts";
import type { Seed } from "../compat/seed-format.ts";
import type { StagnationAssessment } from "../compat/stagnation.ts";
import { createExperienceService } from "../experience/service.ts";
import {
  mutateHierarchicalTree,
  shouldUseHierarchicalMutation,
  summarizeMutationTrace,
} from "../hierarchical/mutation.ts";
import { createTreeInvocationCache } from "../hierarchical/cache.ts";
import {
  buildDomainTuneSummaries,
  hasLowConfidenceCreditTargets,
  lookupCreditSummary,
} from "../hierarchical/credit.ts";
import {
  appendNodeToSeedBank,
  appendTreeToSeedBank,
  buildSeedBankDonorIndex,
  ensureSeedBankService,
  summarizeTraceWarnings,
} from "../hierarchical/seed-bank.ts";
import { readBytes } from "../platform/files.ts";
import { writeBytes } from "../platform/files.ts";
import { colorize, resolveInteractiveIO, type ResolvedInteractiveIO } from "../platform/interactive.ts";
import type { WrapperState } from "../runtime/state.ts";
import { invokeSeededFunction } from "../runtime/invocation.ts";
import {
  cloneRuntimeTreeNode,
  findRuntimeTreeNode,
  listRuntimeTreeNodes,
  type RuntimeTreeNode,
} from "../runtime/tree.ts";
import { summarizeOutput } from "../runtime/preview.ts";
import {
  coercePublicRadiusPreset,
  createExploratorySeed,
  mutateSeed as mutateLegacySeed,
  resolveRadius,
} from "../seed/mutation.ts";
import { parseSeedBytes, serializeSeed } from "../seed/binary.ts";
import { legacySeedToValues, snapshotToManifest } from "../seed/snapshot.ts";
import { StagnationDetector } from "./stagnation.ts";
import {
  buildHierarchicalDomainSummaries,
  updateHierarchicalCreditsAfterSelection,
} from "./hierarchical.ts";
import {
  buildLineageRecord,
  createCandidateSeed,
  createLineageStore,
  createTuneSessionSeed,
  freezeSeedHandle,
  rankWinner,
} from "./common.ts";
import { evaluateCandidateQuality, summarizeObjectiveScores } from "./evaluation.ts";
import {
  CurrentSeedMissingError,
  GenerationExhaustedError,
  InteractiveAbortError,
  SchemaDeclarationError,
  TimeoutExceededError,
  ValidationRejectedError,
} from "../utils/errors.ts";
import { createPrng } from "../utils/prng.ts";

type TuningCandidate<Output, Args extends unknown[]> =
  Candidate<Output, Args> & {
    legacySeed: Seed;
    tree: RuntimeTreeNode;
    mutations: NonNullable<Candidate<Output, Args>["mutations"]>;
    candidateSeed: string;
    candidateSeed32: number;
    appliedHabitIds: string[];
  };

interface EvaluatedBatch<Output, Args extends unknown[]> {
  attemptedBatchSize: number;
  rejectedCount: number;
  timedOutCount: number;
  firstFailureMessage?: string;
  batchAttempt: number;
  sessionSeed: string;
  candidates: TuningCandidate<Output, Args>[];
}

export async function tuneSeededFunctionCli<Args extends unknown[], Output>(
  state: WrapperState<Args, Output>,
  options: CliTuneOptions<Args, Output> = {},
): Promise<TuneResult<Output>> {
  const interactive = resolveInteractiveIO(options.io);
  const args = options.args ?? ([] as unknown as Args);
  const initialRun =
    state.schema === null || state.currentSeed === null
      ? await invokeSeededFunction(state, args, {
          seed: state.currentSeed,
          seedBank: options.hierarchical?.seedBank,
          timeouts: { runMs: options.timeouts?.runMs },
        })
      : null;
  const schema = state.schema ?? initialRun?.schema;
  if (!schema) {
    throw new SchemaDeclarationError("Failed to establish a schema before CLI tuning");
  }
  ensureSeedBankService(state, options.hierarchical?.seedBank);

  const manifest = snapshotToManifest(schema);
  const lineageStore = createLineageStore(options.lineage);
  const lineageService = new LineageService(lineageStore);
  const experienceService = await createExperienceService(
    options.experience,
    schema,
    args,
    "cli",
  );
  const history: GenerationSummary[] = [];
  const selectedSnapshots: Array<{ seed: Seed; tags: string[] }> = [];
  let currentSeed = state.currentSeed ?? initialRun?.legacySeed;
  let currentTree = state.currentTreeSeed ?? initialRun?.tree ?? null;
  let radiusLabel = resolveInitialRadiusLabel(options.radius ?? state.meta.radius);
  let radius = resolveRadius(options.radius ?? state.meta.radius);
  let batchSize = Math.max(1, options.batchSize ?? 4);
  let targetGenerations = Math.max(1, options.generations ?? 1);
  let generation = 1;
  let pendingAssessment: StagnationAssessment | null = null;
  let activeHabits = experienceService?.getActiveHabits() ?? [];
  let latestObjectives: Candidate<Output, Args>["objectives"] | undefined;
  let domainLock = [...(options.domainLock ?? [])];
  let domainFocus = [...(options.domainFocus ?? [])];
  let warnedDeepLowConfidence = false;
  const useHierarchical = shouldUseHierarchicalMutation(currentTree, schema);
  const treeCache = useHierarchical
    ? createTreeInvocationCache(options.hierarchical?.cache)
    : null;

  const session = createTuneSessionSeed(
    state.meta,
    currentSeed!.contentHash,
    args,
    {
      generations: targetGenerations,
      batchSize,
      radius: options.radius ?? state.meta.radius,
      title: options.title ?? null,
      showValues: options.showValues ?? true,
      hasScore: Boolean(options.score),
      hasInspect: Boolean(options.inspect),
      lineage:
        options.lineage === false ? false : options.lineage?.path ? "file" : "memory",
    },
    "cli",
  );

  while (generation <= targetGenerations) {
    const parentSeed = currentSeed!;
    let batchAttempt = 0;

    while (true) {
      const recommendedRadius = coercePublicRadiusPreset(
        pendingAssessment?.recommendation?.recommendedRadius ?? "",
      );
      if (recommendedRadius) {
        radius = resolveRadius(recommendedRadius);
        radiusLabel = recommendedRadius;
      }

      const evaluated = await evaluateCandidateBatch(
        state,
        args,
        generation,
        batchAttempt,
        session.sessionSeed,
        parentSeed,
        manifest,
        radius,
        pendingAssessment,
        batchSize,
        options,
        experienceService,
        activeHabits,
        currentTree,
        useHierarchical,
        domainLock,
        domainFocus,
        treeCache,
      );

      while (true) {
        renderCliScreen(
          interactive,
          schema.meta.name,
          options.title,
          generation,
          targetGenerations,
          parentSeed,
          radiusLabel,
          batchSize,
          evaluated,
          options.showValues ?? true,
          activeHabits,
          domainLock,
          domainFocus,
        );
        if (
          !warnedDeepLowConfidence &&
          Math.max(1, options.depthLimit ?? 2) > 2 &&
          hasLowConfidenceCreditTargets(
            state.currentTreeSeed ?? currentTree,
            state.domainCreditState,
            {
              domainLock,
              domainFocus,
              depthLimit: options.depthLimit,
              minimumConfidence: 0.7,
            },
          )
        ) {
          interactive.print(
            paint(
              interactive,
              "33",
              "warning: depthLimit is above 2 while deep-domain credit confidence is still low; deeper mutations may stay noisy until more samples land.",
            ),
          );
          warnedDeepLowConfidence = true;
        }

        let command = "help";
        try {
          const input = await interactive.prompt(paint(interactive, "36", "seed-tune> "));
          if (input === null) {
            return finalizeAfterInteractiveAbort(
              state,
              history,
              latestObjectives,
              undefined,
              { domainLock, domainFocus },
            );
          }
          command = input.trim() || "help";
        } catch (error) {
          if (error instanceof InteractiveAbortError) {
            return finalizeAfterInteractiveAbort(
              state,
              history,
              latestObjectives,
              error,
              { domainLock, domainFocus },
            );
          }
          throw error;
        }

        if (command === "help" || command === "?") {
          printHelp(interactive);
          continue;
        }

        if (command === "settings") {
          printSettings(
            interactive,
            generation,
            targetGenerations,
            batchSize,
            radiusLabel,
            radius,
            activeHabits,
            domainLock,
            domainFocus,
          );
          continue;
        }

        if (command === "current") {
          printCurrentState(interactive, state, activeHabits);
          continue;
        }

        if (command === "tree") {
          printTree(interactive, currentTree ?? state.currentTreeSeed);
          continue;
        }

        const inspectDomainPath = parsePathCommand(command, "inspect-domain");
        if (inspectDomainPath !== null) {
          printDomainInspection(
            interactive,
            currentTree ?? state.currentTreeSeed,
            inspectDomainPath,
          );
          continue;
        }

        const valuesPath = parsePathCommand(command, "values");
        if (valuesPath !== null) {
          printDomainValues(
            interactive,
            currentTree ?? state.currentTreeSeed,
            valuesPath,
          );
          continue;
        }

        const behaviorPath = parsePathCommand(command, "behavior");
        if (behaviorPath !== null) {
          printDomainBehaviors(
            interactive,
            currentTree ?? state.currentTreeSeed,
            behaviorPath,
          );
          continue;
        }

        const saveSubCommand = parsePathAndFileCommand(command, "save-sub");
        if (saveSubCommand) {
          try {
            await saveSubSeed(
              state,
              currentTree ?? state.currentTreeSeed,
              saveSubCommand.path,
              saveSubCommand.file,
            );
            interactive.print(
              paint(interactive, "32", `Saved sub-seed ${saveSubCommand.path} to ${saveSubCommand.file}`),
            );
          } catch (error) {
            interactive.print(paint(interactive, "31", formatError(error)));
          }
          continue;
        }

        const setSubCommand = parsePathAndFileCommand(command, "set-sub");
        if (setSubCommand) {
          try {
            currentTree = injectSubSeed(
              state,
              currentTree ?? state.currentTreeSeed,
              setSubCommand.path,
              await readBytes(setSubCommand.file),
            );
            interactive.print(
              paint(interactive, "32", `Injected sub-seed ${setSubCommand.path} from ${setSubCommand.file}; rerolling batch`),
            );
            batchAttempt += 1;
            break;
          } catch (error) {
            interactive.print(paint(interactive, "31", formatError(error)));
          }
          continue;
        }

        const lockPath = parsePathCommand(command, "lock");
        if (lockPath !== null) {
          if (!domainLock.includes(lockPath)) {
            domainLock.push(lockPath);
          }
          interactive.print(
            paint(interactive, "32", `Locked ${lockPath}; rerolling batch with updated mutation targets`),
          );
          batchAttempt += 1;
          break;
        }

        const unlockPath = parsePathCommand(command, "unlock");
        if (unlockPath !== null) {
          domainLock = domainLock.filter((path) => path !== unlockPath);
          interactive.print(
            paint(interactive, "32", `Unlocked ${unlockPath}; rerolling batch with updated mutation targets`),
          );
          batchAttempt += 1;
          break;
        }

        const focusPath = parseFocusCommand(command);
        if (focusPath !== null) {
          domainFocus = focusPath === "" ? [] : [focusPath];
          interactive.print(
            paint(
              interactive,
              "32",
              focusPath === ""
                ? "Cleared domain focus; rerolling batch"
                : `Focused mutations on ${focusPath}; rerolling batch`,
            ),
          );
          batchAttempt += 1;
          break;
        }

        if (command === "credit") {
          printCredits(interactive, state.domainCreditState);
          continue;
        }

        if (command === "quit" || command === "done") {
          return finalizeCurrentState(
            state,
            history,
            latestObjectives,
            { domainLock, domainFocus },
          );
        }

        if (command === "reroll" || command === "r") {
          batchAttempt += 1;
          break;
        }

        const directPosition = parseStandalonePosition(command);
        if (directPosition !== null) {
          const winner = evaluated.candidates[directPosition];
          if (!winner) {
            interactive.print(paint(interactive, "31", `No candidate exists at position ${directPosition}`));
            continue;
          }
          await applySelection(
            state,
            lineageService,
            experienceService,
            history,
            winner,
            parentSeed,
            radius,
            generation,
            evaluated,
            ["cli-curated", "human-curated"],
            options,
            pendingAssessment,
            treeCache,
            options.onGeneration,
          );
          currentSeed = winner.legacySeed;
          latestObjectives = winner.objectives;
          selectedSnapshots.push({ seed: winner.legacySeed, tags: ["cli-curated", "human-curated"] });
          pendingAssessment = StagnationDetector.analyzeSelections(selectedSnapshots, manifest);
          activeHabits = experienceService?.getActiveHabits() ?? [];
          generation += 1;
          currentTree = winner.tree;
          break;
        }

        const finishSelection = parseSelectionCommand(command, "done");
        if (finishSelection !== null) {
          const winner = evaluated.candidates[finishSelection];
          if (!winner) {
            interactive.print(paint(interactive, "31", `No candidate exists at position ${finishSelection}`));
            continue;
          }
          await applySelection(
            state,
            lineageService,
            experienceService,
            history,
            winner,
            parentSeed,
            radius,
            generation,
            evaluated,
            ["cli-curated", "human-curated"],
            options,
            pendingAssessment,
            treeCache,
            options.onGeneration,
          );
          latestObjectives = winner.objectives;
          return finalizeCurrentState(
            state,
            history,
            latestObjectives,
            { domainLock, domainFocus },
          );
        }

        const pickSelection = parseSelectionCommand(command, "pick");
        if (pickSelection !== null) {
          const winner = evaluated.candidates[pickSelection];
          if (!winner) {
            interactive.print(paint(interactive, "31", `No candidate exists at position ${pickSelection}`));
            continue;
          }
          await applySelection(
            state,
            lineageService,
            experienceService,
            history,
            winner,
            parentSeed,
            radius,
            generation,
            evaluated,
            ["cli-curated", "human-curated"],
            options,
            pendingAssessment,
            treeCache,
            options.onGeneration,
          );
          currentSeed = winner.legacySeed;
          latestObjectives = winner.objectives;
          selectedSnapshots.push({ seed: winner.legacySeed, tags: ["cli-curated", "human-curated"] });
          pendingAssessment = StagnationDetector.analyzeSelections(selectedSnapshots, manifest);
          activeHabits = experienceService?.getActiveHabits() ?? [];
          generation += 1;
          currentTree = winner.tree;
          break;
        }

        const inspectedPosition = parseSelectionCommand(command, "inspect") ??
          parseSelectionCommand(command, "view");
        if (inspectedPosition !== null) {
          const candidate = evaluated.candidates[inspectedPosition];
          if (!candidate) {
            interactive.print(paint(interactive, "31", `No candidate exists at position ${inspectedPosition}`));
            continue;
          }
          await printCandidateInspection(interactive, candidate, options.inspect);
          continue;
        }

        const saveCandidate = parseSaveCandidateCommand(command);
        if (saveCandidate) {
          const candidate = evaluated.candidates[saveCandidate.position];
          if (!candidate) {
            interactive.print(paint(interactive, "31", `No candidate exists at position ${saveCandidate.position}`));
            continue;
          }
          try {
            await candidate.seed.save(saveCandidate.path);
            await experienceService?.recordSavedCandidate({
              candidate: {
                generation: candidate.generation,
                batchAttempt: candidate.batchAttempt,
                position: candidate.position,
                sessionSeed: candidate.sessionSeed,
                candidateSeed: candidate.candidateSeed,
                output: candidate.output,
                score: candidate.score,
                objectives: candidate.objectives,
                seedHash: candidate.seed.meta?.hash ?? candidate.legacySeed.contentHash,
                parentSeedHash: parentSeed.contentHash,
                values: candidate.values,
                appliedHabitIds: candidate.appliedHabitIds,
                tree: candidate.tree,
                trace: candidate.domainTrace,
                mutations: candidate.mutations,
                domainSummaries: buildDomainTuneSummaries(candidate.tree, state.domainCreditState, {
                  domainLock,
                  domainFocus,
                }),
                domainCredits: state.domainCredits,
                domainLock,
                domainFocus,
                depthLimit: options.depthLimit,
                metadata: { path: saveCandidate.path },
              },
            });
            interactive.print(
              paint(interactive, "32", `Saved candidate ${saveCandidate.position} to ${saveCandidate.path}`),
            );
          } catch (error) {
            interactive.print(paint(interactive, "31", formatError(error)));
          }
          continue;
        }

        const saveCurrentPath = parseSaveCurrentCommand(command);
        if (saveCurrentPath !== null) {
          try {
            if (!state.currentSeed) {
              throw new CurrentSeedMissingError("No current seed is available to save");
            }
            await writeBytes(saveCurrentPath, serializeSeed(state.currentSeed));
            if (state.currentValues && state.currentOutput !== null) {
              await experienceService?.recordSavedCandidate({
                candidate: {
                  generation,
                  batchAttempt,
                  sessionSeed: session.sessionSeed,
                  output: state.currentOutput,
                  seedHash: state.currentSeed.contentHash,
                  values: state.currentValues,
                  objectives: latestObjectives,
                  tree: state.currentTreeSeed,
                  trace: state.currentTrace,
                  domainSummaries: buildDomainTuneSummaries(
                    state.currentTreeSeed,
                    state.domainCreditState,
                    { domainLock, domainFocus },
                  ),
                  domainCredits: state.domainCredits,
                  domainLock,
                  domainFocus,
                  depthLimit: options.depthLimit,
                  metadata: { path: saveCurrentPath, current: true },
                },
              });
            }
            interactive.print(paint(interactive, "32", `Saved current seed to ${saveCurrentPath}`));
          } catch (error) {
            interactive.print(paint(interactive, "31", formatError(error)));
          }
          continue;
        }

        const nextRadiusLabel = parseRadiusCommand(command);
        if (nextRadiusLabel) {
          radiusLabel = nextRadiusLabel;
          radius = resolveRadius(nextRadiusLabel);
          interactive.print(paint(interactive, "33", `Radius set to ${nextRadiusLabel}. Regenerating this round...`));
          batchAttempt += 1;
          break;
        }

        const nextBatchSize = parseNumberCommand(command, "batch");
        if (nextBatchSize !== null) {
          batchSize = Math.max(1, nextBatchSize);
          interactive.print(paint(interactive, "33", `Batch size set to ${batchSize}. Regenerating this round...`));
          batchAttempt += 1;
          break;
        }

        const remainingGenerations = parseNumberCommand(command, "gens");
        if (remainingGenerations !== null) {
          targetGenerations = generation + Math.max(0, remainingGenerations);
          interactive.print(
            paint(
              interactive,
              "33",
              `Remaining generations after this selection set to ${Math.max(0, remainingGenerations)}.`,
            ),
          );
          continue;
        }

        if (command === "advanced") {
          const advanced = await runAdvancedEditor(
            interactive,
            generation,
            targetGenerations,
            batchSize,
            radius,
          );
          batchSize = advanced.batchSize;
          radius = advanced.radius;
          radiusLabel = "custom";
          targetGenerations = advanced.targetGenerations;
          interactive.print(paint(interactive, "33", "Advanced settings updated. Regenerating this round..."));
          batchAttempt += 1;
          break;
        }

        if (evaluated.candidates.length === 0) {
          interactive.print(
            paint(
              interactive,
              "31",
              "No candidates survived. Use reroll, radius, batch, advanced, or quit.",
            ),
          );
          continue;
        }

        const malformedCommandMessage = describeMalformedCommand(command);
        if (malformedCommandMessage) {
          interactive.print(paint(interactive, "31", malformedCommandMessage));
          continue;
        }

        interactive.print(paint(interactive, "31", `Unknown command: ${command}`));
      }

      if (generation > targetGenerations) {
        return finalizeCurrentState(state, history, undefined, { domainLock, domainFocus });
      }

      if (state.currentSeed !== parentSeed) {
        break;
      }
    }
  }

  return finalizeCurrentState(
    state,
    history,
    latestObjectives,
    { domainLock, domainFocus },
  );
}

async function evaluateCandidateBatch<Args extends unknown[], Output>(
  state: WrapperState<Args, Output>,
  args: Args,
  generation: number,
  batchAttempt: number,
  sessionSeed: string,
  parentSeed: Seed,
  manifest: ReturnType<typeof snapshotToManifest>,
  radius: ReturnType<typeof resolveRadius>,
  pendingAssessment: StagnationAssessment | null,
  batchSize: number,
  options: CliTuneOptions<Args, Output>,
  experienceService: Awaited<ReturnType<typeof createExperienceService<Args>>>,
  activeHabits: Habit[],
  currentTree: RuntimeTreeNode | null,
  useHierarchical: boolean,
  domainLock: string[],
  domainFocus: string[],
  treeCache: ReturnType<typeof createTreeInvocationCache>,
): Promise<EvaluatedBatch<Output, Args>> {
  const attemptedBatchSize = batchSize;
  let rejectedCount = 0;
  let timedOutCount = 0;
  let firstFailureMessage: string | undefined;
  const candidates: TuningCandidate<Output, Args>[] = [];
  const exploratoryCount = getExploratoryCount(pendingAssessment, batchSize);
  const seedBankDonors = await buildSeedBankDonorIndex(
    currentTree,
    options.hierarchical?.seedBank,
  );

  for (let candidatePosition = 0; candidatePosition < batchSize; candidatePosition++) {
    const isExploratory = candidatePosition >= batchSize - exploratoryCount;
    const candidateSeedInfo = createCandidateSeed(
      sessionSeed,
      generation,
      batchAttempt,
      candidatePosition,
    );
    const candidatePrng = createPrng(candidateSeedInfo.candidateSeed32);
    const hierarchicalMutation = useHierarchical && currentTree
      ? mutateHierarchicalTree(
          currentTree,
          radius,
          candidatePrng,
          {
            domainLock,
            domainFocus,
            depthLimit: options.depthLimit,
            hierarchical: options.hierarchical,
            exploratory: isExploratory,
            domainCredits: state.domainCredits,
            seedBankDonors,
            activeHabits,
          },
        )
      : null;
    const mutatedSeed = hierarchicalMutation
      ? hierarchicalMutation.tree.seed
      : isExploratory
        ? createExploratorySeed(parentSeed, manifest, candidatePrng)
        : mutateLegacySeed(parentSeed, manifest, radius, candidatePrng);
    const candidateTree = hierarchicalMutation?.tree ?? currentTree;
    const habitGuidance = experienceService?.applyHabitGuidance(
      mutatedSeed,
      candidateTree,
      candidatePrng,
    ) ?? {
      seed: mutatedSeed,
      tree: candidateTree,
      appliedHabitIds: [],
    };
    const legacySeed = habitGuidance.seed;
    const guidedTree = habitGuidance.tree ?? candidateTree;
    if (guidedTree) {
      guidedTree.seed = legacySeed;
    }

    try {
      const run = await invokeSeededFunction(state, args, {
        seed: legacySeed,
        tree: guidedTree,
        commit: false,
        cache: treeCache,
        seedBank: options.hierarchical?.seedBank,
        timeouts: { runMs: options.timeouts?.runMs },
      });
      const frozenSeed = freezeSeedHandle(
        state,
        run.legacySeed,
        run.values,
        run.tree,
        state.domainCredits,
      );
      const previewContext: CandidateContext<Args> = {
        generation,
        position: candidates.length,
        batchAttempt,
        sessionSeed,
        args,
        seed: frozenSeed,
      };
      const quality = await evaluateCandidateQuality(run.output, previewContext, options);
      const preview = summarizeTraceWarnings(run.trace)
        ? `${quality.preview} | warn=${summarizeTraceWarnings(run.trace)}`
        : quality.preview;

      candidates.push({
        position: candidates.length,
        generation,
        batchAttempt,
        sessionSeed,
        output: run.output,
        preview,
        score: quality.score,
        objectives: quality.objectives,
        seed: frozenSeed,
        values: run.values,
        legacySeed: run.legacySeed,
        tree: run.tree,
        args,
        mutations: hierarchicalMutation?.mutations ?? [],
        domainTrace: run.trace,
        candidateSeed: candidateSeedInfo.candidateSeed,
        candidateSeed32: candidateSeedInfo.candidateSeed32,
        appliedHabitIds: habitGuidance.appliedHabitIds,
      });
    } catch (error) {
      if (
        error instanceof ValidationRejectedError ||
        error instanceof TimeoutExceededError
      ) {
        firstFailureMessage ??= error instanceof Error ? error.message : String(error);
        if (error instanceof ValidationRejectedError) {
          rejectedCount++;
        } else {
          timedOutCount++;
        }
        continue;
      }
      throw error;
    }
  }

  return {
    attemptedBatchSize,
    rejectedCount,
    timedOutCount,
    firstFailureMessage,
    batchAttempt,
    sessionSeed,
    candidates,
  };
}

async function applySelection<Args extends unknown[], Output>(
  state: WrapperState<Args, Output>,
  lineageService: LineageService,
  experienceService: Awaited<ReturnType<typeof createExperienceService<Args>>>,
  history: GenerationSummary[],
  winner: TuningCandidate<Output, Args>,
  parentSeed: Seed,
  radius: ReturnType<typeof resolveRadius>,
  generation: number,
  evaluated: EvaluatedBatch<Output, Args>,
  tags: string[],
  options: CliTuneOptions<Args, Output>,
  pendingAssessment: StagnationAssessment | null,
  treeCache: ReturnType<typeof createTreeInvocationCache>,
  onGeneration?: (event: GenerationEvent<Output, Args>) => void | Promise<void>,
): Promise<void> {
  state.currentSeed = winner.legacySeed;
  state.currentValues = { ...winner.values };
  state.currentOutput = winner.output;
  state.currentTreeSeed = winner.tree;
  state.currentTrace = winner.domainTrace ?? null;
  await updateHierarchicalCreditsAfterSelection(
    state,
    evaluated.candidates,
    winner,
    options,
    radius,
    pendingAssessment,
    treeCache,
  );
  await appendTreeToSeedBank(
    state,
    winner.args,
    {
      seedBank: options.hierarchical?.seedBank,
      score: winner.score,
      tags: [...tags, "generation-winner"],
      includeRoot: winner.tree.children.size === 0,
      rootParentSeedHash: parentSeed.contentHash,
    },
  );

  const batchRank = rankWinner(evaluated.candidates, winner.position, (candidate) => candidate.score);
  lineageService.append(
    buildLineageRecord(
      state.meta,
      parentSeed,
      winner,
      radius,
      generation,
      evaluated.candidates.length,
      batchRank,
      tags,
      {
        executionSeed: winner.candidateSeed32,
        sessionSeed: evaluated.sessionSeed,
        candidateSeed: winner.candidateSeed,
        batchAttempt: evaluated.batchAttempt,
        candidatePosition: winner.position,
        curatorId: "cli-human",
        mutationOperator:
          winner.mutations.length > 0
            ? "seed_wrapper_tree_cli_tune"
            : "seed_wrapper_cli_tune",
        },
      ),
  );
  await experienceService?.recordSelection({
    candidates: evaluated.candidates.map((candidate) => ({
      generation: candidate.generation,
      batchAttempt: candidate.batchAttempt,
      position: candidate.position,
      sessionSeed: candidate.sessionSeed,
      candidateSeed: candidate.candidateSeed,
      output: candidate.output,
      score: candidate.score,
      objectives: candidate.objectives,
      seedHash: candidate.seed.meta?.hash ?? candidate.legacySeed.contentHash,
      parentSeedHash: parentSeed.contentHash,
      values: candidate.values,
      appliedHabitIds: candidate.appliedHabitIds,
      tree: candidate.tree,
      trace: candidate.domainTrace,
      mutations: candidate.mutations,
      domainSummaries: buildDomainTuneSummaries(candidate.tree, state.domainCreditState, {
        domainLock: options.domainLock,
        domainFocus: options.domainFocus,
      }),
      domainCredits: state.domainCredits,
      domainLock: options.domainLock,
      domainFocus: options.domainFocus,
      depthLimit: options.depthLimit,
    })),
    winnerPosition: winner.position,
    selector: "human",
    tags,
  });

  const event: GenerationEvent<Output, Args> = {
    generation,
    candidates: evaluated.candidates,
    winner,
  };
  if (onGeneration) {
    await onGeneration(event);
  }

  history.push({
    generation,
    attemptedBatchSize: evaluated.attemptedBatchSize,
    survivorCount: evaluated.candidates.length,
    rejectedCount: evaluated.rejectedCount,
    timedOutCount: evaluated.timedOutCount,
    batchAttempt: evaluated.batchAttempt,
    sessionSeed: evaluated.sessionSeed,
    selectedPosition: winner.position,
    winnerScore: winner.score,
    winnerHash: winner.seed.meta?.hash ?? "unknown",
  });
}

function renderCliScreen<Output, Args extends unknown[]>(
  interactive: ResolvedInteractiveIO,
  name: string,
  title: string | undefined,
  generation: number,
  targetGenerations: number,
  parentSeed: Seed,
  radiusLabel: string,
  batchSize: number,
  evaluated: EvaluatedBatch<Output, Args>,
  showValues: boolean,
  activeHabits: Habit[],
  domainLock: string[],
  domainFocus: string[],
): void {
  const heading = title?.trim() || `${name} CLI tuner`;
  interactive.print("");
  interactive.print(paint(interactive, "1;36", heading));
  interactive.print(
    paint(
      interactive,
      "2",
      `generation ${generation}/${targetGenerations}  attempt ${evaluated.batchAttempt}  batch ${batchSize}  radius ${radiusLabel}  parent ${shortHash(parentSeed.contentHash)}`,
    ),
  );
  interactive.print(
    paint(
      interactive,
      "2",
      `survivors ${evaluated.candidates.length}  rejected ${evaluated.rejectedCount}  timedOut ${evaluated.timedOutCount}`,
    ),
  );
  interactive.print(paint(interactive, "2", `session ${shortHash(evaluated.sessionSeed)}`));
  interactive.print("-".repeat(88));

  if (evaluated.candidates.length === 0) {
    const exhausted = new GenerationExhaustedError(
      generation,
      evaluated.attemptedBatchSize,
      evaluated.rejectedCount,
      evaluated.timedOutCount,
      evaluated.firstFailureMessage,
    );
    interactive.print(paint(interactive, "31", exhausted.message));
  } else {
    for (const candidate of evaluated.candidates) {
      const score = candidate.score === undefined ? "n/a" : candidate.score.toFixed(3);
      const objectives = summarizeObjectiveScores(candidate.objectives);
      const mutationSummary = summarizeMutationTrace(candidate.mutations);
      interactive.print(
        `${paint(interactive, "1;32", `[${candidate.position}]`)} score=${score}${objectives ? ` objectives=${objectives}` : ""} seed=${shortHash(candidate.seed.meta?.hash ?? "unknown")} mutate=${mutationSummary} preview=${candidate.preview}`,
      );
      if (showValues) {
        interactive.print(`    values: ${summarizeValues(candidate.values)}`);
      }
    }
  }

  interactive.print("-".repeat(88));
  if (evaluated.rejectedCount > 0 && evaluated.firstFailureMessage) {
    interactive.print(
      paint(interactive, "33", `first rejection: ${evaluated.firstFailureMessage}`),
    );
  }
  if (activeHabits.length > 0) {
    interactive.print(
      paint(interactive, "2", `active habits: ${summarizeHabits(activeHabits)}`),
    );
  }
  if (domainLock.length > 0 || domainFocus.length > 0) {
    interactive.print(
      paint(
        interactive,
        "2",
        `mutation scope: lock=${domainLock.length > 0 ? domainLock.join(", ") : "none"} focus=${domainFocus.length > 0 ? domainFocus.join(", ") : "all"}`,
      ),
    );
  }
  interactive.print(
    paint(
      interactive,
      "2",
      "commands: [n] pick+next | done [n] finish | inspect [n] | save [n] <path> | save-current <path> | tree",
    ),
  );
  interactive.print(
    paint(
      interactive,
      "2",
      "          inspect-domain <path> | values <path> | behavior <path> | save-sub <path> <file> | set-sub <path> <file>",
    ),
  );
  interactive.print(
    paint(
      interactive,
      "2",
      "          lock <path> | unlock <path> | focus <path>|focus clear | credit | reroll | radius narrow|medium|broad | batch <n> | gens <n> | advanced | settings | current | help | quit",
    ),
  );
}

async function printCandidateInspection<Args extends unknown[], Output>(
  interactive: ResolvedInteractiveIO,
  candidate: TuningCandidate<Output, Args>,
  inspect?: (output: Output, ctx: CandidateContext<Args>) => string | Promise<string>,
): Promise<void> {
  const context: CandidateContext<Args> = {
    generation: candidate.generation,
    position: candidate.position,
    batchAttempt: candidate.batchAttempt,
    sessionSeed: candidate.sessionSeed,
    args: candidate.args,
    seed: candidate.seed,
  };
  const detail = inspect
    ? await Promise.resolve(inspect(candidate.output, context))
    : safeStringify(candidate.output);
  interactive.print(paint(interactive, "1;35", `Candidate ${candidate.position}`));
  interactive.print(
    paint(
      interactive,
      "2",
      `seed=${candidate.seed.meta?.hash ?? "unknown"} score=${candidate.score ?? "n/a"} candidateSeed=${shortHash(candidate.candidateSeed)}`,
    ),
  );
  if (candidate.objectives) {
    interactive.print(`objectives: ${safeStringify(candidate.objectives)}`);
  }
  if (candidate.appliedHabitIds.length > 0) {
    interactive.print(`habits: ${candidate.appliedHabitIds.join(", ")}`);
  }
  if (candidate.mutations.length > 0) {
    interactive.print(`mutations: ${safeStringify(candidate.mutations)}`);
  }
  interactive.print(`values: ${safeStringify(candidate.values)}`);
  interactive.print(`output: ${detail}`);
}

function printHelp(interactive: ResolvedInteractiveIO): void {
  interactive.print(paint(interactive, "1;34", "CLI commands"));
  interactive.print("  [n]              pick candidate n and continue to the next generation");
  interactive.print("  done             finish immediately with the current seed");
  interactive.print("  done [n]         pick candidate n and finish immediately");
  interactive.print("  pick [n]         same as typing n directly");
  interactive.print("  inspect [n]      show full values and output for candidate n");
  interactive.print("  save [n] <path>  save candidate n to a seed file");
  interactive.print("  save-current <path>  save the current seed to a seed file");
  interactive.print("  tree             print the current domain tree");
  interactive.print("  inspect-domain <path>  inspect one current domain node");
  interactive.print("  values <path>    print current values for a domain node");
  interactive.print("  behavior <path>  print current behaviors for a domain node");
  interactive.print("  save-sub <path> <file>  save a current child seed");
  interactive.print("  set-sub <path> <file>   inject a child seed and reroll");
  interactive.print("  lock <path>      prevent future mutations at a domain path");
  interactive.print("  unlock <path>    remove a domain lock and reroll");
  interactive.print("  focus <path>     limit future mutations to one domain path");
  interactive.print("  focus clear      clear any domain focus and reroll");
  interactive.print("  credit           print current mutation credit scores and confidence");
  interactive.print("  reroll           generate a fresh batch from the same parent seed");
  interactive.print("  radius <preset>  switch to narrow, medium, or broad and reroll");
  interactive.print("  batch <n>        change batch size and reroll");
  interactive.print("  gens <n>         set how many generations remain after this pick");
  interactive.print("  advanced         edit fine-grained mutation settings");
  interactive.print("  settings         print current tuning settings");
  interactive.print("  current          print the current selected seed state");
  interactive.print("  quit             finish immediately with the current seed");
}

function printSettings(
  interactive: ResolvedInteractiveIO,
  generation: number,
  targetGenerations: number,
  batchSize: number,
  radiusLabel: string,
  radius: ReturnType<typeof resolveRadius>,
  activeHabits: Habit[],
  domainLock: string[],
  domainFocus: string[],
): void {
  interactive.print(paint(interactive, "1;34", "Current settings"));
  interactive.print(`  generation: ${generation}/${targetGenerations}`);
  interactive.print(`  batchSize: ${batchSize}`);
  interactive.print(`  radius: ${radiusLabel}`);
  interactive.print(`  coreMutationRate: ${radius.coreMutationRate}`);
  interactive.print(`  coreMutationMagnitude: ${radius.coreMutationMagnitude}`);
  interactive.print(`  textureGrowthCount: ${radius.textureGrowthCount}`);
  interactive.print(`  textureEditRate: ${radius.textureEditRate}`);
  interactive.print(`  textureEditMagnitude: ${radius.textureEditMagnitude}`);
  interactive.print(`  bondGrowthCount: ${radius.bondGrowthCount}`);
  interactive.print(`  bondEditRate: ${radius.bondEditRate}`);
  interactive.print(`  domainLock: ${domainLock.length > 0 ? domainLock.join(", ") : "none"}`);
  interactive.print(`  domainFocus: ${domainFocus.length > 0 ? domainFocus.join(", ") : "all"}`);
  interactive.print(
    `  activeHabits: ${activeHabits.length > 0 ? summarizeHabits(activeHabits) : "none"}`,
  );
}

function printCurrentState<Args extends unknown[], Output>(
  interactive: ResolvedInteractiveIO,
  state: WrapperState<Args, Output>,
  activeHabits: Habit[],
): void {
  interactive.print(paint(interactive, "1;34", "Current seed state"));
  interactive.print(`  seed: ${state.currentSeed?.contentHash ?? "none"}`);
  interactive.print(`  values: ${safeStringify(state.currentValues ?? {})}`);
  interactive.print(`  output: ${safeStringify(state.currentOutput)}`);
  interactive.print(
    `  activeHabits: ${activeHabits.length > 0 ? summarizeHabits(activeHabits) : "none"}`,
  );
}

function printTree(
  interactive: ResolvedInteractiveIO,
  tree: RuntimeTreeNode | null,
): void {
  interactive.print(paint(interactive, "1;34", "Current domain tree"));
  if (!tree) {
    interactive.print("  (no tree state)");
    return;
  }
  for (const node of listRuntimeTreeNodes(tree)) {
    const label = node.path || "root";
    const indent = "  ".repeat(node.path ? label.split(".").length : 0);
    interactive.print(
      `${indent}${label} seed=${shortHash(node.seed.contentHash)} children=${node.children.size} behaviors=${Object.keys(node.behaviors).length}`,
    );
  }
}

function printDomainInspection(
  interactive: ResolvedInteractiveIO,
  tree: RuntimeTreeNode | null,
  rawPath: string,
): void {
  const node = resolveTreePath(tree, rawPath);
  interactive.print(paint(interactive, "1;34", `Domain ${node?.path || "root"}`));
  if (!node) {
    interactive.print(`  no domain exists at ${rawPath}`);
    return;
  }
  interactive.print(`  id: ${node.meta.stableId ?? node.meta.runtimeId}`);
  interactive.print(`  version: ${node.meta.version}`);
  interactive.print(`  schemaFingerprint: ${node.meta.schemaFingerprint}`);
  interactive.print(`  seed: ${node.seed.contentHash}`);
  interactive.print(`  children: ${Array.from(node.children.keys()).join(", ") || "none"}`);
  interactive.print(`  behaviors: ${Object.keys(node.behaviors).join(", ") || "none"}`);
  interactive.print(`  relations: ${node.edges.map((edge) => edge.name).join(", ") || "none"}`);
}

function printDomainValues(
  interactive: ResolvedInteractiveIO,
  tree: RuntimeTreeNode | null,
  rawPath: string,
): void {
  const node = resolveTreePath(tree, rawPath);
  interactive.print(paint(interactive, "1;34", `Values ${rawPath}`));
  if (!node) {
    interactive.print(`  no domain exists at ${rawPath}`);
    return;
  }
  interactive.print(`  ${safeStringify(node.values ?? {})}`);
}

function printDomainBehaviors(
  interactive: ResolvedInteractiveIO,
  tree: RuntimeTreeNode | null,
  rawPath: string,
): void {
  const node = resolveTreePath(tree, rawPath);
  interactive.print(paint(interactive, "1;34", `Behaviors ${rawPath}`));
  if (!node) {
    interactive.print(`  no domain exists at ${rawPath}`);
    return;
  }
  interactive.print(`  ${safeStringify(node.behaviors)}`);
}

function printCredits(
  interactive: ResolvedInteractiveIO,
  domainCredits: WrapperState<unknown[], unknown>["domainCreditState"],
): void {
  interactive.print(paint(interactive, "1;34", "Mutation credits"));
  const entries = Object.entries(domainCredits)
    .sort((left, right) => Math.abs(right[1].score) - Math.abs(left[1].score))
    .slice(0, 12);
  if (entries.length === 0) {
    interactive.print("  none");
    return;
  }
  for (const [key, value] of entries) {
    interactive.print(
      `  ${key}: score=${formatCompactNumber(value.score)} confidence=${formatCompactNumber(value.confidence)} samples=${value.samples}`,
    );
  }
}

async function saveSubSeed<Args extends unknown[], Output>(
  state: WrapperState<Args, Output>,
  tree: RuntimeTreeNode | null,
  rawPath: string,
  file: string,
): Promise<void> {
  const node = resolveTreePath(tree, rawPath);
  if (!node || !node.path) {
    throw new CurrentSeedMissingError(`No sub-seed exists at path "${rawPath}"`);
  }
  await writeBytes(file, serializeSeed(node.seed));
  await appendNodeToSeedBank(
    state,
    node,
    null,
    {
      tags: ["manual-save", "save-sub"],
      savedCount: 1,
      ownerPath: resolveTreePath(tree, parentPathOf(node.path))?.path ?? "root",
    },
  );
}

function injectSubSeed<Args extends unknown[], Output>(
  state: WrapperState<Args, Output>,
  tree: RuntimeTreeNode | null,
  rawPath: string,
  bytes: Uint8Array,
): RuntimeTreeNode {
  const nextTree = tree ? cloneRuntimeTreeNode(tree) : null;
  if (!nextTree) {
    throw new CurrentSeedMissingError("No current tree state is available for sub-seed injection");
  }
  const node = resolveTreePath(nextTree, rawPath);
  if (!node || !node.path) {
    throw new CurrentSeedMissingError(`No sub-seed exists at path "${rawPath}"`);
  }
  const seed = parseSeedBytes(bytes);
  node.seed = seed;
  node.values = node.schema ? legacySeedToValues(node.schema, seed) : null;
  state.currentTreeSeed = nextTree;
  state.currentSeed = nextTree.seed;
  state.currentOutput = null;
  state.currentTrace = null;
  return nextTree;
}

function resolveTreePath(
  tree: RuntimeTreeNode | null,
  rawPath: string,
): RuntimeTreeNode | null {
  if (!tree) return null;
  const normalized = rawPath.trim();
  if (!normalized || normalized === "root" || normalized === ".") {
    return tree;
  }
  return findRuntimeTreeNode(tree, normalized);
}

function parentPathOf(path: string): string {
  if (!path) {
    return "root";
  }
  let bracketDepth = 0;
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const char = path[index]!;
    if (char === "]") {
      bracketDepth += 1;
      continue;
    }
    if (char === "[") {
      bracketDepth -= 1;
      continue;
    }
    if (char === "." && bracketDepth === 0) {
      return path.slice(0, index);
    }
  }
  return "root";
}

async function runAdvancedEditor(
  interactive: ResolvedInteractiveIO,
  generation: number,
  targetGenerations: number,
  batchSize: number,
  radius: ReturnType<typeof resolveRadius>,
): Promise<{
  targetGenerations: number;
  batchSize: number;
  radius: ReturnType<typeof resolveRadius>;
}> {
  interactive.print(paint(interactive, "1;34", "Advanced tuning editor"));
  const nextRadius = {
    coreMutationRate: await promptNumber(interactive, "coreMutationRate", radius.coreMutationRate),
    coreMutationMagnitude: await promptNumber(interactive, "coreMutationMagnitude", radius.coreMutationMagnitude),
    textureGrowthCount: await promptInteger(interactive, "textureGrowthCount", radius.textureGrowthCount),
    textureEditRate: await promptNumber(interactive, "textureEditRate", radius.textureEditRate),
    textureEditMagnitude: await promptNumber(interactive, "textureEditMagnitude", radius.textureEditMagnitude),
    bondGrowthCount: await promptInteger(interactive, "bondGrowthCount", radius.bondGrowthCount),
    bondEditRate: await promptNumber(interactive, "bondEditRate", radius.bondEditRate),
  };
  const nextBatchSize = Math.max(1, await promptInteger(interactive, "batchSize", batchSize));
  const remainingAfterPick = Math.max(
    0,
    await promptInteger(
      interactive,
      "remainingGenerationsAfterThisPick",
      Math.max(0, targetGenerations - generation),
    ),
  );
  return {
    targetGenerations: generation + remainingAfterPick,
    batchSize: nextBatchSize,
    radius: nextRadius,
  };
}

async function promptNumber(
  interactive: ResolvedInteractiveIO,
  label: string,
  fallback: number,
): Promise<number> {
  const answer = ((await interactive.prompt(`${label} [${fallback}]`)) ?? "").trim();
  if (!answer) return fallback;
  const parsed = Number(answer);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function promptInteger(
  interactive: ResolvedInteractiveIO,
  label: string,
  fallback: number,
): Promise<number> {
  const answer = ((await interactive.prompt(`${label} [${fallback}]`)) ?? "").trim();
  if (!answer) return fallback;
  const parsed = Number(answer);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function finalizeCurrentState<Args extends unknown[], Output>(
  state: WrapperState<Args, Output>,
  history: GenerationSummary[],
  objectives?: Candidate<Output, Args>["objectives"],
  scope: {
    domainLock?: string[];
    domainFocus?: string[];
  } = {},
): TuneResult<Output> {
  if (!state.currentSeed || state.currentValues === null || state.currentOutput === null) {
    throw new CurrentSeedMissingError("CLI tuning finished without a current seed state");
  }
  return {
    output: state.currentOutput,
    score: history[history.length - 1]?.winnerScore,
    objectives,
    seed: freezeSeedHandle(
      state,
      state.currentSeed,
      state.currentValues,
      state.currentTreeSeed,
      state.domainCredits,
    ),
    history,
    trace: state.currentTrace ?? undefined,
    domainSummaries: buildHierarchicalDomainSummaries(state, scope),
    domainCredits: { ...state.domainCredits },
  };
}

function finalizeAfterInteractiveAbort<Args extends unknown[], Output>(
  state: WrapperState<Args, Output>,
  history: GenerationSummary[],
  objectives?: Candidate<Output, Args>["objectives"],
  error?: InteractiveAbortError,
  scope: {
    domainLock?: string[];
    domainFocus?: string[];
  } = {},
): TuneResult<Output> {
  if (
    state.currentSeed &&
    state.currentValues !== null &&
    state.currentOutput !== null
  ) {
    return finalizeCurrentState(state, history, objectives, scope);
  }
  throw new InteractiveAbortError(
    "Interactive tuning was aborted before a current seed state was established.",
    error ? { cause: error } : undefined,
  );
}

function parseStandalonePosition(command: string): number | null {
  if (!/^\d+$/.test(command)) return null;
  return Number(command);
}

function parseSelectionCommand(command: string, verb: "done" | "pick" | "inspect" | "view"): number | null {
  const match = command.match(new RegExp(`^${verb}\\s+(\\d+)$`));
  return match ? Number(match[1]) : null;
}

function parseSaveCandidateCommand(command: string): { position: number; path: string } | null {
  const match = command.match(/^save\s+(\d+)\s+(.+)$/);
  if (!match) return null;
  return {
    position: Number(match[1]),
    path: match[2].trim(),
  };
}

function parseSaveCurrentCommand(command: string): string | null {
  const match = command.match(/^save-current\s+(.+)$/);
  return match ? match[1].trim() : null;
}

function parsePathCommand(
  command: string,
  verb: "inspect-domain" | "values" | "behavior" | "lock" | "unlock",
): string | null {
  const match = command.match(new RegExp(`^${verb}\\s+(.+)$`));
  return match ? match[1]!.trim() : null;
}

function parsePathAndFileCommand(
  command: string,
  verb: "save-sub" | "set-sub",
): { path: string; file: string } | null {
  const match = command.match(new RegExp(`^${verb}\\s+(\\S+)\\s+(.+)$`));
  if (!match) return null;
  return {
    path: match[1]!.trim(),
    file: match[2]!.trim(),
  };
}

function parseFocusCommand(command: string): string | null {
  if (command === "focus clear") {
    return "";
  }
  const match = command.match(/^focus\s+(.+)$/);
  return match ? match[1]!.trim() : null;
}

function parseRadiusCommand(command: string): "narrow" | "medium" | "broad" | null {
  const match = command.match(/^radius\s+(narrow|medium|broad)$/);
  return (match?.[1] as "narrow" | "medium" | "broad" | undefined) ?? null;
}

function parseNumberCommand(command: string, verb: "batch" | "gens"): number | null {
  const match = command.match(new RegExp(`^${verb}\\s+(\\d+)$`));
  return match ? Number(match[1]) : null;
}

function describeMalformedCommand(command: string): string | null {
  if (/^\d+\s+\S+/.test(command)) {
    return "Mixed-order commands are not supported. Use `0` to pick, or `done 0` to finish.";
  }
  if (/^(done|pick|inspect|view)\b/.test(command)) {
    return "Selection commands must use the form `done <position>`, `pick <position>`, or `inspect <position>`.";
  }
  if (/^radius\b/.test(command)) {
    return "Radius commands must use `radius narrow`, `radius medium`, or `radius broad`.";
  }
  if (/^(batch|gens)\b/.test(command)) {
    return "Numeric commands must use `batch <n>` or `gens <n>` with a positive integer.";
  }
  if (/^save-current\b/.test(command)) {
    return "Save-current commands must use `save-current <path>`.";
  }
  if (/^save\b/.test(command)) {
    return "Save commands must use `save <position> <path>`.";
  }
  if (/^(inspect-domain|values|behavior|lock|unlock)\b/.test(command)) {
    return "Domain commands must use `<verb> <path>` with a tree path such as `child` or `items[0]`.";
  }
  if (/^(save-sub|set-sub)\b/.test(command)) {
    return "Sub-seed commands must use `save-sub <path> <file>` or `set-sub <path> <file>`.";
  }
  if (/^focus\b/.test(command)) {
    return "Focus commands must use `focus <path>` or `focus clear`.";
  }
  return null;
}

function summarizeHabits(habits: Habit[]): string {
  return habits
    .slice(0, 3)
    .map(
      (habit) =>
        `${habit.action.parameter}:${habit.action.direction}@${formatHabitTarget(habit.action.target)} (${habit.evidenceCount})`,
    )
    .join(", ");
}

function formatHabitTarget(value: unknown): string {
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? String(value)
      : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return `bytes(${value.byteLength})`;
  }
  return "value";
}

function shortHash(hash: string): string {
  return hash.slice(0, 12);
}

function formatCompactNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "");
}

function summarizeValues(values: Record<string, unknown>): string {
  const entries = Object.entries(values)
    .slice(0, 4)
    .map(([key, value]) => `${key}=${summarizeValue(value)}`);
  const suffix = Object.keys(values).length > 4 ? " ..." : "";
  return entries.join(", ") + suffix;
}

function summarizeValue(value: unknown): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string") {
    return value.length > 24 ? `${value.slice(0, 21)}...` : value;
  }
  if (value instanceof Uint8Array) {
    return `bytes(${value.byteLength})`;
  }
  return summarizeOutput(value);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(
      value,
      (_key, inner) => {
        if (typeof inner === "bigint") return inner.toString();
        if (inner instanceof Uint8Array) return Array.from(inner);
        return inner;
      },
      2,
    ) ?? "null";
  } catch {
    return "[unserializable]";
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function resolveInitialRadiusLabel(
  radius: "narrow" | "medium" | "broad" | Partial<ReturnType<typeof resolveRadius>>,
): string {
  return typeof radius === "string" ? radius : "custom";
}

function getExploratoryCount(
  assessment: StagnationAssessment | null,
  batchSize: number,
): number {
  const ratio = assessment?.recommendation?.exploratoryRestartRatio ?? 0;
  if (ratio <= 0) {
    return 0;
  }
  return Math.max(1, Math.round(batchSize * ratio));
}

function paint(interactive: ResolvedInteractiveIO, code: string, text: string): string {
  return colorize(interactive, code, text);
}

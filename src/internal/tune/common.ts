import type {
  CliTuneOptions,
  FrozenSeedHandle,
  TuneOptions,
} from "../../public/tune.ts";
import {
  CurationAction,
  InMemoryLineageStore,
  JsonlLineageStore,
  type LineageRecord,
  type LineageStore,
} from "../compat/lineage.ts";
import type { RadiusSetting } from "../compat/mutation.ts";
import type { Seed } from "../compat/seed-format.ts";
import type { WrapperState } from "../runtime/state.ts";
import {
  exportRuntimeTreeEnvelope,
  findRuntimeTreeNode,
  listRuntimeTreePaths,
  type RuntimeTreeNode,
} from "../runtime/tree.ts";
import { serializeSeed } from "../seed/binary.ts";
import type { SeedValueMap } from "../seed/snapshot.ts";
import { writeBytes, writeText } from "../platform/files.ts";
import { deriveDeterministicSeedHex, deriveSeed32 } from "../utils/prng.ts";
import { StableSeedRequiredError } from "../utils/errors.ts";

export type V3LineageRecord = LineageRecord & {
  executionContext?: {
    sessionSeed: string;
    candidateSeed: string;
    batchAttempt: number;
    candidatePosition: number;
  };
};

export interface TuneSessionSeed {
  sessionSeed: string;
  sessionSeed32: number;
}

export interface CandidateSeedInfo {
  candidateSeed: string;
  candidateSeed32: number;
}

export function createLineageStore(
  lineage: TuneOptions<unknown[], unknown>["lineage"] | CliTuneOptions<unknown[], unknown>["lineage"],
): LineageStore {
  if (lineage === false) {
    return new InMemoryLineageStore();
  }
  if (lineage?.path) {
    return new JsonlLineageStore(lineage.path);
  }
  return new InMemoryLineageStore();
}

export function freezeSeedHandle<Args extends unknown[], Output>(
  state: WrapperState<Args, Output>,
  legacySeed: Seed,
  values: SeedValueMap,
  tree?: RuntimeTreeNode | null,
  domainCredits?: Record<string, number>,
): FrozenSeedHandle {
  return {
    get values() {
      return structuredClone(values);
    },
    get meta() {
      return {
        id: state.meta.stableId ?? state.meta.runtimeId,
        version: state.meta.version,
        generation: legacySeed.header.generation,
        hash: legacySeed.contentHash,
      };
    },
    exportBytes() {
      if (!state.meta.stablePersistence) {
        throw new StableSeedRequiredError(
          "This frozen seed came from an ephemeral wrapper. Pass seed(fn, { id }) to enable stable save/load.",
        );
      }
      return serializeSeed(legacySeed);
    },
    async save(path: string) {
      await writeBytes(path, this.exportBytes());
    },
    exportTree() {
      if (!tree) {
        throw new StableSeedRequiredError(
          "This frozen seed does not include a hierarchical tree snapshot to export.",
        );
      }
      return exportRuntimeTreeEnvelope(tree);
    },
    async saveTree(path: string) {
      await writeText(path, `${JSON.stringify(this.exportTree(), null, 2)}\n`);
    },
    importTree() {
      throw new StableSeedRequiredError(
        "Frozen seeds are read-only and cannot import tree state.",
      );
    },
    subSeed(path: string) {
      if (!tree) return null;
      const node = findRuntimeTreeNode(tree, path);
      if (!node || !node.path) return null;
      return {
        path: node.path,
        get values() {
          return node.values ? structuredClone(node.values) : null;
        },
        get meta() {
          return {
            id: node.meta.stableId ?? node.meta.runtimeId,
            version: node.meta.version,
            generation: node.seed.header.generation,
            hash: node.seed.contentHash,
          };
        },
        exportBytes() {
          if (node.meta.stableId === null) {
            throw new StableSeedRequiredError(
              `Sub-seed "${node.path}" belongs to an ephemeral child domain and cannot be exported stably.`,
            );
          }
          return serializeSeed(node.seed);
        },
        async save(pathname: string) {
          await writeBytes(pathname, this.exportBytes());
        },
        clear() {},
      };
    },
    setSubSeed() {
      throw new StableSeedRequiredError(
        "Frozen seeds are read-only and cannot mutate sub-seeds.",
      );
    },
    listSubSeeds() {
      return tree ? listRuntimeTreePaths(tree) : [];
    },
    domainCredits() {
      return { ...(domainCredits ?? {}) };
    },
    clear() {},
  };
}

export function rankWinner<Output extends { score?: number }>(
  candidates: Output[],
  winnerIndex: number,
  getScore: (candidate: Output) => number | undefined,
): number {
  const winner = candidates[winnerIndex];
  if (!winner || getScore(winner) === undefined) return 1;
  const ranked = [...candidates].sort(
    (left, right) =>
      (getScore(right) ?? Number.NEGATIVE_INFINITY) -
      (getScore(left) ?? Number.NEGATIVE_INFINITY),
  );
  return ranked.findIndex((candidate) => candidate === winner) + 1;
}

export function buildLineageRecord<Args extends unknown[], Output>(
  meta: WrapperState<Args, Output>["meta"],
  parentSeed: Seed,
  winner: {
    seed: FrozenSeedHandle;
    legacySeed: Seed;
  },
  radius: RadiusSetting,
  generation: number,
  batchSize: number,
  batchRank: number,
  tags: string[],
  execution: {
    executionSeed: number;
    sessionSeed: string;
    candidateSeed: string;
    batchAttempt: number;
    candidatePosition: number;
    curatorId: string;
    mutationOperator: string;
  },
): V3LineageRecord {
  return {
    seedHash: winner.seed.meta?.hash ?? winner.legacySeed.contentHash,
    origin: {
      type: "mutation",
      parents: [
        {
          seedHash: parentSeed.contentHash,
          contribution: "selected parent",
        },
      ],
      mutationOperator: execution.mutationOperator,
      mutationParameters: { ...radius },
      generationRound: generation,
    },
    curation: {
      curatorId: execution.curatorId,
      curatorAction: CurationAction.SELECT,
      tags,
      batchSize,
      batchRank,
      timestamp: new Date().toISOString(),
    },
    execution: {
      domainId: meta.domainUuid,
      domainVersion: meta.version,
      executionSeed: execution.executionSeed,
      executionTimestamp: new Date().toISOString(),
    },
    executionContext: {
      sessionSeed: execution.sessionSeed,
      candidateSeed: execution.candidateSeed,
      batchAttempt: execution.batchAttempt,
      candidatePosition: execution.candidatePosition,
    },
  };
}

export function createTuneSessionSeed<Args extends unknown[]>(
  meta: WrapperState<Args, unknown>["meta"],
  baseSeedHash: string,
  args: Args,
  tuningOptionsSubset: unknown,
  mode: "tune" | "cli",
): TuneSessionSeed {
  const sessionSeed = deriveDeterministicSeedHex({
    mode,
    wrapperId: meta.stableId ?? meta.runtimeId,
    version: meta.version,
    baseSeedHash,
    args,
    tuningOptionsSubset,
  });
  return {
    sessionSeed,
    sessionSeed32: deriveSeed32(sessionSeed),
  };
}

export function createCandidateSeed(
  sessionSeed: string,
  generation: number,
  batchAttempt: number,
  candidatePosition: number,
): CandidateSeedInfo {
  const candidateSeed = deriveDeterministicSeedHex({
    sessionSeed,
    generation,
    batchAttempt,
    candidatePosition,
  });
  return {
    candidateSeed,
    candidateSeed32: deriveSeed32(candidateSeed),
  };
}

import type { Dollar } from "../../public/dollar.ts";
import type { DomainTraceNode } from "../../public/tune.ts";
import type { DomainCreditState } from "../hierarchical/credit.ts";
import type { SeedBankService } from "../hierarchical/seed-bank.ts";
import type { Seed } from "../compat/seed-format.ts";
import type { SchemaSnapshot } from "../schema/discovery.ts";
import type { SeedValueMap } from "../seed/snapshot.ts";
import type { RuntimeTreeNode } from "./tree.ts";
import { StableSeedRequiredError } from "../utils/errors.ts";

export const SEEDED_WRAPPER_STATE = Symbol.for("cultivar-js.wrapper-state");

export interface WrapperState<Args extends unknown[], Output> {
  readonly fn: (dollar: Dollar, ...args: Args) => Output | Promise<Output>;
  readonly meta: SchemaSnapshot["meta"];
  schema: SchemaSnapshot | null;
  currentSeed: Seed | null;
  currentValues: SeedValueMap | null;
  currentOutput: Output | null;
  currentTreeSeed: RuntimeTreeNode | null;
  currentTrace: DomainTraceNode | null;
  domainCreditState: DomainCreditState;
  domainCredits: Record<string, number>;
  seedBank: SeedBankService | null;
}

export function createWrapperState<Args extends unknown[], Output>(
  fn: (dollar: Dollar, ...args: Args) => Output | Promise<Output>,
  meta: SchemaSnapshot["meta"],
): WrapperState<Args, Output> {
  return {
    fn,
    meta,
    schema: null,
    currentSeed: null,
    currentValues: null,
    currentOutput: null,
    currentTreeSeed: null,
    currentTrace: null,
    domainCreditState: {},
    domainCredits: {},
    seedBank: null,
  };
}

export function attachWrapperState<Args extends unknown[], Output>(
  wrapped: object,
  state: WrapperState<Args, Output>,
): void {
  Object.defineProperty(wrapped, SEEDED_WRAPPER_STATE, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: state,
  });
}

export function getWrapperState<Args extends unknown[], Output>(
  wrapped: object,
): WrapperState<Args, Output> | null {
  if (!(SEEDED_WRAPPER_STATE in wrapped)) {
    return null;
  }
  return (wrapped as Record<PropertyKey, unknown>)[SEEDED_WRAPPER_STATE] as
    | WrapperState<Args, Output>
    | null;
}

export function requireStablePersistence<Args extends unknown[], Output>(
  state: WrapperState<Args, Output>,
): void {
  if (!state.meta.stablePersistence || state.meta.stableId === null) {
    throw new StableSeedRequiredError(
      "This seeded function is ephemeral. Pass seed(fn, { id: 'your.stable.id' }) to enable save/load.",
    );
  }
}

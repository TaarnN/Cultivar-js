import type { SeededFunction } from "./seed.ts";

export type SeedScalar =
  | number
  | bigint
  | boolean
  | string
  | Uint8Array;

export type SeedTypeName =
  | "f64"
  | "f32"
  | "u64"
  | "u32"
  | "u16"
  | "u8"
  | "bool"
  | "string"
  | "bytes";

export type RelationKind =
  | "correlate"
  | "constrain"
  | "sequence"
  | "inhibit"
  | "amplify"
  | "weighted_sum"
  | "threshold_gate"
  | "conditional_blend";

export interface ParamSpec<T> {
  type: SeedTypeName;
  range?: [number, number];
  default?: T;
  tier?: "core" | "texture";
}

export interface RelationSpec {
  kind: RelationKind;
  weight?: number;
  params?: Record<string, unknown>;
}

export interface CheckSpec {
  message?: string;
  enforcement?: "reject" | "warn";
}

export type BehaviorTarget = Record<string, number>;

export interface BehaviorConstraintSpec {
  min?: number;
  max?: number;
  eq?: number;
}

export interface DomainInvokeOptions {
  reuse?: "default" | "bank-best" | "bank-nearest";
  behaviorTarget?: BehaviorTarget;
  behaviorConstraints?: Record<string, BehaviorConstraintSpec>;
}

export interface Dollar {
  <T extends SeedScalar>(name: string, spec: ParamSpec<T>): T;
  rel(source: string | string[], target: string, spec: RelationSpec): void;
  check(
    name: string,
    predicate: () => boolean | Promise<boolean>,
    spec?: CheckSpec,
  ): Promise<void>;
  domain<SubArgs extends unknown[], SubOutput>(
    name: string,
    subFn: SeededFunction<SubArgs, SubOutput>,
    args: SubArgs,
    options?: DomainInvokeOptions,
  ): Promise<SubOutput>;
  domainList<Item, SubArgs extends unknown[], SubOutput>(
    name: string,
    items: readonly Item[],
    keyFn: (item: Item, index: number) => string | number,
    subFn: SeededFunction<SubArgs, SubOutput>,
    argsFn: (item: Item, index: number) => SubArgs,
    options?: DomainInvokeOptions,
  ): Promise<SubOutput[]>;
  behavior(name: string, value: number): void;
  domainRel(source: string, target: string, spec: RelationSpec): void;
}

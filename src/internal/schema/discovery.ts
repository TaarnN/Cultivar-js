import type { CheckSpec, ParamSpec, RelationSpec, SeedScalar } from "../../public/dollar.ts";
import {
  acceptedDomainUuidsFromStableId,
  createIdFactory,
  domainUuidFromStableId,
} from "./identity.ts";
import { canonicalSerialize } from "../utils/canonical.ts";
import { createRuntimeUuid } from "../utils/crypto.ts";
import { SchemaDeclarationError } from "../utils/errors.ts";

export interface NormalizedMeta {
  runtimeId: string;
  stableId: string | null;
  version: string;
  name: string;
  entropyBudget: number;
  radius: "narrow" | "medium" | "broad";
  stablePersistence: boolean;
  domainUuid: string;
  acceptedDomainUuids: string[];
}

export interface DiscoveredParam {
  name: string;
  spec: ParamSpec<SeedScalar>;
  fieldId: number;
  tier: "core" | "texture";
}

export interface DiscoveredRelation {
  name: string;
  sources: string[];
  target: string;
  spec: RelationSpec;
  relationId: number;
}

export interface DiscoveredCheck {
  name: string;
  enforcement: "reject" | "warn";
  message?: string;
}

export interface DiscoveredDomainSlot {
  name: string;
  path: string;
  mode: "single" | "list";
  child: {
    id: string | null;
    version: string;
    name: string;
    domainUuid: string;
    schemaFingerprint: string;
  };
}

export interface DiscoveredBehavior {
  name: string;
  valueType: "number";
}

export interface DiscoveredDomainRelation {
  name: string;
  source: string;
  target: string;
  spec: RelationSpec;
}

export interface SchemaSnapshot {
  meta: NormalizedMeta;
  params: DiscoveredParam[];
  paramsByName: Record<string, DiscoveredParam>;
  relations: DiscoveredRelation[];
  checks: DiscoveredCheck[];
  domainSlots: DiscoveredDomainSlot[];
  behaviors: DiscoveredBehavior[];
  domainRelations: DiscoveredDomainRelation[];
}

export function normalizeMeta(
  meta?: {
    id?: string;
    version?: string;
    name?: string;
    entropyBudget?: number;
    radius?: "narrow" | "medium" | "broad";
  },
): NormalizedMeta {
  const stableId = meta?.id?.trim() ? meta.id.trim() : null;
  const runtimeId = stableId ?? `ephemeral:${createRuntimeUuid()}`;
  const version = meta?.version?.trim() || "1";
  const name = meta?.name?.trim() || stableId || "ephemeral-seeded-function";
  const identitySource = stableId ?? runtimeId;
  const domainUuid = domainUuidFromStableId(identitySource);
  return {
    runtimeId,
    stableId,
    version,
    name,
    entropyBudget: meta?.entropyBudget ?? 128,
    radius: meta?.radius ?? "medium",
    stablePersistence: stableId !== null,
    domainUuid,
    acceptedDomainUuids:
      stableId !== null
        ? acceptedDomainUuidsFromStableId(stableId)
        : [domainUuid],
  };
}

export function createDiscoverySession(meta: NormalizedMeta): {
  registerParam<T extends SeedScalar>(
    name: string,
    spec: ParamSpec<T>,
  ): DiscoveredParam;
  registerRelation(
    source: string | string[],
    target: string,
    spec: RelationSpec,
  ): DiscoveredRelation;
  registerCheck(name: string, spec?: CheckSpec): DiscoveredCheck;
  registerDomainSlot(slot: {
    name: string;
    path: string;
    mode: "single" | "list";
    child: DiscoveredDomainSlot["child"];
  }): DiscoveredDomainSlot;
  registerBehavior(name: string): DiscoveredBehavior;
  registerDomainRelation(
    source: string,
    target: string,
    spec: RelationSpec,
  ): DiscoveredDomainRelation;
  freeze(): SchemaSnapshot;
} {
  const paramsByName = new Map<string, DiscoveredParam>();
  const relationsByName = new Map<string, DiscoveredRelation>();
  const checksByName = new Map<string, DiscoveredCheck>();
  const domainSlotsByName = new Map<string, DiscoveredDomainSlot>();
  const behaviorsByName = new Map<string, DiscoveredBehavior>();
  const domainRelationsByName = new Map<string, DiscoveredDomainRelation>();
  const ids = createIdFactory(meta.stableId ?? meta.runtimeId, meta.version);

  return {
    registerParam(name, spec) {
      const normalizedSpec = normalizeParamSpec(spec);
      const existing = paramsByName.get(name);
      if (existing) {
        if (canonicalSerialize(existing.spec) !== canonicalSerialize(normalizedSpec)) {
          throw new SchemaDeclarationError(
            `Parameter "${name}" was declared more than once with incompatible specs`,
          );
        }
        return existing;
      }

      const tier = normalizedSpec.tier ?? "core";
      const param: DiscoveredParam = {
        name,
        spec: normalizedSpec,
        fieldId: ids.fieldId(name, tier),
        tier,
      };
      paramsByName.set(name, param);
      return param;
    },

    registerRelation(source, target, spec) {
      const sources = Array.isArray(source) ? [...source] : [source];
      const name = `${sources.join("+")}->${target}`;
      const normalizedSpec = {
        kind: spec.kind,
        weight: spec.weight,
        params: spec.params ? structuredClone(spec.params) : undefined,
      } satisfies RelationSpec;
      const existing = relationsByName.get(name);
      if (existing) {
        if (canonicalSerialize(existing.spec) !== canonicalSerialize(normalizedSpec)) {
          throw new SchemaDeclarationError(
            `Relationship "${name}" was declared more than once with incompatible specs`,
          );
        }
        return existing;
      }

      const relation: DiscoveredRelation = {
        name,
        sources,
        target,
        spec: normalizedSpec,
        relationId: ids.relationId(name),
      };
      relationsByName.set(name, relation);
      return relation;
    },

    registerCheck(name, spec) {
      const existing = checksByName.get(name);
      const check: DiscoveredCheck = {
        name,
        enforcement: spec?.enforcement ?? "reject",
        message: spec?.message,
      };
      if (existing) {
        if (canonicalSerialize(existing) !== canonicalSerialize(check)) {
          throw new SchemaDeclarationError(
            `Check "${name}" was declared more than once with incompatible specs`,
          );
        }
        return existing;
      }
      checksByName.set(name, check);
      return check;
    },

    registerDomainSlot(slot) {
      const normalized = {
        name: normalizeDomainSlotName(slot.name),
        path: normalizeScopedReference(slot.path),
        mode: slot.mode,
        child: {
          id: slot.child.id,
          version: slot.child.version,
          name: slot.child.name,
          domainUuid: slot.child.domainUuid,
          schemaFingerprint: slot.child.schemaFingerprint,
        },
      } satisfies DiscoveredDomainSlot;
      const existing = domainSlotsByName.get(normalized.name);
      if (existing) {
        if (canonicalSerialize(existing) !== canonicalSerialize(normalized)) {
          throw new SchemaDeclarationError(
            `Domain slot "${normalized.name}" was declared more than once with incompatible child schemas`,
          );
        }
        return existing;
      }
      domainSlotsByName.set(normalized.name, normalized);
      return normalized;
    },

    registerBehavior(name) {
      const normalizedName = normalizeBehaviorName(name);
      const existing = behaviorsByName.get(normalizedName);
      if (existing) {
        return existing;
      }
      const behavior: DiscoveredBehavior = {
        name: normalizedName,
        valueType: "number",
      };
      behaviorsByName.set(normalizedName, behavior);
      return behavior;
    },

    registerDomainRelation(source, target, spec) {
      const normalizedSpec = {
        kind: spec.kind,
        weight: spec.weight,
        params: spec.params ? structuredClone(spec.params) : undefined,
      } satisfies RelationSpec;
      const normalizedSource = normalizeRelationEndpoint(source);
      const normalizedTarget = normalizeRelationEndpoint(target);
      const name = `${normalizedSource}->${normalizedTarget}`;
      const existing = domainRelationsByName.get(name);
      const relation: DiscoveredDomainRelation = {
        name,
        source: normalizedSource,
        target: normalizedTarget,
        spec: normalizedSpec,
      };
      if (existing) {
        if (canonicalSerialize(existing) !== canonicalSerialize(relation)) {
          throw new SchemaDeclarationError(
            `Domain relationship "${name}" was declared more than once with incompatible specs`,
          );
        }
        return existing;
      }
      domainRelationsByName.set(name, relation);
      return relation;
    },

    freeze() {
      const params = Array.from(paramsByName.values()).sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      const relations = Array.from(relationsByName.values()).sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      const checks = Array.from(checksByName.values()).sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      const domainSlots = Array.from(domainSlotsByName.values()).sort((left, right) =>
        left.path.localeCompare(right.path),
      );
      const behaviors = Array.from(behaviorsByName.values()).sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      const domainRelations = Array.from(domainRelationsByName.values()).sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      validateDomainRelationEndpoints(params, domainSlots, behaviors, domainRelations);
      return {
        meta,
        params,
        paramsByName: Object.fromEntries(params.map((param) => [param.name, param])),
        relations,
        checks,
        domainSlots,
        behaviors,
        domainRelations,
      };
    },
  };
}

function normalizeParamSpec<T extends SeedScalar>(spec: ParamSpec<T>): ParamSpec<SeedScalar> {
  return {
    type: spec.type,
    range: spec.range ? [...spec.range] : undefined,
    default:
      spec.default instanceof Uint8Array
        ? new Uint8Array(spec.default)
        : spec.default,
    tier: spec.tier ?? "core",
  };
}

function normalizeDomainSlotName(name: string): string {
  const normalized = name.trim();
  if (!normalized) {
    throw new SchemaDeclarationError("Domain slot names must not be empty");
  }
  if (/[.[\]#]/u.test(normalized)) {
    throw new SchemaDeclarationError(
      `Domain slot "${normalized}" contains reserved path characters (. [ ] #)`,
    );
  }
  return normalized;
}

function normalizeBehaviorName(name: string): string {
  const normalized = name.trim();
  if (!normalized) {
    throw new SchemaDeclarationError("Behavior names must not be empty");
  }
  if (/[.#]/u.test(normalized)) {
    throw new SchemaDeclarationError(
      `Behavior "${normalized}" contains reserved path characters (. #)`,
    );
  }
  return normalized;
}

function normalizeScopedReference(reference: string): string {
  const normalized = reference.trim();
  if (!normalized) {
    throw new SchemaDeclarationError("Scoped references must not be empty");
  }
  return normalized;
}

function normalizeRelationEndpoint(endpoint: string): string {
  const normalized = normalizeScopedReference(endpoint);
  if (normalized.startsWith("behavior:")) {
    return `behavior:${normalizeBehaviorName(normalized.slice("behavior:".length))}`;
  }
  if (normalized.startsWith("param:")) {
    return `param:${normalizeScopedReference(normalized.slice("param:".length))}`;
  }
  if (normalized.includes(".")) {
    return `param:${normalized}`;
  }
  return normalizeScopedReference(normalized);
}

function validateDomainRelationEndpoints(
  params: DiscoveredParam[],
  domainSlots: DiscoveredDomainSlot[],
  behaviors: DiscoveredBehavior[],
  domainRelations: DiscoveredDomainRelation[],
): void {
  const knownParams = new Set(params.map((param) => `param:${param.name}`));
  const knownSlots = new Set(domainSlots.map((slot) => slot.path));
  const knownBehaviors = new Set(behaviors.map((behavior) => `behavior:${behavior.name}`));
  for (const relation of domainRelations) {
    if (!isKnownRelationEndpoint(relation.source, knownParams, knownSlots, knownBehaviors)) {
      throw new SchemaDeclarationError(
        `Unknown domain relation source "${relation.source}"`,
      );
    }
    if (!isKnownRelationEndpoint(relation.target, knownParams, knownSlots, knownBehaviors)) {
      throw new SchemaDeclarationError(
        `Unknown domain relation target "${relation.target}"`,
      );
    }
  }
}

function isKnownRelationEndpoint(
  endpoint: string,
  knownParams: Set<string>,
  knownSlots: Set<string>,
  knownBehaviors: Set<string>,
): boolean {
  if (knownSlots.has(endpoint) || knownBehaviors.has(endpoint) || knownParams.has(endpoint)) {
    return true;
  }
  if (!endpoint.startsWith("param:")) {
    return false;
  }
  const reference = endpoint.slice("param:".length);
  const splitIndex = findLastScopedSeparator(reference);
  if (splitIndex < 0) {
    return false;
  }
  const ownerPath = reference.slice(0, splitIndex);
  const paramName = reference.slice(splitIndex + 1);
  return Boolean(paramName) && knownSlots.has(ownerPath);
}

function findLastScopedSeparator(reference: string): number {
  let bracketDepth = 0;
  for (let index = reference.length - 1; index >= 0; index -= 1) {
    const char = reference[index]!;
    if (char === "]") {
      bracketDepth += 1;
      continue;
    }
    if (char === "[") {
      bracketDepth -= 1;
      continue;
    }
    if (char === "." && bracketDepth === 0) {
      return index;
    }
  }
  return -1;
}

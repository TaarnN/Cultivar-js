import {
  FieldTypeTag,
  RelationshipType,
  SEED_MAGIC,
  SEED_VERSION_V2,
  SeedParser,
  SeedSerializer,
  type BondField,
  type BondParameters,
  type BondTargetRef,
  type FieldValue,
  type FieldCondition,
  type PrimitiveFieldValue,
  type Seed,
  type SeedField,
  isArrayFieldValue,
  isCompositeFieldValue,
} from "../compat/seed-format.ts";
import type {
  DomainBondDefinition,
  DomainFieldDefinition,
  DomainManifest,
} from "../compat/domain.ts";
import type { ParamSpec, SeedScalar } from "../../public/dollar.ts";
import type { DiscoveredParam, DiscoveredRelation, SchemaSnapshot } from "../schema/discovery.ts";
import {
  SchemaDeclarationError,
  SeedDomainMismatchError,
  SeedSchemaVersionMismatchError,
} from "../utils/errors.ts";

export type SeedValueMap = Record<string, SeedScalar>;

export function materializeInitialValue(spec: ParamSpec<SeedScalar>): SeedScalar {
  if (spec.default !== undefined) {
    return cloneSeedScalar(spec.default);
  }
  switch (spec.type) {
    case "bool":
      return false;
    case "string":
      return "";
    case "bytes":
      return new Uint8Array();
    case "u64":
      return BigInt(spec.range?.[0] ?? 0);
    default:
      if (spec.range) {
        return spec.range[0] + (spec.range[1] - spec.range[0]) / 2;
      }
      return 0;
  }
}

export function snapshotToLegacySeed(
  schema: SchemaSnapshot,
  values: SeedValueMap,
  generation: number = 0,
): Seed {
  const coreFields: SeedField[] = [];
  const textureFields: SeedField[] = [];

  for (const param of schema.params) {
    const value = Object.prototype.hasOwnProperty.call(values, param.name)
      ? values[param.name]
      : materializeInitialValue(param.spec);
    const field: SeedField = {
      id: param.fieldId,
      typeTag: toLegacyFieldType(param.spec.type),
      value: toLegacyFieldValue(param.spec, value),
    };
    if (param.tier === "texture") {
      textureFields.push(field);
    } else {
      coreFields.push(field);
    }
  }

  const bondFields = schema.relations.map((relation) =>
    relationToBondField(relation, schema.paramsByName),
  );

  return rehash({
    header: {
      magic: SEED_MAGIC,
      version: SEED_VERSION_V2,
      domainId: schema.meta.domainUuid,
      generation,
      entropyBudget: schema.meta.entropyBudget,
      coreSize: 0,
      textureSize: 0,
      bondSize: 0,
      flags: 0,
      crc32: 0,
      domainSchemaVersion: schema.meta.version,
    },
    coreFields: coreFields.sort((left, right) => left.id - right.id),
    textureFields: textureFields.sort((left, right) => left.id - right.id),
    bondFields,
    contentHash: "",
  });
}

export function legacySeedToValues(
  schema: SchemaSnapshot,
  seed: Seed,
): SeedValueMap {
  const values: SeedValueMap = {};
  for (const param of schema.params) {
    values[param.name] = materializeInitialValue(param.spec);
  }
  for (const field of [...seed.coreFields, ...seed.textureFields]) {
    const param = schema.params.find((candidate) => candidate.fieldId === field.id);
    if (!param) continue;
    values[param.name] = fromLegacyFieldValue(field.value);
  }
  return values;
}

export function legacySeedToFieldValueMap(seed: Seed): Map<number, SeedScalar> {
  const map = new Map<number, SeedScalar>();
  for (const field of [...seed.coreFields, ...seed.textureFields]) {
    map.set(field.id, fromLegacyFieldValue(field.value));
  }
  return map;
}

export function snapshotToManifest(schema: SchemaSnapshot): DomainManifest {
  const coreFields = schema.params
    .filter((param) => param.tier === "core")
    .map((param) => toDomainField(param, true));
  const textureFields = schema.params
    .filter((param) => param.tier === "texture")
    .map((param) => toDomainField(param, false));

  return {
    id: schema.meta.domainUuid,
    name: schema.meta.name,
    version: schema.meta.version,
    description: `${schema.meta.name} wrapper-generated manifest`,
    determinism: "nondeterministic",
    entropyBudgetDefault: schema.meta.entropyBudget,
    coreFields,
    textureFields,
    bondFields: schema.relations.map((relation) =>
      toDomainBondDefinition(relation, schema.paramsByName),
    ),
    constraints: [],
    knowledge: {
      description: `${schema.meta.name} inline seeded function`,
      defaultBehavior: "Use discovered defaults and relation hints",
    },
  };
}

export function assertSeedMatchesSchema(schema: SchemaSnapshot, seed: Seed): void {
  if (!schema.meta.acceptedDomainUuids.includes(seed.header.domainId)) {
    throw new SeedDomainMismatchError(
      `Loaded seed domain ${seed.header.domainId} does not match seeded function domain ${schema.meta.domainUuid}`,
    );
  }
  if (seed.header.domainSchemaVersion !== schema.meta.version) {
    throw new SeedSchemaVersionMismatchError(
      `Loaded seed version ${seed.header.domainSchemaVersion} does not match seeded function version ${schema.meta.version}`,
    );
  }
}

function rehash(seed: Seed): Seed {
  return SeedParser.parse(SeedSerializer.serialize(seed));
}

function toDomainField(
  param: DiscoveredParam,
  required: boolean,
): DomainFieldDefinition {
  return {
    id: param.fieldId,
    name: param.name,
    typeTag: toLegacyFieldType(param.spec.type),
    required,
    default:
      param.spec.default === undefined
        ? undefined
        : toLegacyFieldValue(param.spec, param.spec.default),
    range: param.spec.range ? [...param.spec.range] : undefined,
    decisionRange: param.spec.range
      ? { min: param.spec.range[0], max: param.spec.range[1] }
      : undefined,
    semantics: `${param.name} seeded parameter`,
    growthWeight: param.tier === "texture" ? 1 : undefined,
  };
}

function relationToBondField(
  relation: DiscoveredRelation,
  paramsByName: Record<string, DiscoveredParam>,
): BondField {
  const sources = relation.sources.map((name) => {
    const param = paramsByName[name];
    if (!param) {
      throw new SchemaDeclarationError(`Unknown relation source parameter ${name}`);
    }
    return {
      fieldId: param.fieldId,
      weight:
        relation.spec.weight !== undefined
          ? relation.spec.weight
          : 1 / Math.max(1, relation.sources.length),
    };
  });

  const targetParam = paramsByName[relation.target];
  if (!targetParam) {
    throw new SchemaDeclarationError(`Unknown relation target parameter ${relation.target}`);
  }

  return {
    id: relation.relationId,
    sourceFieldId: sources[0]?.fieldId,
    targetFieldId: targetParam.fieldId,
    sources,
    target: {
      fieldId: targetParam.fieldId,
      blendMode: toBlendMode(relation.spec.kind),
    },
    parameters: toBondParameters(relation, targetParam),
  };
}

function toDomainBondDefinition(
  relation: DiscoveredRelation,
  paramsByName: Record<string, DiscoveredParam>,
): DomainBondDefinition {
  const bond = relationToBondField(relation, paramsByName);
  return {
    id: relation.relationId,
    name: relation.name,
    sourceField: bond.sourceFieldId,
    targetField: bond.targetFieldId,
    target: bond.targetFieldId,
    sources: bond.sources,
    targetRef: bond.target,
    relationshipTypes: [toLegacyRelationshipType(relation.spec.kind)],
    defaultParameters: bond.parameters,
    semantics: `${relation.spec.kind} seeded relationship`,
  };
}

function toLegacyFieldType(type: ParamSpec<SeedScalar>["type"]): FieldTypeTag {
  switch (type) {
    case "u8":
      return FieldTypeTag.UINT8;
    case "u16":
      return FieldTypeTag.UINT16;
    case "u32":
      return FieldTypeTag.UINT32;
    case "u64":
      return FieldTypeTag.UINT64;
    case "f32":
      return FieldTypeTag.FLOAT32;
    case "f64":
      return FieldTypeTag.FLOAT64;
    case "bool":
      return FieldTypeTag.BOOL;
    case "string":
      return FieldTypeTag.STRING;
    case "bytes":
      return FieldTypeTag.BYTES;
  }
}

function toLegacyFieldValue(
  spec: ParamSpec<SeedScalar>,
  value: SeedScalar,
): FieldValue {
  switch (spec.type) {
    case "u64":
      return coerceUint64Value(value);
    case "u8":
    case "u16":
    case "u32":
    case "f32":
    case "f64":
      return coerceNumericValue(spec.type, value);
    case "bool":
      return Boolean(value);
    case "string":
      return typeof value === "string" ? value : String(value);
    case "bytes":
      return value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array();
    default:
      return assertNever(spec.type);
  }
}

function fromLegacyFieldValue(value: FieldValue): SeedScalar {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (isArrayFieldValue(value) || isCompositeFieldValue(value)) {
    throw new SchemaDeclarationError(
      "Wrapper-facing seeded functions only support scalar values; array and composite legacy values are not supported here.",
    );
  }
  return value;
}

function toLegacyRelationshipType(kind: DiscoveredRelation["spec"]["kind"]): RelationshipType {
  switch (kind) {
    case "correlate":
      return RelationshipType.CORRELATE;
    case "constrain":
      return RelationshipType.CONSTRAIN;
    case "sequence":
      return RelationshipType.SEQUENCE;
    case "inhibit":
      return RelationshipType.INHIBIT;
    case "amplify":
      return RelationshipType.AMPLIFY;
    case "weighted_sum":
      return RelationshipType.WEIGHTED_SUM;
    case "threshold_gate":
      return RelationshipType.THRESHOLD_GATE;
    case "conditional_blend":
      return RelationshipType.CONDITIONAL_BLEND;
  }
}

function toBlendMode(kind: DiscoveredRelation["spec"]["kind"]): BondTargetRef["blendMode"] {
  switch (kind) {
    case "amplify":
    case "inhibit":
      return "multiplicative";
    case "conditional_blend":
      return "conditional";
    default:
      return "additive";
  }
}

function toBondParameters(
  relation: DiscoveredRelation,
  target: DiscoveredParam,
): BondParameters {
  const params = relation.spec.params ?? {};
  const weight = relation.spec.weight ?? 0.25;
  switch (relation.spec.kind) {
    case "correlate":
      return {
        type: RelationshipType.CORRELATE,
        rho:
          typeof params.rho === "number"
            ? clamp(params.rho, -1, 1)
            : clamp(weight, -1, 1),
      };
    case "constrain":
      return {
        type: RelationshipType.CONSTRAIN,
        min:
          typeof params.min === "number"
            ? params.min
            : (target.spec.range?.[0] ?? 0),
        max:
          typeof params.max === "number"
            ? params.max
            : (target.spec.range?.[1] ?? 1),
      };
    case "sequence":
      return {
        type: RelationshipType.SEQUENCE,
        offset:
          typeof params.offset === "number"
            ? Math.max(0, Math.round(params.offset))
            : Math.max(0, Math.round(weight)),
      };
    case "inhibit":
      return {
        type: RelationshipType.INHIBIT,
        strength:
          typeof params.strength === "number"
            ? clamp(params.strength, 0, 1)
            : clamp(weight, 0, 1),
      };
    case "amplify":
      return {
        type: RelationshipType.AMPLIFY,
        factor:
          typeof params.factor === "number"
            ? Math.max(1, params.factor)
            : Math.max(1, 1 + weight),
      };
    case "weighted_sum":
      return {
        type: RelationshipType.WEIGHTED_SUM,
        bias: typeof params.bias === "number" ? params.bias : 0,
        clamp: target.spec.range ? [...target.spec.range] : undefined,
      };
    case "threshold_gate":
      return {
        type: RelationshipType.THRESHOLD_GATE,
        threshold: typeof params.threshold === "number" ? params.threshold : weight,
        activeValue:
          typeof params.activeValue === "number"
            ? params.activeValue
            : target.spec.range?.[1],
        inactiveValue:
          typeof params.inactiveValue === "number"
            ? params.inactiveValue
            : target.spec.range?.[0],
      };
    case "conditional_blend":
      return {
        type: RelationshipType.CONDITIONAL_BLEND,
        conditions: normalizeConditionalBlendConditions(params.conditions),
        blendFactor:
          typeof params.blendFactor === "number"
            ? Math.max(0, params.blendFactor)
            : Math.max(0, weight),
        targetMin:
          typeof params.targetMin === "number"
            ? params.targetMin
            : target.spec.range?.[0],
        targetMax:
          typeof params.targetMax === "number"
            ? params.targetMax
            : target.spec.range?.[1],
        fallbackValue:
          typeof params.fallbackValue === "number"
            ? params.fallbackValue
            : undefined,
      };
  }
}

function normalizeConditionalBlendConditions(value: unknown): FieldCondition[] {
  if (value === undefined) {
    return [];
  }
  if (!isConditionArray(value)) {
    throw new SchemaDeclarationError(
      "conditional_blend params.conditions must be an array of valid condition objects",
    );
  }
  return value.map((entry) => ({
    field: entry.field,
    op: entry.op,
    value: cloneConditionValue(entry.value),
  }));
}

function isConditionArray(value: unknown): value is FieldConditionInput[] {
  return Array.isArray(value) && value.every((entry) => isFieldConditionInput(entry));
}

type ConditionOperator = FieldCondition["op"];
type ConditionPrimitive = PrimitiveFieldValue;
type ConditionValue = FieldCondition["value"];

interface FieldConditionInput {
  field: number | string;
  op: ConditionOperator;
  value: ConditionValue;
}

function isFieldConditionInput(value: unknown): value is FieldConditionInput {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isConditionField(value.field) &&
    isConditionOperator(value.op) &&
    isConditionValue(value.value)
  );
}

function isConditionField(value: unknown): value is number | string {
  return typeof value === "number" || typeof value === "string";
}

function isConditionOperator(value: unknown): value is ConditionOperator {
  return (
    value === "<" ||
    value === "<=" ||
    value === ">" ||
    value === ">=" ||
    value === "==" ||
    value === "!=" ||
    value === "in" ||
    value === "not_in"
  );
}

function isConditionValue(value: unknown): value is ConditionValue {
  if (isConditionPrimitive(value)) {
    return true;
  }
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((entry: unknown) => isConditionPrimitive(entry));
}

function isConditionPrimitive(value: unknown): value is PrimitiveFieldValue {
  return (
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    value instanceof Uint8Array
  );
}

function cloneConditionValue(value: ConditionValue): ConditionValue {
  if (Array.isArray(value)) {
    return value.map((entry) => clonePrimitiveConditionValue(entry));
  }
  return clonePrimitiveConditionValue(value);
}

function clonePrimitiveConditionValue(value: PrimitiveFieldValue): PrimitiveFieldValue {
  return value instanceof Uint8Array ? new Uint8Array(value) : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cloneSeedScalar(value: SeedScalar): SeedScalar {
  return value instanceof Uint8Array ? new Uint8Array(value) : value;
}

function coerceNumericValue(
  type: Exclude<ParamSpec<SeedScalar>["type"], "u64" | "bool" | "string" | "bytes">,
  value: SeedScalar,
): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new SchemaDeclarationError(
    `Parameter type ${type} requires a numeric-compatible value.`,
  );
}

function coerceUint64Value(value: SeedScalar): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new SchemaDeclarationError("Parameter type u64 requires a finite numeric-compatible value.");
    }
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "boolean") {
    return value ? 1n : 0n;
  }
  if (typeof value === "string") {
    try {
      return BigInt(value);
    } catch {
      // Fall through to the typed error below.
    }
  }
  throw new SchemaDeclarationError(
    "Parameter type u64 requires a bigint, integer-like number, boolean, or decimal string value.",
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function assertNever(value: never): never {
  throw new SchemaDeclarationError(`Unsupported parameter type: ${String(value)}`);
}

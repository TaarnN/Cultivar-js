import type { SchemaSnapshot } from "./discovery.ts";
import { fingerprintCanonicalValue } from "../utils/canonical.ts";
import { SchemaDriftError } from "../utils/errors.ts";

export function validateSchemaCompatibility(
  frozen: SchemaSnapshot,
  discovered: SchemaSnapshot,
): void {
  const frozenDescriptor = schemaFingerprint(frozen);
  const discoveredDescriptor = schemaFingerprint(discovered);
  if (frozenDescriptor !== discoveredDescriptor) {
    throw new SchemaDriftError(
      `Detected schema drift for ${frozen.meta.name}. Parameter, relationship, or domain declarations changed; bump meta.version to create a new stable schema.`,
    );
  }
}

export function schemaFingerprint(schema: SchemaSnapshot): string {
  return fingerprintCanonicalValue({
    version: schema.meta.version,
    params: schema.params.map((param) => ({
      name: param.name,
      tier: param.tier,
      spec: param.spec,
    })),
    relations: schema.relations.map((relation) => ({
      name: relation.name,
      sources: relation.sources,
      target: relation.target,
      spec: relation.spec,
    })),
    checks: schema.checks,
    domainSlots: schema.domainSlots.map((slot) => ({
      name: slot.name,
      path: slot.path,
      mode: slot.mode,
      child: slot.child,
    })),
    behaviors: schema.behaviors,
    domainRelations: schema.domainRelations.map((relation) => ({
      name: relation.name,
      source: relation.source,
      target: relation.target,
      spec: relation.spec,
    })),
  });
}

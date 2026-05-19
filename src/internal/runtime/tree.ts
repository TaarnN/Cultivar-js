import { Buffer } from "node:buffer";

import type { RelationKind } from "../../public/dollar.ts";
import type {
  DomainEdge,
  DomainTraceNode,
  TreeSeedEnvelope,
  TreeSeedNode,
} from "../../public/tune.ts";
import type { Seed } from "../compat/seed-format.ts";
import { acceptedDomainUuidsFromStableId } from "../schema/identity.ts";
import type { NormalizedMeta, SchemaSnapshot } from "../schema/discovery.ts";
import { parseSeedBytes, serializeSeed } from "../seed/binary.ts";
import type { SeedValueMap } from "../seed/snapshot.ts";
import { canonicalSerialize, fingerprintCanonicalValue } from "../utils/canonical.ts";
import { computeSHA256Hex } from "../utils/crypto.ts";
import {
  SeedCorruptedError,
  StableSeedRequiredError,
} from "../utils/errors.ts";

export interface RuntimeTreeMeta {
  runtimeId: string;
  stableId: string | null;
  name: string;
  version: string;
  domainUuid: string;
  acceptedDomainUuids: string[];
  schemaFingerprint: string;
}

export interface RuntimeDomainEdge extends DomainEdge {}

export interface RuntimeTreeNode {
  path: string;
  key: string;
  meta: RuntimeTreeMeta;
  schema: SchemaSnapshot | null;
  seed: Seed;
  values: SeedValueMap | null;
  behaviors: Record<string, number>;
  edges: RuntimeDomainEdge[];
  children: Map<string, RuntimeTreeNode>;
}

export interface RuntimeTraceBuildInput {
  path: string;
  meta: RuntimeTreeMeta;
  seedHash: string;
  output: unknown;
  warnings: string[];
  behaviors: Record<string, number>;
  edges: RuntimeDomainEdge[];
  children: DomainTraceNode[];
}

export function createRootOnlyRuntimeTreeNode(
  meta: NormalizedMeta,
  schemaFingerprint: string,
  seed: Seed,
  values: SeedValueMap | null,
): RuntimeTreeNode {
  return createRuntimeTreeNode({
    path: "",
    key: "",
    meta: runtimeTreeMetaFromSchemaMeta(meta, schemaFingerprint),
    schema: null,
    seed,
    values,
    behaviors: {},
    edges: [],
    children: [],
  });
}

export function createRuntimeTreeNode(input: {
  path: string;
  key: string;
  meta: RuntimeTreeMeta;
  schema?: SchemaSnapshot | null;
  seed: Seed;
  values: SeedValueMap | null;
  behaviors?: Record<string, number>;
  edges?: RuntimeDomainEdge[];
  children?: RuntimeTreeNode[];
}): RuntimeTreeNode {
  return {
    path: input.path,
    key: input.key,
    meta: {
      ...input.meta,
      acceptedDomainUuids: [...input.meta.acceptedDomainUuids],
    },
    schema: input.schema ?? null,
    seed: cloneSeed(input.seed),
    values: input.values ? structuredClone(input.values) : null,
    behaviors: structuredClone(input.behaviors ?? {}),
    edges: cloneRuntimeEdges(input.edges ?? []),
    children: new Map(
      (input.children ?? []).map((child) => [child.key, cloneRuntimeTreeNode(child)]),
    ),
  };
}

export function cloneRuntimeTreeNode(node: RuntimeTreeNode): RuntimeTreeNode {
  return createRuntimeTreeNode({
    path: node.path,
    key: node.key,
    meta: node.meta,
    schema: node.schema,
    seed: node.seed,
    values: node.values,
    behaviors: node.behaviors,
    edges: node.edges,
    children: Array.from(node.children.values()),
  });
}

export function runtimeTreeMetaFromSchemaMeta(
  meta: NormalizedMeta,
  schemaFingerprint: string,
): RuntimeTreeMeta {
  return {
    runtimeId: meta.runtimeId,
    stableId: meta.stableId,
    name: meta.name,
    version: meta.version,
    domainUuid: meta.domainUuid,
    acceptedDomainUuids: [...meta.acceptedDomainUuids],
    schemaFingerprint,
  };
}

export function attachRuntimeChildNode(
  parent: RuntimeTreeNode,
  child: RuntimeTreeNode,
): void {
  parent.children.set(child.key, child);
}

export function makeChildPath(parentPath: string, childKey: string): string {
  return parentPath ? `${parentPath}.${childKey}` : childKey;
}

export function makeListChildKey(slotName: string, key: string | number): string {
  return `${slotName}[${encodeURIComponent(String(key))}]`;
}

export function splitRuntimePath(path: string): string[] {
  if (!path.trim()) return [];
  const segments: string[] = [];
  let current = "";
  let bracketDepth = 0;
  for (const char of path) {
    if (char === "[" && bracketDepth >= 0) {
      bracketDepth += 1;
      current += char;
      continue;
    }
    if (char === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
      current += char;
      continue;
    }
    if (char === "." && bracketDepth === 0) {
      if (current) {
        segments.push(current);
      }
      current = "";
      continue;
    }
    current += char;
  }
  if (current) {
    segments.push(current);
  }
  return segments;
}

export function findRuntimeTreeNode(
  root: RuntimeTreeNode | null,
  path: string,
): RuntimeTreeNode | null {
  if (!root) return null;
  const segments = splitRuntimePath(path);
  let cursor: RuntimeTreeNode | null = root;
  for (const segment of segments) {
    cursor = cursor?.children.get(segment) ?? null;
    if (!cursor) {
      return null;
    }
  }
  return cursor;
}

export function listRuntimeTreePaths(root: RuntimeTreeNode | null): string[] {
  if (!root) return [];
  const paths: string[] = [];
  for (const child of root.children.values()) {
    collectPaths(child, paths);
  }
  return paths.sort((left, right) => left.localeCompare(right));
}

export function countRuntimePathDepth(path: string): number {
  return splitRuntimePath(path).length;
}

export function listRuntimeTreeNodes(root: RuntimeTreeNode | null): RuntimeTreeNode[] {
  if (!root) return [];
  const nodes: RuntimeTreeNode[] = [];
  walkRuntimeTree(root, (node) => {
    nodes.push(node);
  });
  return nodes;
}

export function buildDomainTraceNode(input: RuntimeTraceBuildInput): DomainTraceNode {
  return {
    path: input.path,
    id: input.meta.stableId ?? input.meta.runtimeId,
    name: input.meta.name,
    version: input.meta.version,
    domainUuid: input.meta.domainUuid,
    schemaFingerprint: input.meta.schemaFingerprint,
    seedHash: input.seedHash,
    outputHash: fingerprintCanonicalValue(input.output),
    warnings: [...input.warnings],
    behaviors: structuredClone(input.behaviors),
    domainEdges: cloneDomainEdges(input.edges),
    children: input.children.map((child) => cloneDomainTraceNode(child)),
  };
}

export function cloneDomainTraceNode(node: DomainTraceNode): DomainTraceNode {
  return {
    path: node.path,
    id: node.id,
    name: node.name,
    version: node.version,
    domainUuid: node.domainUuid,
    schemaFingerprint: node.schemaFingerprint,
    seedHash: node.seedHash,
    outputHash: node.outputHash,
    warnings: [...node.warnings],
    behaviors: structuredClone(node.behaviors),
    domainEdges: cloneDomainEdges(node.domainEdges),
    children: node.children.map((child) => cloneDomainTraceNode(child)),
  };
}

export function exportRuntimeTreeEnvelope(root: RuntimeTreeNode): TreeSeedEnvelope {
  assertStableTree(root);
  const seedStore: Record<string, string> = {};
  const rootNode = serializeRuntimeTreeNode(root, seedStore);
  const domainEdges = collectRuntimeDomainEdges(root);
  const body = {
    format: "SDTREE/1" as const,
    root: rootNode,
    seedStore,
    domainEdges,
    schemaFingerprint: root.meta.schemaFingerprint,
  };
  return {
    ...body,
    integrityHash: computeTreeIntegrityHash(body),
  };
}

export function importRuntimeTreeEnvelope(envelope: TreeSeedEnvelope): RuntimeTreeNode {
  const body = {
    format: envelope.format,
    root: envelope.root,
    seedStore: envelope.seedStore,
    domainEdges: envelope.domainEdges,
    schemaFingerprint: envelope.schemaFingerprint,
  };
  const integrityHash = computeTreeIntegrityHash(body);
  if (integrityHash !== envelope.integrityHash) {
    throw new SeedCorruptedError(
      `Tree seed integrity mismatch: expected ${envelope.integrityHash}, got ${integrityHash}`,
    );
  }

  const edgesByOwnerPath = new Map<string, RuntimeDomainEdge[]>();
  for (const edge of envelope.domainEdges) {
    const bucket = edgesByOwnerPath.get(edge.ownerPath) ?? [];
    bucket.push({
      name: edge.name,
      ownerPath: edge.ownerPath,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      weight: edge.weight,
      params: edge.params ? structuredClone(edge.params) : undefined,
    });
    edgesByOwnerPath.set(edge.ownerPath, bucket);
  }

  return deserializeRuntimeTreeNode(
    envelope.root,
    envelope.seedStore,
    edgesByOwnerPath,
  );
}

export function absoluteBehaviorPath(ownerPath: string, name: string): string {
  return ownerPath ? `${ownerPath}#${name}` : `#${name}`;
}

export function absoluteDomainPath(ownerPath: string, path: string): string {
  return ownerPath ? `${ownerPath}.${path}` : path;
}

function collectPaths(node: RuntimeTreeNode, paths: string[]): void {
  paths.push(node.path);
  for (const child of node.children.values()) {
    collectPaths(child, paths);
  }
}

function cloneSeed(seed: Seed): Seed {
  return parseSeedBytes(serializeSeed(seed));
}

function assertStableTree(node: RuntimeTreeNode): void {
  if (node.meta.stableId === null) {
    const label = node.path || node.meta.name;
    throw new StableSeedRequiredError(
      `Tree persistence requires stable seeded functions. Domain "${label}" is ephemeral.`,
    );
  }
  for (const child of node.children.values()) {
    assertStableTree(child);
  }
}

function serializeRuntimeTreeNode(
  node: RuntimeTreeNode,
  seedStore: Record<string, string>,
): TreeSeedNode {
  const bytes = serializeSeed(node.seed);
  seedStore[node.seed.contentHash] = Buffer.from(bytes).toString("base64");
  return {
    path: node.path,
    key: node.key,
    wrapperId: node.meta.stableId ?? node.meta.runtimeId,
    stableId: node.meta.stableId,
    name: node.meta.name,
    version: node.meta.version,
    domainUuid: node.meta.domainUuid,
    schemaFingerprint: node.meta.schemaFingerprint,
    seedHash: node.seed.contentHash,
    behaviors: structuredClone(node.behaviors),
    children: Array.from(node.children.values())
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((child) => serializeRuntimeTreeNode(child, seedStore)),
  };
}

function collectRuntimeDomainEdges(root: RuntimeTreeNode): DomainEdge[] {
  const edges: DomainEdge[] = [];
  walkRuntimeTree(root, (node) => {
    for (const edge of node.edges) {
      edges.push({
        name: edge.name,
        ownerPath: edge.ownerPath,
        source: edge.source,
        target: edge.target,
        kind: edge.kind,
        weight: edge.weight,
        params: edge.params ? structuredClone(edge.params) : undefined,
      });
    }
  });
  return edges.sort((left, right) =>
    `${left.ownerPath}:${left.name}`.localeCompare(`${right.ownerPath}:${right.name}`),
  );
}

function walkRuntimeTree(
  node: RuntimeTreeNode,
  visit: (node: RuntimeTreeNode) => void,
): void {
  visit(node);
  for (const child of node.children.values()) {
    walkRuntimeTree(child, visit);
  }
}

function deserializeRuntimeTreeNode(
  node: TreeSeedNode,
  seedStore: Record<string, string>,
  edgesByOwnerPath: Map<string, RuntimeDomainEdge[]>,
): RuntimeTreeNode {
  const encodedSeed = seedStore[node.seedHash];
  if (!encodedSeed) {
    throw new SeedCorruptedError(`Missing seed bytes for tree node ${node.path || "<root>"}`);
  }
  const seed = parseSeedBytes(new Uint8Array(Buffer.from(encodedSeed, "base64")));
  const acceptedDomainUuids =
    node.stableId === null
      ? [node.domainUuid]
      : acceptedDomainUuidsFromStableId(node.stableId);
  return {
    path: node.path,
    key: node.key,
    meta: {
      runtimeId: node.wrapperId,
      stableId: node.stableId,
      name: node.name,
      version: node.version,
      domainUuid: node.domainUuid,
      acceptedDomainUuids,
      schemaFingerprint: node.schemaFingerprint,
    },
    schema: null,
    seed,
    values: null,
    behaviors: structuredClone(node.behaviors),
    edges: cloneRuntimeEdges(edgesByOwnerPath.get(node.path) ?? []),
    children: new Map(
      node.children
        .map((child) => deserializeRuntimeTreeNode(child, seedStore, edgesByOwnerPath))
        .map((child) => [child.key, child] as const),
    ),
  };
}

function cloneRuntimeEdges(edges: RuntimeDomainEdge[]): RuntimeDomainEdge[] {
  return edges.map((edge) => ({
    name: edge.name,
    ownerPath: edge.ownerPath,
    source: edge.source,
    target: edge.target,
    kind: edge.kind,
    weight: edge.weight,
    params: edge.params ? structuredClone(edge.params) : undefined,
  }));
}

function cloneDomainEdges(edges: RuntimeDomainEdge[] | DomainEdge[]): DomainEdge[] {
  return edges.map((edge) => ({
    name: edge.name,
    ownerPath: edge.ownerPath,
    source: edge.source,
    target: edge.target,
    kind: edge.kind as RelationKind,
    weight: edge.weight,
    params: edge.params ? structuredClone(edge.params) : undefined,
  }));
}

function computeTreeIntegrityHash(body: Omit<TreeSeedEnvelope, "integrityHash">): string {
  return computeSHA256Hex(new TextEncoder().encode(canonicalSerialize(body)));
}

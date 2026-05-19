import type { TreeCacheOptions } from "../../public/tune.ts";
import type { DomainTraceNode } from "../../public/tune.ts";
import type { Seed } from "../compat/seed-format.ts";
import type { SchemaSnapshot } from "../schema/discovery.ts";
import type { SeedValueMap } from "../seed/snapshot.ts";
import {
  cloneDomainTraceNode,
  cloneRuntimeTreeNode,
  type RuntimeTreeNode,
} from "../runtime/tree.ts";
import { fingerprintCanonicalValue } from "../utils/canonical.ts";

export interface CachedInvocationResult<Output = unknown> {
  output: Output;
  schema: SchemaSnapshot;
  values: SeedValueMap;
  legacySeed: Seed;
  warnings: string[];
  tree: RuntimeTreeNode;
  trace: DomainTraceNode;
}

export interface TreeInvocationCache {
  readonly maxEntries: number;
  get<Output>(key: string, path: string, keyName: string): CachedInvocationResult<Output> | null;
  set<Output>(key: string, value: CachedInvocationResult<Output>): void;
}

interface StoredCacheEntry {
  result: CachedInvocationResult<unknown>;
}

const INITIAL_SEED_SIGNATURE = "__initial__";

export function createTreeInvocationCache(
  options: false | TreeCacheOptions | undefined,
): TreeInvocationCache | null {
  if (options === false) {
    return null;
  }
  const maxEntries = Math.max(8, options?.maxEntries ?? 256);
  const entries = new Map<string, StoredCacheEntry>();
  return {
    maxEntries,
    get<Output>(key: string, path: string, keyName: string) {
      const entry = entries.get(key);
      if (!entry) {
        return null;
      }
      entries.delete(key);
      entries.set(key, entry);
      return cloneCachedInvocationResult(
        entry.result,
        path,
        keyName,
      ) as CachedInvocationResult<Output>;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, {
        result: cloneCachedInvocationResult(value, value.tree.path, value.tree.key),
      });
      while (entries.size > maxEntries) {
        const oldestKey = entries.keys().next().value;
        if (!oldestKey) {
          break;
        }
        entries.delete(oldestKey);
      }
    },
  };
}

export function createTreeCacheKey(input: {
  domainId: string;
  version: string;
  schemaFingerprint: string;
  seedSignature: string;
  args: unknown;
}): string {
  return fingerprintCanonicalValue({
    domainId: input.domainId,
    version: input.version,
    schemaFingerprint: input.schemaFingerprint,
    seedSignature: input.seedSignature,
    args: input.args,
  });
}

export function resolveRuntimeTreeSeedSignature(
  tree: RuntimeTreeNode | null,
  seed: Seed | null,
): string {
  if (tree) {
    return fingerprintCanonicalValue({
      self: tree.seed.contentHash,
      children: Array.from(tree.children.values())
        .sort((left, right) => left.key.localeCompare(right.key))
        .map((child) => ({
          key: child.key,
          signature: resolveRuntimeTreeSeedSignature(child, child.seed),
        })),
    });
  }
  return seed?.contentHash ?? INITIAL_SEED_SIGNATURE;
}

function cloneCachedInvocationResult<Output>(
  result: CachedInvocationResult<Output>,
  path: string,
  keyName: string,
): CachedInvocationResult<Output> {
  const tree = cloneRuntimeTreeNode(result.tree);
  const trace = cloneDomainTraceNode(result.trace);
  const originalPath = tree.path;
  rebaseRuntimeTree(tree, originalPath, path, keyName);
  rebaseTraceTree(trace, originalPath, path);
  return {
    output: safeClone(result.output),
    schema: result.schema,
    values: structuredClone(result.values),
    legacySeed: structuredClone(result.legacySeed),
    warnings: [...result.warnings],
    tree,
    trace,
  };
}

function rebaseRuntimeTree(
  node: RuntimeTreeNode,
  fromPath: string,
  toPath: string,
  keyName: string,
): void {
  node.path = replacePathPrefix(node.path, fromPath, toPath);
  node.key = node.path === toPath ? keyName : node.key;
  for (const edge of node.edges) {
    edge.ownerPath = replacePathPrefix(edge.ownerPath, fromPath, toPath);
    edge.source = replacePathPrefix(edge.source, fromPath, toPath);
    edge.target = replacePathPrefix(edge.target, fromPath, toPath);
  }
  for (const child of node.children.values()) {
    rebaseRuntimeTree(child, fromPath, toPath, child.key);
  }
}

function rebaseTraceTree(
  node: DomainTraceNode,
  fromPath: string,
  toPath: string,
): void {
  node.path = replacePathPrefix(node.path, fromPath, toPath);
  for (const edge of node.domainEdges) {
    edge.ownerPath = replacePathPrefix(edge.ownerPath, fromPath, toPath);
    edge.source = replacePathPrefix(edge.source, fromPath, toPath);
    edge.target = replacePathPrefix(edge.target, fromPath, toPath);
  }
  for (const child of node.children) {
    rebaseTraceTree(child, fromPath, toPath);
  }
}

function replacePathPrefix(
  value: string,
  fromPath: string,
  toPath: string,
): string {
  if (fromPath === toPath || !value) {
    return value;
  }
  if (value === fromPath) {
    return toPath;
  }
  for (const separator of [".", "[", "#"]) {
    if (value.startsWith(`${fromPath}${separator}`)) {
      return `${toPath}${value.slice(fromPath.length)}`;
    }
  }
  return value;
}

function safeClone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

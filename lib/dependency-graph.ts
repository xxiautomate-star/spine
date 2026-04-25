// Dependency graph: parses package.json + import statements from indexed memory
// content to build a lightweight cross-repo dependency map. Stored in
// spine_dependency_nodes + spine_dependency_edges.
//
// Primary use case: when a query mentions a package name (e.g. "framer-motion"),
// findReposByPackage() identifies which repos use it and returns relevant memories
// from each — so "how do we use framer-motion?" searches across all repos at once.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from './supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DepType = 'depends_on' | 'devDependency' | 'peerDependency' | 'imports';
export type NodeType = 'package' | 'file' | 'module';

export type DependencyNode = {
  id: string;
  repo: string;
  name: string;
  type: NodeType;
  version?: string;
};

export type PackageUsage = {
  repo: string;
  version: string | null;
  dep_type: DepType;
  memory_excerpts: string[];
};

export type IndexResult = {
  repo: string;
  packages_indexed: number;
  files_indexed: number;
  edges_created: number;
  errors: string[];
};

// ── Package.json parser ───────────────────────────────────────────────────────

type PackageJson = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

function parsePackageJson(content: string): PackageJson | null {
  try {
    // Strip leading junk (e.g. session header lines) before the first {
    const jsonStart = content.indexOf('{');
    if (jsonStart === -1) return null;
    return JSON.parse(content.slice(jsonStart)) as PackageJson;
  } catch {
    return null;
  }
}

function extractPackageJsonFromMemory(content: string): PackageJson | null {
  // Look for the characteristic package.json structure inside memory content
  const match = content.match(/\{[\s\S]*?"(?:dependencies|devDependencies|name)"[\s\S]*?\}/);
  if (!match) return null;
  return parsePackageJson(match[0]);
}

// ── Import statement parser ───────────────────────────────────────────────────

const IMPORT_PATTERNS = [
  // ESM static: import X from 'y'
  /import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"./][^'"]*)['"]/g,
  // CommonJS: require('y')
  /require\s*\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g,
  // Dynamic: import('y')
  /import\s*\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g,
];

function extractImports(content: string): Set<string> {
  const imports = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) {
      const pkg = m[1].split('/')[0]; // normalize @scope/pkg → @scope/pkg, pkg/sub → pkg
      const normalised =
        pkg.startsWith('@') && m[1].split('/').length >= 2
          ? m[1].split('/').slice(0, 2).join('/')
          : pkg;
      if (normalised && normalised.length > 0) imports.add(normalised);
    }
  }
  return imports;
}

// ── Node upsert ───────────────────────────────────────────────────────────────

async function upsertNode(
  sb: SupabaseClient,
  userId: string,
  repo: string,
  name: string,
  type: NodeType,
  version?: string
): Promise<string | null> {
  const { data: existing } = await sb
    .from('spine_dependency_nodes')
    .select('id')
    .eq('user_id', userId)
    .eq('repo', repo)
    .eq('name', name)
    .eq('type', type)
    .maybeSingle();

  if (existing) {
    if (version) {
      await sb
        .from('spine_dependency_nodes')
        .update({ version, updated_at: new Date().toISOString() })
        .eq('id', existing.id as string);
    }
    return existing.id as string;
  }

  const { data: inserted, error } = await sb
    .from('spine_dependency_nodes')
    .insert({ user_id: userId, repo, name, type, version })
    .select('id')
    .maybeSingle();

  if (error || !inserted) return null;
  return inserted.id as string;
}

async function upsertEdge(
  sb: SupabaseClient,
  userId: string,
  repo: string,
  fromNodeId: string,
  toNodeId: string,
  depType: DepType
): Promise<boolean> {
  const { error } = await sb
    .from('spine_dependency_edges')
    .upsert(
      { user_id: userId, repo, from_node: fromNodeId, to_node: toNodeId, dep_type: depType },
      { onConflict: 'from_node,to_node,dep_type', ignoreDuplicates: true }
    );
  return !error;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Index a repo's dependency graph from its captured memories.
 *
 * Scans memories tagged with the given repo/project for package.json content
 * and import statements, then upserts nodes + edges. Safe to re-run — all
 * writes are upserts.
 *
 * Call this after bulk-capturing memories for a new repo.
 */
export async function indexRepoDependencies(
  userId: string,
  repo: string
): Promise<IndexResult> {
  const sb = getSupabase();
  if (!sb) throw new Error('Spine not configured.');

  const result: IndexResult = {
    repo,
    packages_indexed: 0,
    files_indexed: 0,
    edges_created: 0,
    errors: [],
  };

  // Fetch all memories for this repo
  const { data: memories, error: fetchErr } = await sb
    .from('memories')
    .select('id, content, source')
    .eq('user_id', userId)
    .eq('project', repo)
    .is('deleted_at', null)
    .limit(500);

  if (fetchErr || !memories) {
    result.errors.push(fetchErr?.message ?? 'Failed to fetch memories');
    return result;
  }

  // The "root" node for this repo (represents the repo itself)
  const rootId = await upsertNode(sb, userId, repo, repo, 'module');

  for (const mem of memories) {
    const content = mem.content as string;
    const source = (mem.source as string | null) ?? '';

    // ── package.json content ────────────────────────────────────────────────
    if (source.includes('package.json') || content.includes('"dependencies"')) {
      const pkg = extractPackageJsonFromMemory(content);
      if (pkg) {
        const depGroups: Array<[Record<string, string> | undefined, DepType]> = [
          [pkg.dependencies, 'depends_on'],
          [pkg.devDependencies, 'devDependency'],
          [pkg.peerDependencies, 'peerDependency'],
        ];

        for (const [deps, depType] of depGroups) {
          if (!deps) continue;
          for (const [pkgName, version] of Object.entries(deps)) {
            const nodeId = await upsertNode(sb, userId, repo, pkgName, 'package', version);
            if (nodeId && rootId) {
              const ok = await upsertEdge(sb, userId, repo, rootId, nodeId, depType);
              if (ok) {
                result.edges_created++;
                result.packages_indexed++;
              }
            }
          }
        }
        continue; // don't also scan imports from package.json content
      }
    }

    // ── Import statements ───────────────────────────────────────────────────
    const imports = extractImports(content);
    if (imports.size > 0 && source) {
      // File node for this source
      const fileId = await upsertNode(sb, userId, repo, source, 'file');
      if (fileId) {
        result.files_indexed++;
        for (const pkgName of imports) {
          const pkgId = await upsertNode(sb, userId, repo, pkgName, 'package');
          if (pkgId) {
            const ok = await upsertEdge(sb, userId, repo, fileId, pkgId, 'imports');
            if (ok) result.edges_created++;
          }
        }
      }
    }
  }

  return result;
}

/**
 * Find all repos that depend on a given package and return usage evidence.
 *
 * When a query mentions a specific npm package, call this to discover which
 * repos use it, at what version, and surface memory excerpts showing how.
 */
export async function findReposByPackage(
  userId: string,
  packageName: string
): Promise<PackageUsage[]> {
  const sb = getSupabase();
  if (!sb) return [];

  // Find all nodes matching this package name across repos
  const { data: nodes } = await sb
    .from('spine_dependency_nodes')
    .select('id, repo, version')
    .eq('user_id', userId)
    .eq('name', packageName)
    .eq('type', 'package');

  if (!nodes || nodes.length === 0) return [];

  const usages: PackageUsage[] = [];

  for (const node of nodes) {
    const repo = node.repo as string;
    const version = (node.version as string | null) ?? null;

    // Infer dep_type from edges (highest-weight edge type wins)
    const { data: edges } = await sb
      .from('spine_dependency_edges')
      .select('dep_type')
      .eq('user_id', userId)
      .eq('to_node', node.id as string)
      .limit(1);

    const depType = (edges?.[0]?.dep_type as DepType | undefined) ?? 'depends_on';

    // Surface up to 3 memory excerpts from this repo mentioning the package
    const { data: mentions } = await sb
      .from('memories')
      .select('content')
      .eq('user_id', userId)
      .eq('project', repo)
      .is('deleted_at', null)
      .ilike('content', `%${packageName}%`)
      .limit(3);

    const excerpts = (mentions ?? []).map((m) => {
      const content = m.content as string;
      const idx = content.toLowerCase().indexOf(packageName.toLowerCase());
      const start = Math.max(0, idx - 80);
      const end = Math.min(content.length, idx + packageName.length + 160);
      return `…${content.slice(start, end)}…`;
    });

    usages.push({ repo, version, dep_type: depType, memory_excerpts: excerpts });
  }

  return usages;
}

/**
 * Return the full dependency list for a repo — all package nodes + their edge types.
 */
export async function getRepoDependencies(
  userId: string,
  repo: string
): Promise<Array<{ name: string; version: string | null; dep_type: DepType }>> {
  const sb = getSupabase();
  if (!sb) return [];

  const { data } = await sb
    .from('spine_dependency_edges')
    .select('dep_type, spine_dependency_nodes!to_node(name, version)')
    .eq('user_id', userId)
    .eq('repo', repo);

  type EdgeRow = {
    dep_type: unknown;
    spine_dependency_nodes: unknown;
  };
  return ((data ?? []) as EdgeRow[])
    .filter((r) => r.spine_dependency_nodes && typeof r.spine_dependency_nodes === 'object')
    .map((r) => {
      const node = r.spine_dependency_nodes as { name: string; version: string | null };
      return {
        name: node.name,
        version: node.version,
        dep_type: r.dep_type as DepType,
      };
    });
}

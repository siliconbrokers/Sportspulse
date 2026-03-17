/**
 * validate-doc-registry.ts
 *
 * Validates consistency between docs/_registry/document-registry.md and
 * the actual governed artifacts in docs/.
 *
 * Checks:
 *   1. Every canonical_path listed in the registry exists on disk.
 *   2. Every governed doc on disk (with YAML frontmatter) has an entry in the registry.
 *   3. Version in registry matches version in frontmatter.
 *   4. Status in registry matches status in frontmatter.
 *
 * Usage:
 *   pnpm tsx scripts/validate-doc-registry.ts
 *   pnpm tsx scripts/validate-doc-registry.ts --fix-hints   (prints what needs updating)
 */

import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "..");
const REGISTRY_PATH = path.join(
  REPO_ROOT,
  "docs/_registry/document-registry.md"
);
const DOCS_ROOT = path.join(REPO_ROOT, "docs");

// Folders explicitly excluded from the "unregistered doc" check
const EXCLUDED_DIRS = new Set([
  "docs/archive",
  "docs/_governance",
  "docs/_registry",
]);

// ─── Types ────────────────────────────────────────────────────────────────────

interface RegistryEntry {
  artifact_id: string;
  title: string;
  class: string;
  status: string;
  version: string | null;
  canonical_path: string;
}

interface DocFrontmatter {
  artifact_id?: string;
  version?: string;
  status?: string;
  canonical_path?: string;
}

interface Finding {
  severity: "ERROR" | "WARN";
  type: string;
  detail: string;
}

// ─── Registry parser ──────────────────────────────────────────────────────────

function parseRegistry(content: string): RegistryEntry[] {
  const entries: RegistryEntry[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    // Match table rows that look like: | ID | title | class | status | version | path |
    // Also handle rows without version column: | ID | title | class | status | path |
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || trimmed.startsWith("| artifact_id") || trimmed.startsWith("|---")) {
      continue;
    }

    const cells = trimmed
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    if (cells.length === 6) {
      // artifact_id | title | class | status | version | canonical_path
      entries.push({
        artifact_id: cells[0],
        title: cells[1],
        class: cells[2],
        status: cells[3],
        version: cells[4],
        canonical_path: cells[5],
      });
    } else if (cells.length === 5) {
      // artifact_id | title | class | status | canonical_path  (plans table omits version)
      entries.push({
        artifact_id: cells[0],
        title: cells[1],
        class: cells[2],
        status: cells[3],
        version: null,
        canonical_path: cells[4],
      });
    }
  }

  return entries;
}

// ─── Frontmatter parser ───────────────────────────────────────────────────────

function parseFrontmatter(content: string): DocFrontmatter | null {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return null;

  const yaml = content.slice(4, end);
  const result: DocFrontmatter = {};

  for (const line of yaml.split("\n")) {
    const match = line.match(/^(\w+):\s*"?([^"]+)"?\s*$/);
    if (match) {
      const [, key, value] = match;
      if (key === "artifact_id") result.artifact_id = value.trim();
      if (key === "version") result.version = value.trim();
      if (key === "status") result.status = value.trim();
      if (key === "canonical_path") result.canonical_path = value.trim();
    }
  }

  return result;
}

// ─── File walker ──────────────────────────────────────────────────────────────

function walkDocs(dir: string, results: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(REPO_ROOT, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      if (!Array.from(EXCLUDED_DIRS).some((ex) => relPath.startsWith(ex))) {
        walkDocs(fullPath, results);
      }
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(relPath);
    }
  }
  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const showFixHints = process.argv.includes("--fix-hints");

  // 1. Parse registry
  if (!fs.existsSync(REGISTRY_PATH)) {
    console.error(`ERROR: Registry not found at ${REGISTRY_PATH}`);
    process.exit(1);
  }
  const registryContent = fs.readFileSync(REGISTRY_PATH, "utf-8");
  const entries = parseRegistry(registryContent);

  const registryByPath = new Map<string, RegistryEntry>();
  const registryById = new Map<string, RegistryEntry>();
  for (const e of entries) {
    registryByPath.set(e.canonical_path, e);
    registryById.set(e.artifact_id, e);
  }

  const findings: Finding[] = [];

  // 2. Check 1: every path in registry exists on disk
  for (const entry of entries) {
    const absPath = path.join(REPO_ROOT, entry.canonical_path);
    if (!fs.existsSync(absPath)) {
      findings.push({
        severity: "ERROR",
        type: "REGISTRY_PATH_NOT_FOUND",
        detail: `Registry entry '${entry.artifact_id}' points to '${entry.canonical_path}' which does not exist on disk.`,
      });
    }
  }

  // 3. Walk docs and check each governed doc
  const allDocPaths = walkDocs(DOCS_ROOT);

  for (const relPath of allDocPaths) {
    const absPath = path.join(REPO_ROOT, relPath);
    const content = fs.readFileSync(absPath, "utf-8");
    const fm = parseFrontmatter(content);

    // Only check files with YAML frontmatter (governed artifacts)
    if (!fm || !fm.artifact_id) continue;

    const registryEntry = registryByPath.get(relPath) ?? registryById.get(fm.artifact_id ?? "");

    // Check 2: governed doc not in registry
    if (!registryEntry) {
      findings.push({
        severity: "ERROR",
        type: "UNREGISTERED_ARTIFACT",
        detail: `'${relPath}' has frontmatter (artifact_id: ${fm.artifact_id}) but no entry in the registry.`,
      });
      continue;
    }

    // Check 3: version mismatch
    if (fm.version && registryEntry.version && fm.version !== registryEntry.version) {
      findings.push({
        severity: "WARN",
        type: "VERSION_MISMATCH",
        detail: `'${relPath}': frontmatter version=${fm.version} but registry says ${registryEntry.version}.`,
      });
      if (showFixHints) {
        console.log(
          `  FIX: Update registry entry '${registryEntry.artifact_id}' version from ${registryEntry.version} → ${fm.version}`
        );
      }
    }

    // Check 4: status mismatch
    if (fm.status && registryEntry.status && fm.status !== registryEntry.status) {
      findings.push({
        severity: "WARN",
        type: "STATUS_MISMATCH",
        detail: `'${relPath}': frontmatter status=${fm.status} but registry says ${registryEntry.status}.`,
      });
      if (showFixHints) {
        console.log(
          `  FIX: Update registry entry '${registryEntry.artifact_id}' status from ${registryEntry.status} → ${fm.status}`
        );
      }
    }

    // Check 5: canonical_path in frontmatter must match actual file location
    if (fm.canonical_path && fm.canonical_path !== relPath) {
      findings.push({
        severity: "WARN",
        type: "CANONICAL_PATH_STALE",
        detail: `'${relPath}': frontmatter canonical_path='${fm.canonical_path}' does not match actual file location.`,
      });
      if (showFixHints) {
        console.log(
          `  FIX: In '${relPath}' update canonical_path from '${fm.canonical_path}' → '${relPath}'`
        );
      }
    }
  }

  // ─── Report ───────────────────────────────────────────────────────────────

  const errors = findings.filter((f) => f.severity === "ERROR");
  const warnings = findings.filter((f) => f.severity === "WARN");

  console.log(`\n── Document Registry Validation ────────────────────────────`);
  console.log(`   Registry entries checked : ${entries.length}`);
  console.log(`   Governed docs on disk    : ${allDocPaths.filter((p) => {
    const content = fs.readFileSync(path.join(REPO_ROOT, p), "utf-8");
    const fm = parseFrontmatter(content);
    return fm && fm.artifact_id;
  }).length}`);
  console.log(`   Errors                   : ${errors.length}`);
  console.log(`   Warnings                 : ${warnings.length}`);
  console.log(`────────────────────────────────────────────────────────────\n`);

  if (errors.length > 0) {
    console.log("ERRORS (must fix):");
    for (const f of errors) {
      console.log(`  [${f.type}] ${f.detail}`);
    }
    console.log();
  }

  if (warnings.length > 0) {
    console.log("WARNINGS (should fix):");
    for (const f of warnings) {
      console.log(`  [${f.type}] ${f.detail}`);
    }
    console.log();
  }

  if (findings.length === 0) {
    console.log("✓ Registry is consistent with disk. No findings.\n");
  }

  // Exit 1 if any errors (suitable for CI)
  if (errors.length > 0) {
    process.exit(1);
  }
}

main();

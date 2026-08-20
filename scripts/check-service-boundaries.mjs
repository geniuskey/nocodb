import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(repositoryRoot, "packages/nocodb/src");
const manifestPath = "docs/SERVICE_BOUNDARY_EXCEPTIONS.json";
const ruleNames = [
  "transportToPersistence",
  "dataEngineToApplication",
  "domainToApplication",
  "lowerLayerToTransport",
];

const normalizePath = (path) => path.split(sep).join("/");
const repositoryPath = (path) => normalizePath(relative(repositoryRoot, path));

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

function isTypeOnlyImport(clause) {
  const normalized = clause.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (normalized.startsWith("type ")) return true;
  if (!normalized.startsWith("{") || !normalized.endsWith("}")) return false;
  const names = normalized
    .slice(1, -1)
    .split(",")
    .map((name) => name.trim());
  return names.length > 0 && names.every((name) => name.startsWith("type "));
}

function runtimeBindings(clause) {
  const normalized = clause.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (isTypeOnlyImport(normalized)) return [];
  const bindings = [];
  const namedMatch = normalized.match(/\{([\s\S]*?)\}/);
  if (namedMatch) {
    for (const item of namedMatch[1].split(",")) {
      const name = item.trim();
      if (!name || name.startsWith("type ")) continue;
      bindings.push(name.split(/\s+as\s+/)[0]);
    }
  }
  if (normalized.includes("* as ") || normalized.startsWith("*")) {
    bindings.push("*");
  }
  const beforeNamed = normalized.split(/[,{*]/)[0].trim();
  if (beforeNamed && beforeNamed !== "type") bindings.push("default");
  return [...new Set(bindings)].sort();
}

function importsIn(source) {
  const imports = [];
  const importFrom =
    /(?:^|\n)\s*import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  const exportFrom =
    /(?:^|\n)\s*export\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  const sideEffect = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;
  const runtimeLoad = /\b(?:require|import)\(\s*["']([^"']+)["']\s*\)/g;
  let match;
  while ((match = importFrom.exec(source))) {
    imports.push({
      bindings: runtimeBindings(match[1]),
      specifier: match[2],
      typeOnly: isTypeOnlyImport(match[1]),
    });
  }
  while ((match = exportFrom.exec(source))) {
    imports.push({
      bindings: runtimeBindings(match[1]),
      specifier: match[2],
      typeOnly: isTypeOnlyImport(match[1]),
    });
  }
  while ((match = sideEffect.exec(source))) {
    imports.push({
      bindings: ["side-effect"],
      specifier: match[1],
      typeOnly: false,
    });
  }
  while ((match = runtimeLoad.exec(source))) {
    imports.push({
      bindings: ["dynamic"],
      specifier: match[1],
      typeOnly: false,
    });
  }
  return imports;
}

function layer(path) {
  const sourcePath = path.replace("packages/nocodb/src/", "");
  const firstSegment = sourcePath.split("/")[0];
  if (path.endsWith(".controller.ts")) return "transport";
  if (["db", "dbQueryClient"].includes(firstSegment)) return "dataEngine";
  if (["models", "meta"].includes(firstSegment)) return "domain";
  if (firstSegment === "services") return "application";
  return "support";
}

function resolvedTarget(sourcePath, specifier) {
  if (specifier.startsWith("~/")) {
    return `packages/nocodb/src/${specifier.slice(2)}`;
  }
  if (specifier.startsWith(".")) {
    const sourceDirectory = dirname(resolve(repositoryRoot, sourcePath));
    return repositoryPath(resolve(sourceDirectory, specifier));
  }
  return null;
}

function isPersistenceSpecifier(specifier) {
  return (
    specifier === "~/Noco" ||
    ["~/models", "~/meta", "~/db", "~/dbQueryClient"].some(
      (prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`)
    ) ||
    ["knex", "sqlite3", "pg", "mysql", "mysql2"].includes(specifier)
  );
}

function edgeKey(edge) {
  return `${edge.path}\0${edge.specifier}\0${edge.bindings.join("\0")}`;
}

function edgeIdentity(edge) {
  return `${edge.path}\0${edge.specifier}`;
}

function sortedUniqueEdges(edges, label, { rejectDuplicates = true } = {}) {
  const normalized = edges.map(({ path, specifier, bindings }) => {
    if (
      !Array.isArray(bindings) ||
      bindings.some((binding) => typeof binding !== "string")
    ) {
      throw new Error(`${label} has an edge without runtime bindings.`);
    }
    return {
      path,
      specifier,
      bindings: [...new Set(bindings)].sort(),
    };
  });
  const identities = normalized.map(edgeIdentity);
  if (rejectDuplicates && new Set(identities).size !== identities.length) {
    throw new Error(`${label} contains duplicate exceptions.`);
  }
  const merged = new Map();
  for (const edge of normalized) {
    const identity = edgeIdentity(edge);
    const existing = merged.get(identity);
    if (existing) {
      existing.bindings = [
        ...new Set([...existing.bindings, ...edge.bindings]),
      ].sort();
    } else {
      merged.set(identity, edge);
    }
  }
  return [...merged.values()].sort((left, right) =>
    edgeKey(left).localeCompare(edgeKey(right))
  );
}

function validateManifest(manifest, label) {
  if (
    manifest.schemaVersion !== 1 ||
    typeof manifest.establishedAt !== "string"
  ) {
    throw new Error(
      `${label} has an unsupported schema or establishment commit.`
    );
  }
  if (!manifest.exceptions || typeof manifest.exceptions !== "object") {
    throw new Error(`${label} has no exceptions object.`);
  }
  const extraRules = Object.keys(manifest.exceptions).filter(
    (name) => !ruleNames.includes(name)
  );
  if (extraRules.length) {
    throw new Error(`${label} has unknown rules: ${extraRules.join(", ")}.`);
  }
  for (const name of ruleNames) {
    if (!Array.isArray(manifest.exceptions[name])) {
      throw new Error(`${label} is missing the ${name} exception list.`);
    }
    manifest.exceptions[name] = sortedUniqueEdges(
      manifest.exceptions[name],
      `${label} ${name}`
    );
  }
  return manifest;
}

async function discoverViolations() {
  const violations = Object.fromEntries(ruleNames.map((name) => [name, []]));
  for (const absolutePath of await sourceFiles(sourceRoot)) {
    const path = repositoryPath(absolutePath);
    const sourceLayer = layer(path);
    const source = await readFile(absolutePath, "utf8");
    for (const dependency of importsIn(source)) {
      if (dependency.typeOnly) continue;
      const edge = {
        path,
        specifier: dependency.specifier,
        bindings: dependency.bindings,
      };
      const target = resolvedTarget(path, dependency.specifier);

      if (
        sourceLayer === "transport" &&
        isPersistenceSpecifier(dependency.specifier)
      ) {
        violations.transportToPersistence.push(edge);
      }
      if (
        sourceLayer === "dataEngine" &&
        dependency.specifier.startsWith("~/services/")
      ) {
        violations.dataEngineToApplication.push(edge);
      }
      if (
        sourceLayer === "domain" &&
        dependency.specifier.startsWith("~/services/")
      ) {
        violations.domainToApplication.push(edge);
      }
      if (
        ["application", "domain", "dataEngine"].includes(sourceLayer) &&
        target &&
        (target.includes("/controllers/") ||
          /\.controller(?:\.ts)?$/.test(target))
      ) {
        violations.lowerLayerToTransport.push(edge);
      }
    }
  }
  for (const name of ruleNames) {
    violations[name] = sortedUniqueEdges(
      violations[name],
      `discovered ${name}`,
      {
        rejectDuplicates: false,
      }
    );
  }
  return violations;
}

function compareCurrent(manifest, violations) {
  const failures = [];
  for (const name of ruleNames) {
    const expected = new Set(manifest.exceptions[name].map(edgeKey));
    const actual = new Set(violations[name].map(edgeKey));
    for (const edge of violations[name]) {
      if (!expected.has(edgeKey(edge))) {
        failures.push(
          `new ${name} edge: ${edge.path} -> ${
            edge.specifier
          } [${edge.bindings.join(", ")}]`
        );
      }
    }
    for (const edge of manifest.exceptions[name]) {
      if (!actual.has(edgeKey(edge))) {
        failures.push(
          `stale ${name} exception (remove it): ${edge.path} -> ${
            edge.specifier
          } [${edge.bindings.join(", ")}]`
        );
      }
    }
  }
  if (failures.length) throw new Error(failures.join("\n"));
}

function git(...args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function manifestAt(revision) {
  try {
    return validateManifest(
      JSON.parse(git("show", `${revision}:${manifestPath}`)),
      `${manifestPath} at ${revision}`
    );
  } catch (error) {
    if (error?.status === 128) return null;
    throw error;
  }
}

function compareWithBase(manifest, revision) {
  const baseCommit = git("rev-parse", `${revision}^{commit}`);
  const base = manifestAt(baseCommit);
  if (!base) {
    if (manifest.establishedAt !== baseCommit) {
      throw new Error(
        `Initial boundary manifest must be established at base commit ${baseCommit}.`
      );
    }
    return;
  }
  if (manifest.establishedAt !== base.establishedAt) {
    throw new Error("The service-boundary establishment commit is immutable.");
  }
  for (const name of ruleNames) {
    const baseExceptions = new Set(base.exceptions[name].map(edgeKey));
    for (const edge of manifest.exceptions[name]) {
      if (!baseExceptions.has(edgeKey(edge))) {
        throw new Error(
          `Service-boundary exceptions are removal-only; added ${name}: ${
            edge.path
          } -> ${edge.specifier} [${edge.bindings.join(", ")}].`
        );
      }
    }
  }
}

const againstIndex = process.argv.indexOf("--against");
const againstRevision =
  againstIndex === -1 ? null : process.argv[againstIndex + 1];
if (againstIndex !== -1 && !againstRevision) {
  throw new Error("--against requires a Git revision.");
}

try {
  const manifest = validateManifest(
    JSON.parse(await readFile(resolve(repositoryRoot, manifestPath), "utf8")),
    manifestPath
  );
  const violations = await discoverViolations();
  compareCurrent(manifest, violations);
  if (againstRevision) compareWithBase(manifest, againstRevision);
  const counts = ruleNames
    .map((name) => `${name}=${violations[name].length}`)
    .join(", ");
  console.log(`Backend service boundaries enforced (${counts}).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

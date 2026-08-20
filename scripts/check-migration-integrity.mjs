import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fromRoot = (path) => resolve(repositoryRoot, path);
const migrationsRoot = fromRoot("packages/nocodb/src/meta/migrations");
const ledgerPath = fromRoot("docs/MIGRATION_MANIFEST.json");
const failures = [];
const sourceTracks = {
  v0: "packages/nocodb/src/meta/migrations/XcMigrationSourcev0.ts",
  v1: "packages/nocodb/src/meta/migrations/XcMigrationSource.ts",
  v2: "packages/nocodb/src/meta/migrations/XcMigrationSourcev2.ts",
  audit: "packages/nocodb/src/meta/migrations/XcMigrationSourceAudit.ts",
};
const sourcePaths = new Set(Object.values(sourceTracks));

function normalizedSha256(source) {
  return createHash("sha256")
    .update(source.replaceAll("\r\n", "\n"), "utf8")
    .digest("hex");
}

function repositoryPath(path) {
  return relative(repositoryRoot, path).replaceAll("\\", "/");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

function resolveImport(sourcePath, importPath) {
  const withExtension = importPath.endsWith(".ts")
    ? importPath
    : `${importPath}.ts`;
  if (withExtension.startsWith("./")) {
    return resolve(dirname(sourcePath), withExtension);
  }
  if (withExtension.startsWith("~/")) {
    return fromRoot(`packages/nocodb/src/${withExtension.slice(2)}`);
  }
  throw new Error(`unsupported migration import: ${importPath}`);
}

async function readTrack(name, sourceRepositoryPath) {
  const sourcePath = fromRoot(sourceRepositoryPath);
  const source = await readFile(sourcePath, "utf8");
  const imports = new Map();
  const importPattern = /import \* as (\w+) from ["']([^"']+)["'];/g;
  for (const match of source.matchAll(importPattern)) {
    imports.set(match[1], match[2]);
  }

  const migrationList = source.match(
    /return Promise\.resolve\(\s*\[([\s\S]*?)\]\s*\)/
  );
  if (!migrationList) {
    throw new Error(`${sourceRepositoryPath}: migration sequence not found`);
  }

  const migrations = [];
  const seenMigrationNames = new Set();
  for (const match of migrationList[1].matchAll(/["']([^"']+)["']/g)) {
    const migrationName = match[1];
    if (seenMigrationNames.has(migrationName)) {
      failures.push(
        `${name}: duplicate migration registration ${migrationName}`
      );
      continue;
    }
    seenMigrationNames.add(migrationName);
    const importPath = imports.get(migrationName);
    if (!importPath) {
      failures.push(
        `${sourceRepositoryPath}: ${migrationName} is ordered but not imported`
      );
      continue;
    }

    const switchPattern = new RegExp(
      `case ["']${escapeRegExp(migrationName)}["']:\\s*return ${escapeRegExp(
        migrationName
      )};`
    );
    if (!switchPattern.test(source)) {
      failures.push(
        `${sourceRepositoryPath}: ${migrationName} is not returned by its switch case`
      );
    }

    migrations.push({
      name: migrationName,
      path: repositoryPath(resolveImport(sourcePath, importPath)),
    });
  }

  return { source: sourceRepositoryPath, migrations };
}

async function buildCurrentLedger(establishedAtCommit) {
  const files = [];
  for await (const path of walk(migrationsRoot)) {
    const pathFromRoot = repositoryPath(path);
    if (!pathFromRoot.endsWith(".ts") || sourcePaths.has(pathFromRoot)) {
      continue;
    }
    files.push({
      path: pathFromRoot,
      sha256: normalizedSha256(await readFile(path, "utf8")),
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));

  const tracks = {};
  for (const [name, sourcePath] of Object.entries(sourceTracks)) {
    tracks[name] = await readTrack(name, sourcePath);
  }

  return {
    schemaVersion: 1,
    establishedAtCommit,
    hashNormalization: "UTF-8 text with CRLF normalized to LF",
    tracks,
    files,
  };
}

function currentCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
}

function readLedgerAtRevision(revision) {
  try {
    execFileSync("git", ["cat-file", "-e", `${revision}^{commit}`], {
      cwd: repositoryRoot,
      stdio: "ignore",
    });
  } catch {
    throw new Error(
      `Git revision is unavailable for ledger comparison: ${revision}`
    );
  }

  try {
    return JSON.parse(
      execFileSync(
        "git",
        ["show", `${revision}:docs/MIGRATION_MANIFEST.json`],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }
      )
    );
  } catch {
    return null;
  }
}

function compareCurrentLedger(expected, actual) {
  if (expected.schemaVersion !== 1) {
    failures.push("docs/MIGRATION_MANIFEST.json: unsupported schemaVersion");
  }

  const expectedFiles = new Map(
    (expected.files ?? []).map((file) => [file.path, file.sha256])
  );
  const actualFiles = new Map(
    (actual.files ?? []).map((file) => [file.path, file.sha256])
  );
  if (expectedFiles.size !== (expected.files ?? []).length) {
    failures.push("docs/MIGRATION_MANIFEST.json: duplicate file entry");
  }

  const expectedTrackNames = Object.keys(expected.tracks ?? {}).sort();
  const actualTrackNames = Object.keys(actual.tracks).sort();
  if (JSON.stringify(expectedTrackNames) !== JSON.stringify(actualTrackNames)) {
    failures.push(
      "docs/MIGRATION_MANIFEST.json: migration track inventory differs"
    );
  }

  for (const [path, hash] of expectedFiles) {
    if (!actualFiles.has(path)) {
      failures.push(`${path}: inventoried migration file is missing`);
    } else if (actualFiles.get(path) !== hash) {
      failures.push(
        `${path}: migration SHA-256 mismatch (expected ${hash}, got ${actualFiles.get(
          path
        )})`
      );
    }
  }
  for (const path of actualFiles.keys()) {
    if (!expectedFiles.has(path)) {
      failures.push(`${path}: migration file is not inventoried`);
    }
  }

  for (const [name, actualTrack] of Object.entries(actual.tracks)) {
    const expectedTrack = expected.tracks?.[name];
    if (!expectedTrack) {
      failures.push(`${name}: migration track is not inventoried`);
      continue;
    }
    if (expectedTrack.source !== actualTrack.source) {
      failures.push(`${name}: migration source path changed`);
    }
    if (
      JSON.stringify(expectedTrack.migrations) !==
      JSON.stringify(actualTrack.migrations)
    ) {
      failures.push(
        `${name}: migration execution sequence differs from ledger`
      );
    }
  }
}

function compareWithBase(baseLedger, currentLedger, revision) {
  if (!baseLedger) {
    console.log(
      `${revision} has no migration ledger; establishing the initial append-only boundary.`
    );
    return;
  }

  if (baseLedger.schemaVersion !== currentLedger.schemaVersion) {
    failures.push("migration ledger schemaVersion changed");
  }
  if (baseLedger.establishedAtCommit !== currentLedger.establishedAtCommit) {
    failures.push("migration ledger establishment commit changed");
  }
  if (baseLedger.hashNormalization !== currentLedger.hashNormalization) {
    failures.push("migration ledger hash normalization changed");
  }

  const currentFiles = new Map(
    currentLedger.files.map((file) => [file.path, file.sha256])
  );
  for (const baseFile of baseLedger.files ?? []) {
    if (!currentFiles.has(baseFile.path)) {
      failures.push(`${baseFile.path}: protected migration was removed`);
    } else if (currentFiles.get(baseFile.path) !== baseFile.sha256) {
      failures.push(
        `${baseFile.path}: protected migration ledger hash changed`
      );
    }
  }

  for (const [name, baseTrack] of Object.entries(baseLedger.tracks ?? {})) {
    const currentTrack = currentLedger.tracks?.[name];
    if (!currentTrack) {
      failures.push(`${name}: protected migration track was removed`);
      continue;
    }
    if (currentTrack.source !== baseTrack.source) {
      failures.push(`${name}: protected migration source path changed`);
    }
    const prefix = currentTrack.migrations.slice(
      0,
      baseTrack.migrations.length
    );
    if (JSON.stringify(prefix) !== JSON.stringify(baseTrack.migrations)) {
      failures.push(
        `${name}: existing migration order is not an unchanged prefix`
      );
    }
  }
}

const write = process.argv.includes("--write");
const againstIndex = process.argv.indexOf("--against");
const againstRevision =
  againstIndex === -1 ? null : process.argv[againstIndex + 1];

if (againstIndex !== -1 && !againstRevision) {
  throw new Error("--against requires a Git revision");
}

const existingLedger = (await exists(ledgerPath))
  ? JSON.parse(await readFile(ledgerPath, "utf8"))
  : null;
const establishedAtCommit =
  existingLedger?.establishedAtCommit ?? currentCommit();
const actualLedger = await buildCurrentLedger(establishedAtCommit);

if (write && failures.length > 0) {
  console.error("Migration sources are invalid; the ledger was not updated:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else if (write) {
  await writeFile(ledgerPath, `${JSON.stringify(actualLedger, null, 2)}\n`);
  console.log(
    `${repositoryPath(ledgerPath)} updated with ${
      actualLedger.files.length
    } protected migration files.`
  );
} else {
  if (!existingLedger) {
    failures.push("docs/MIGRATION_MANIFEST.json: migration ledger is missing");
  } else {
    compareCurrentLedger(existingLedger, actualLedger);
    if (againstRevision) {
      compareWithBase(
        readLedgerAtRevision(againstRevision),
        existingLedger,
        againstRevision
      );
    }
  }

  if (failures.length > 0) {
    console.error(`${repositoryPath(ledgerPath)} validation failed:`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    const migrationCount = Object.values(actualLedger.tracks).reduce(
      (count, track) => count + track.migrations.length,
      0
    );
    console.log(
      `${actualLedger.files.length} migration files and ${migrationCount} ordered registrations are append-only and hash-verified.`
    );
  }
}

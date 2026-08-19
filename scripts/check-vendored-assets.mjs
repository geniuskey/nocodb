import { createHash } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fromRoot = (path) => resolve(repositoryRoot, path);
const inventoryPath = fromRoot("docs/VENDORED_ASSETS.json");
const failures = [];
const auditedAssetRoots = [
  "packages/nocodb/src/public/js",
  "packages/nocodb/src/public/css",
  "packages/nc-gui/public/js",
];

function normalizedSha256(source) {
  return createHash("sha256")
    .update(source.replaceAll("\r\n", "\n"), "utf8")
    .digest("hex");
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

const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));

if (inventory.schemaVersion !== 1) {
  failures.push("docs/VENDORED_ASSETS.json: unsupported schemaVersion");
}

const seenPaths = new Set();
const noticePaths = new Set();

for (const notice of inventory.notices ?? []) {
  if (noticePaths.has(notice.path)) {
    failures.push(`${notice.path}: duplicate notice inventory entry`);
    continue;
  }
  noticePaths.add(notice.path);

  const absolutePath = fromRoot(notice.path);
  if (!(await exists(absolutePath))) {
    failures.push(`${notice.path}: inventoried notice is missing`);
    continue;
  }

  const source = await readFile(absolutePath, "utf8");
  const actualHash = normalizedSha256(source);
  if (actualHash !== notice.sha256) {
    failures.push(
      `${notice.path}: notice SHA-256 mismatch (expected ${notice.sha256}, got ${actualHash})`
    );
  }
}

for (const asset of inventory.assets ?? []) {
  if (seenPaths.has(asset.path)) {
    failures.push(`${asset.path}: duplicate inventory entry`);
    continue;
  }
  seenPaths.add(asset.path);

  const absolutePath = fromRoot(asset.path);
  if (!(await exists(absolutePath))) {
    failures.push(`${asset.path}: inventoried asset is missing`);
    continue;
  }

  const source = await readFile(absolutePath, "utf8");
  const actualHash = normalizedSha256(source);
  if (actualHash !== asset.sha256) {
    failures.push(
      `${asset.path}: SHA-256 mismatch (expected ${asset.sha256}, got ${actualHash})`
    );
  }

  for (const marker of asset.markers ?? []) {
    if (!source.includes(marker)) {
      failures.push(`${asset.path}: missing provenance marker ${marker}`);
    }
  }

  for (const noticePath of asset.noticeFiles ?? []) {
    if (!noticePaths.has(noticePath)) {
      failures.push(
        `${asset.path}: required notice is not inventoried: ${noticePath}`
      );
    }
  }
}

for (const assetRoot of auditedAssetRoots) {
  const absoluteRoot = fromRoot(assetRoot);
  if (!(await exists(absoluteRoot))) continue;

  for await (const assetPath of walk(absoluteRoot)) {
    if (![".css", ".js"].includes(extname(assetPath))) continue;
    const repositoryPath = relative(repositoryRoot, assetPath).replaceAll(
      "\\",
      "/"
    );
    if (!seenPaths.has(repositoryPath)) {
      failures.push(`${repositoryPath}: runtime asset is not inventoried`);
    }
  }
}

for (const obsoletePath of inventory.forbiddenObsoleteAssets ?? []) {
  if (await exists(fromRoot(obsoletePath))) {
    failures.push(`${obsoletePath}: obsolete unreferenced asset is present`);
  }
}

if (failures.length > 0) {
  console.error(
    `${relative(repositoryRoot, inventoryPath)} validation failed:`
  );
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `${inventory.assets.length} vendored runtime assets and ${inventory.notices.length} notices have pinned provenance and hashes.`
  );
}

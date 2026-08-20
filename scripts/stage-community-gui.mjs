import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const defaultSource = resolve(
  repositoryRoot,
  "packages/nc-gui/.output/public"
);
export const defaultTarget = resolve(
  repositoryRoot,
  "packages/nocodb/docker/nc-gui"
);

function assertPathWithin(root, candidate, label) {
  const pathFromRoot = relative(root, candidate);
  if (
    pathFromRoot === "" ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`)
  ) {
    throw new Error(`${label} must be a child of ${root}`);
  }
}

async function requireGeneratedGui(source) {
  const sourceMetadata = await stat(source).catch((error) => {
    if (error?.code === "ENOENT") {
      throw new Error(
        `Community GUI output is missing at ${source}. Run pnpm --filter nc-gui generate first.`
      );
    }
    throw error;
  });

  if (!sourceMetadata.isDirectory()) {
    throw new Error(`Community GUI output is not a directory: ${source}`);
  }

  const entries = await readdir(source);
  if (!entries.includes("index.html") || !entries.includes("_nuxt")) {
    throw new Error(
      `Community GUI output at ${source} is incomplete (expected index.html and _nuxt).`
    );
  }
}

export async function stageCommunityGui({
  source = defaultSource,
  target = defaultTarget,
  allowedRoot = repositoryRoot,
} = {}) {
  const resolvedSource = resolve(source);
  const resolvedTarget = resolve(target);
  const resolvedRoot = resolve(allowedRoot);

  assertPathWithin(resolvedRoot, resolvedSource, "Source");
  assertPathWithin(resolvedRoot, resolvedTarget, "Target");
  await requireGeneratedGui(resolvedSource);

  await rm(resolvedTarget, { recursive: true, force: true });
  await mkdir(dirname(resolvedTarget), { recursive: true });
  await cp(resolvedSource, resolvedTarget, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });

  await requireGeneratedGui(resolvedTarget);
  return resolvedTarget;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const target = await stageCommunityGui();
  console.log(
    `Staged the generated Community GUI at ${relative(
      repositoryRoot,
      target
    ).replaceAll("\\", "/")}.`
  );
}

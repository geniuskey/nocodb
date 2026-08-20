import { execFileSync } from "node:child_process";
import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fromRoot = (path) => resolve(repositoryRoot, path);

const configurationChecks = [
  {
    path: "packages/nc-gui/nuxt.config.ts",
    required: ["'ee/**'", "'extensions/*-ee/**'"],
  },
  {
    path: "packages/nc-gui/windi.config.ts",
    required: ["'ee/**'", "'extensions/*-ee/**'", "'../extensions/*-ee/**'"],
  },
  {
    path: "packages/nc-gui/composables/usePlugin/index.ts",
    required: [
      "'!../../extensions/*-ee/assets/*'",
      "'!../../extensions/*-ee/*.json'",
      "'!../../extensions/*-ee/*.md'",
    ],
  },
  {
    path: "packages/nc-gui/components/extensions/Extension.vue",
    required: ["'!../../extensions/*-ee/index.vue'"],
    forbidden: ["import(`../../extensions/${"],
  },
  {
    path: "packages/nocodb/docker/rspack.config.js",
    forbidden: ["EE:"],
  },
  {
    path: "packages/nocodb/rspack.dev.config.js",
    forbidden: ["EE:"],
  },
  {
    path: "packages/nocodb/jest.config.js",
    forbidden: ["<rootDir>/ee/", "tsconfig.ee"],
  },
  {
    path: "packages/nocodb/tests/unit/tsconfig.json",
    forbidden: [
      '"../../src/ee"',
      '"../../src/ee-on-prem"',
      '"../../src/ee-cloud"',
      '"./rest/tests/ee"',
    ],
  },
  {
    path: "packages/nocodb/package.json",
    required: [
      '"knex-databricks": "workspace:*"',
      '"knex-snowflake": "workspace:*"',
    ],
    forbidden: ['"nc-lib-gui"'],
  },
  {
    path: "packages/nocodb/Dockerfile",
    required: [
      "node:22.12.0-alpine@sha256:51eff88af6dff26f59316b6e356188ffa2c422bd3c3b76f2556a2e7e89d080bd",
      "LITESTREAM_VERSION=v0.3.13",
      "LITESTREAM_COMMIT=977d4a5ee45ae546537324a3cfbf926de3bebc97",
      "eb75a3de5cab03875cdae9f5f539e6aedadd66607003d9b1e7a9077948818ba0",
      "9585f5a508516bd66af2b2376bab4de256a5ef8e2b73ec760559e679628f2d59",
      "58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd",
      "npm pkg delete scripts.preinstall scripts.prepare",
      "pnpm --filter nocodb deploy --prod --frozen-lockfile",
      "node_modules/nocodb-sdk/build/main/index.js",
      "node_modules/knex-snowflake/src/index.js",
      "node_modules/knex-databricks/src/index.js",
      "/usr/share/licenses/litestream/LICENSE",
    ],
    forbidden: [
      "git clone https://github.com/benbjohnson/litestream",
      "pnpm dlx modclean",
      "pnpm uninstall nocodb-sdk",
      "pnpm install --prod",
    ],
  },
  {
    path: ".dockerignore",
    required: [
      "!pnpm-lock.yaml",
      "!packages/nocodb-sdk/build/**",
      "!packages/nocodb/docker/nc-gui/**",
    ],
  },
  {
    path: "build-local-docker-image.sh",
    required: [
      "pnpm install --frozen-lockfile",
      "pnpm run build:community",
      "packages/nocodb/Dockerfile",
    ],
    forbidden: ["rsync", "packages/nc-lib-gui"],
  },
  {
    path: "packages/nocodb/src/middlewares/gui/gui.middleware.ts",
    required: ["path.join(__dirname, 'nc-gui')"],
    forbidden: ["nc-lib-gui"],
  },
  {
    path: "packages/noco-integrations/package.json",
    required: [
      '"license": "AGPL-3.0-or-later"',
      '"build": "pnpm --filter @noco-integrations/core build"',
      '"lint": "eslint \\"core/src/**/*.{ts,tsx}\\""',
    ],
    forbidden: ["packages/**", "build-optimized"],
  },
  {
    path: "packages/noco-integrations/core/package.json",
    required: ['"license": "AGPL-3.0-or-later"'],
  },
  {
    path: "packages/noco-integrations/pnpm-workspace.yaml",
    required: ["- 'core'"],
    forbidden: ["packages/*", "templates/*", "wip/*"],
  },
];

const defaultScriptChecks = [
  {
    path: "package.json",
    scripts: [
      "bootstrap",
      "bootstrap:ce",
      "build:community",
      "docker:build:community",
      "integrations:build:core",
    ],
  },
  {
    path: "packages/nocodb/package.json",
    scripts: [
      "docker:build",
      "stage:gui",
      "watch:run",
      "watch:run:mysql",
      "watch:run:pg",
      "watch:run:playwright",
      "watch:run:playwright:mysql",
      "watch:run:playwright:pg",
      "watch:run:playwright:quick",
      "watch:run:playwright:pg:cyquick",
      "test",
      "test:unit",
      "test:community:smoke",
      "typecheck:community",
    ],
  },
  {
    path: "packages/nocodb-sdk/package.json",
    scripts: ["build"],
  },
  {
    path: "packages/nc-gui/package.json",
    scripts: ["build", "dev", "ci:start", "test:run"],
  },
  {
    path: "tests/playwright/package.json",
    scripts: [
      "test",
      "ci:test",
      "ci:test:community",
      "ci:test:mysql",
      "ci:test:pg",
    ],
  },
  {
    path: "packages/noco-integrations/package.json",
    scripts: ["build", "test", "lint"],
  },
];
const scriptManifests = [
  "package.json",
  "packages/nocodb/package.json",
  "packages/nocodb-sdk/package.json",
  "packages/nc-gui/package.json",
  "tests/playwright/package.json",
  "packages/noco-integrations/package.json",
];

const sourceRoots = [
  "packages/nocodb/src",
  "packages/nocodb/tests",
  "packages/nocodb-sdk/src",
  "packages/nc-gui",
  "packages/noco-integrations/core/src",
  "tests/playwright/community",
  "tests/playwright/tests",
];
const excludedDirectories = new Set(
  [
    "packages/nocodb/src/ee",
    "packages/nocodb/src/ee-on-prem",
    "packages/nocodb/src/ee-cloud",
    "packages/nocodb-sdk/src/ee",
    "packages/nc-gui/ee",
    "packages/nocodb/tests/unit/rest/tests/ee",
    "tests/playwright/tests/ee",
  ].map(fromRoot)
);
const forbiddenPaths = [
  ...excludedDirectories,
  ...[
    "packages/nc-gui/extensions/bulk-update-ee",
    "packages/nc-gui/extensions/csv-import-ee",
    "packages/nc-gui/extensions/org-chart-ee",
    "packages/nc-gui/extensions/page-designer-ee",
    "packages/nc-gui/extensions/url-preview-ee",
    "packages/nc-gui/extensions/world-clock-ee",
    "scripts/ee",
    "scripts/sync",
    "build-local-ee-docker-image.sh",
    "packages/nocodb/rspack.config.js",
    "packages/nocodb/rspack.dev.ee-cloud.js",
    "packages/nocodb/rspack.dev.ee-on-prem.js",
    "packages/nocodb/rspack.dev.ee.js",
    "packages/nocodb/rspack.ee-cloud.config.js",
    "packages/nocodb/rspack.ee-on-prem.config.js",
    "packages/nocodb/tsconfig.ee-cloud.json",
    "packages/nocodb/tsconfig.ee-on-prem.json",
    "packages/nocodb/tsconfig.ee.json",
    "packages/nocodb/tests/unit/tsconfig.ee.json",
    "packages/nocodb-sdk/build-script/mergeAndGenerateSwagger.js",
    "packages/nocodb/Dockerfile.local",
    "packages/nocodb/Dockerfile.timely",
    "packages/noco-integrations/packages",
    "packages/noco-integrations/templates",
    "packages/noco-integrations/wip",
    "packages/noco-integrations/.cursor",
    "packages/noco-integrations/scripts",
    "packages/noco-integrations/nocodb-sdk-reference.ts",
    "packages/nc-secret-mgr",
    "packages/nocodb/build-utils/syncDependencies.js",
    "packages/nocodb/rspack.cli.config.js",
    "cloud",
    "charts",
    "scripts/release",
    "scripts/pkg-executable",
    "scripts/self-hosted-gh-runner",
    "scripts/downgradeSqlite.js",
    "scripts/updateCliVersion.js",
    "scripts/bumpNcGuiVersion.js",
    "scripts/upgradeNcGui.js",
    ".github/workflows/openreplay-cdn-build.yml",
    ".github/workflows/release-cloud-build.yml",
    ".github/workflows/release-cloud-pr-build.yml",
    ".github/workflows/release-cloud-production-executor.yml",
    ".github/workflows/release-cloud-production.yml",
    ".github/workflows/release-ee-on-prem-docker.yml",
    ".github/workflows/sync-ce-to-ee.yml",
    ".github/workflows/sync-ee-to-ce.yml",
  ].map(fromRoot),
];
const allowedWorkflowNames = new Set([
  "community-backend.yml",
  "community-boundary.yml",
]);
const ignoredDirectoryNames = new Set([
  ".git",
  ".nuxt",
  ".output",
  "build",
  "dist",
  "node_modules",
]);
const sourceExtensions = new Set([
  ".cjs",
  ".js",
  ".mjs",
  ".ts",
  ".tsx",
  ".vue",
]);
const excludedModuleSegments = new Set(["ee", "ee-cloud", "ee-on-prem"]);
const forbiddenModuleSpecifiers = new Set(["nc-lib-gui"]);
const moduleSpecifierPattern =
  /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["'`]([^"'`\r\n]+)["'`]/g;
const forbiddenScriptPattern =
  /(?:\bEE=|(?:^|\s)(?:build|generate):ee\b|rspack\S*\.ee(?:\.|\s)|rspack\.cli|src\/ee(?:\/|\b))/;
const failures = [];
const trackedPaths = execFileSync("git", ["ls-files", "-z"], {
  cwd: repositoryRoot,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

async function hasRelevantContents(path) {
  const metadata = await lstat(path);
  if (!metadata.isDirectory()) return true;

  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) {
      continue;
    }

    if (await hasRelevantContents(resolve(path, entry.name))) {
      return true;
    }
  }

  return false;
}

for (const forbiddenPath of forbiddenPaths) {
  const relativePath = relative(repositoryRoot, forbiddenPath).replaceAll(
    "\\",
    "/"
  );
  if (
    trackedPaths.some(
      (trackedPath) =>
        trackedPath === relativePath ||
        trackedPath.startsWith(`${relativePath}/`)
    )
  ) {
    failures.push(`${relativePath}: excluded path is tracked`);
    continue;
  }

  try {
    if (await hasRelevantContents(forbiddenPath)) {
      failures.push(
        `${relative(repositoryRoot, forbiddenPath)}: excluded path is present`
      );
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

for (const entry of await readdir(fromRoot(".github/workflows"), {
  withFileTypes: true,
})) {
  if (entry.isFile() && !allowedWorkflowNames.has(entry.name)) {
    failures.push(
      `.github/workflows/${entry.name}: workflow is not in the Community allowlist`
    );
  }
}

for (const check of configurationChecks) {
  const source = await readFile(fromRoot(check.path), "utf8");

  for (const marker of check.required ?? []) {
    if (!source.includes(marker)) {
      failures.push(`${check.path}: missing Community exclusion ${marker}`);
    }
  }

  for (const marker of check.forbidden ?? []) {
    if (source.includes(marker)) {
      failures.push(
        `${check.path}: forbidden Community configuration ${marker}`
      );
    }
  }
}

for (const check of defaultScriptChecks) {
  const manifest = JSON.parse(await readFile(fromRoot(check.path), "utf8"));

  for (const scriptName of check.scripts) {
    const command = manifest.scripts?.[scriptName];
    if (!command) {
      failures.push(`${check.path}: missing default script ${scriptName}`);
    } else if (forbiddenScriptPattern.test(command)) {
      failures.push(
        `${check.path}: ${scriptName} crosses the Community source boundary`
      );
    }
  }
}

for (const manifestPath of scriptManifests) {
  const manifest = JSON.parse(await readFile(fromRoot(manifestPath), "utf8"));

  for (const [scriptName, command] of Object.entries(manifest.scripts ?? {})) {
    if (forbiddenScriptPattern.test(command)) {
      failures.push(
        `${manifestPath}: ${scriptName} crosses the Community source boundary`
      );
    }
  }
}

async function* walkCommunitySource(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      const isExcludedExtension =
        basename(directory) === "extensions" && entry.name.endsWith("-ee");

      if (ignoredDirectoryNames.has(entry.name)) {
        continue;
      }

      if (excludedDirectories.has(entryPath) || isExcludedExtension) {
        failures.push(
          `${relative(repositoryRoot, entryPath)}: excluded path is present`
        );
        continue;
      }

      yield* walkCommunitySource(entryPath);
    } else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) {
      yield entryPath;
    }
  }
}

for (const sourceRoot of sourceRoots) {
  for await (const sourcePath of walkCommunitySource(fromRoot(sourceRoot))) {
    const source = await readFile(sourcePath, "utf8");
    moduleSpecifierPattern.lastIndex = 0;

    for (const match of source.matchAll(moduleSpecifierPattern)) {
      const segments = match[1].replaceAll("\\", "/").split("/");
      if (
        forbiddenModuleSpecifiers.has(match[1]) ||
        segments.some((segment) => excludedModuleSegments.has(segment))
      ) {
        const lineNumber =
          1 + (source.slice(0, match.index).match(/\n/g)?.length ?? 0);
        failures.push(
          `${relative(
            repositoryRoot,
            sourcePath
          )}:${lineNumber}: imports excluded module ${match[1]}`
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Community source-boundary check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Community source and default-script boundaries are enforced.");
}

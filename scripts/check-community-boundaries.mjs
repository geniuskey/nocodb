import { readdir, readFile } from "node:fs/promises";
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
    required: [
      '"../../src/ee"',
      '"../../src/ee-on-prem"',
      '"../../src/ee-cloud"',
      '"./rest/tests/ee"',
    ],
  },
];

const defaultScriptChecks = [
  {
    path: "package.json",
    scripts: ["bootstrap", "bootstrap:ce", "integrations:build:core"],
  },
  {
    path: "packages/nocodb/package.json",
    scripts: [
      "docker:build",
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
    scripts: ["build", "dev"],
  },
];

const sourceRoots = [
  "packages/nocodb/src",
  "packages/nocodb/tests",
  "packages/nocodb-sdk/src",
  "packages/nc-gui",
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
const moduleSpecifierPattern =
  /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["'`]([^"'`\r\n]+)["'`]/g;
const forbiddenScriptPattern =
  /(?:\bEE=|(?:^|\s)(?:build|generate):ee\b|rspack\S*\.ee(?:\.|\s)|src\/ee(?:\/|\b))/;
const failures = [];

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

async function* walkCommunitySource(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      const isExcludedExtension =
        basename(directory) === "extensions" && entry.name.endsWith("-ee");

      if (
        ignoredDirectoryNames.has(entry.name) ||
        excludedDirectories.has(entryPath) ||
        isExcludedExtension
      ) {
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
      if (segments.some((segment) => excludedModuleSegments.has(segment))) {
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

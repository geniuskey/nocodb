import { readFile } from "node:fs/promises";

const checks = [
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
];

const failures = [];

for (const check of checks) {
  const source = await readFile(check.path, "utf8");

  for (const marker of check.required) {
    if (!source.includes(marker)) {
      failures.push(`${check.path}: missing Community exclusion ${marker}`);
    }
  }

  for (const marker of check.forbidden ?? []) {
    if (source.includes(marker)) {
      failures.push(`${check.path}: forbidden broad import ${marker}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Community source-boundary check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Community GUI source boundaries are enforced.");
}

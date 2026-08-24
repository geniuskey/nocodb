import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const guiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sdkEntry = resolve(guiRoot, '../nocodb-sdk/build/main/index.js');

if (!existsSync(sdkEntry)) {
  console.log('Skipping Nuxt preparation until the local SDK has been built.');
  process.exit(0);
}

const nuxtCli = resolve(guiRoot, 'node_modules/nuxt/bin/nuxt.mjs');
const result = spawnSync(process.execPath, [nuxtCli, 'prepare'], {
  cwd: guiRoot,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);

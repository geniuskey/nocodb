import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(repositoryRoot, 'packages/nc-gui/.output/public');
const destination = resolve(repositoryRoot, 'packages/nc-lib-gui/lib/dist');
const expectedDestinationRoot = resolve(repositoryRoot, 'packages/nc-lib-gui/lib');

if (!existsSync(resolve(source, 'index.html'))) {
  throw new Error(
    `Community GUI output is missing at ${source}. Run the nc-gui generate task first.`,
  );
}

if (dirname(destination) !== expectedDestinationRoot) {
  throw new Error(`Refusing to replace unexpected path: ${destination}`);
}

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });

console.log(`Staged Community GUI from ${source} to ${destination}`);

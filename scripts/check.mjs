import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const extensions = new Set(['.js', '.mjs']);
const sourceDirectories = ['src', 'public'];

// Find JavaScript files recursively without following symbolic links.
function* findSourceFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      yield* findSourceFiles(path);
    } else if (entry.isFile() && extensions.has(extname(path))) {
      yield path;
    }
  }
}

let checked = 0;

for (const directory of sourceDirectories) {
  for (const path of findSourceFiles(join(root, directory))) {
    // Parse each file without executing its code; stop on the first failure.
    const args = ['--check', relative(root, path)];
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      stdio: 'inherit',
    });

    if (result.error) console.error(result.error.message);
    if (result.status !== 0) process.exit(result.status ?? 1);
    checked += 1;
  }
}

console.log(`Checked ${checked} source files.`);

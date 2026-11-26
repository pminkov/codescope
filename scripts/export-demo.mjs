import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile }
  from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { indexProject, projectView, readSource } from '../src/analysis.mjs';
import { assets } from '../src/browser-assets.mjs';
import { schemas } from '../src/schemas.mjs';

const publicDirectory = new URL('../public/', import.meta.url);
const dataDirectory = process.env.CODESCOPE_DATA_DIR ||
  resolve(import.meta.dirname, '../.codescope');
const collections = {
  architectures: 'architecture', flows: 'flow', areaAnalyses: 'areas', nounAnalyses: 'nouns',
  sequences: 'sequence', endpointAnalyses: 'endpoints', presentations: 'presentation',
};
const demoMarker = '<html lang="en" data-theme="dark" data-demo>';
const usage = 'npm run export-demo -- --project <id> --out <directory> [--source <path> ...]';

// Load one saved project without starting workers or running registry recovery.
async function loadExportProject(id, output) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid saved project ID.');
  const registry = JSON.parse(await readFile(join(dataDirectory, 'projects.json'), 'utf8'));
  // Resolve the exact registered project before reading any analysis or source.
  const project = registry.find((entry) => entry.id === id);
  if (!project) throw new Error(`No saved project with ID "${id}".`);
  const understanding = JSON.parse(await readFile(
    join(dataDirectory, 'projects', id, 'understanding.json'), 'utf8',
  ));
  // Re-exporting beneath the analyzed root must not index an earlier copy of the demo.
  const index = await indexProject(project.root, project.name, undefined, {
    excludeDirectory: output,
  });
  return projectView(project, index, understanding, null);
}

// Select display fields explicitly so saved prompts and local job metadata stay private.
function selectDemoProject(view) {
  const { id, name, description, scope, stack, tree, codeScan, hasDirectoryAnalysis,
    directoryReview, descriptionSources } = view;
  const project = { id, name, description, scope, stack, tree, codeScan, hasDirectoryAnalysis,
    directoryReview, descriptionSources };

  for (const [collection, schema] of Object.entries(collections)) {
    const { nextPrompts, ...displayFields } = schemas[schema].properties;
    // Normalized results can also have evidence attached to the analysis itself.
    project[collection] = view[collection].map((analysis) => {
      const result = { id: analysis.id, review: analysis.review, sources: analysis.sources };
      for (const key of Object.keys(displayFields)) result[key] = analysis[key];
      return result;
    });
  }
  return project;
}

// Merge overlapping citations and preserve their original, one-based line numbers.
function extractCitedLines(content, ranges) {
  const lines = content.split('\n');
  const excerpts = [];
  // Process citations in file order so repeated evidence is stored only once.
  for (const [start, end] of ranges.sort((left, right) => left[0] - right[0])) {
    if (start < 1 || end < start || end > lines.length) continue;
    const previous = excerpts.at(-1);
    const nextLine = previous && previous.start + previous.lines.length;
    if (previous && start <= nextLine) {
      if (end >= nextLine) previous.lines = previous.lines.concat(lines.slice(nextLine - 1, end));
    } else excerpts.push({ start, lines: lines.slice(start - 1, end) });
  }
  return excerpts;
}

// Collect only resolved citations in files explicitly selected for this export.
async function serializeSnapshot(view, paths) {
  const ranges = new Map();
  for (const path of paths) ranges.set(path, []);
  const project = selectDemoProject(view);

  // Strip redundant scan data and machine-specific paths while visiting displayed citations.
  const displayJson = JSON.stringify(project, function serializeDisplayField(key, value) {
    if (key === 'codeScan' && this.type === 'file') return undefined;
    if (key === 'hash' && Object.hasOwn(this, 'line')) return undefined;
    if (value && Object.hasOwn(value, 'stale') && Number.isSafeInteger(value.line))
      ranges.get(value.path)?.push([value.line, value.endLine ?? value.line]);
    if (typeof value === 'string')
      return value.replaceAll(view.root, '.').replaceAll(homedir() + '/', '~/');
    return value;
  });

  const excerpts = Object.create(null);
  for (const [path, citations] of ranges) {
    if (!citations.length) throw new Error(`No resolved citations for --source "${path}".`);
    const { content } = await readSource(view.root, path, view.tree);
    excerpts[path] = extractCitedLines(content, citations);
  }
  return `{"project":${displayJson},"excerpts":${JSON.stringify(excerpts)}}\n`;
}

// Build a complete static site in staging before touching the destination.
async function writeDemoFiles(directory, snapshot) {
  for (const [file] of Object.values(assets)) {
    if (file === 'index.html') continue;
    const destination = join(directory, file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(new URL(file, publicDirectory), destination);
  }

  const template = await readFile(new URL('index.html', publicDirectory), 'utf8');
  const html = template.replace('<html lang="en" data-theme="dark">', demoMarker)
    .replace('Loading local projects…', 'Loading demo…')
    .replace(/href="\/([\w-]+\.css)"/g, 'href="./$1"')
    .replaceAll('src="/app.js"', 'src="./app.js"')
    .replace(/href="\/([a-z-]+)"/g, 'href="#/$1"');
  await writeFile(join(directory, 'index.html'), html);
  await writeFile(join(directory, 'project.json'), snapshot);
}

// Accept an empty destination or a previous export containing only known generated files.
async function checkDestination(output) {
  const info = await lstat(output).catch(
    // A new directory can be installed with a single rename.
    (error) => { if (error.code !== 'ENOENT') throw error; },
  );
  if (!info) return false;
  if (!info.isDirectory()) throw new Error('Choose a dedicated demo output directory.');
  if (!(await readdir(output)).length) return true;
  const index = await readFile(join(output, 'index.html'), 'utf8').catch(
    // Treat directories without an entry page as unrelated output.
    (error) => { if (error.code !== 'ENOENT') throw error; },
  );
  if (!index?.includes(demoMarker)) throw new Error('Output already contains unrelated files.');
  const entries = await readdir(output, { recursive: true, withFileTypes: true });
  const files = new Set(['project.json']);
  for (const [file] of Object.values(assets)) files.add(file);
  const dirs = new Set();
  for (const file of files) dirs.add(dirname(file));

  for (const entry of entries) {
    const path = join(entry.parentPath, entry.name).slice(output.length + 1);
    if (entry.isDirectory() && dirs.has(path) || entry.isFile() && files.has(path)) continue;
    throw new Error(`Output contains unrelated files: ${path}. Choose a dedicated directory.`);
  }
  return true;
}

// Swap a fully written export into place, restoring the previous copy on failure.
async function exportDemo(id, destination, paths) {
  const requested = resolve(destination);
  await mkdir(dirname(requested), { recursive: true });
  // Match the scanner's canonical root even when the output parent is a symlink.
  const output = join(await realpath(dirname(requested)), basename(requested));
  const snapshot = await serializeSnapshot(await loadExportProject(id, output), paths);
  const staging = await mkdtemp(join(dirname(output), `.${basename(output)}-export-`));
  const site = join(staging, 'site');
  const previous = join(staging, 'previous');
  let restoreNeeded = false;
  try {
    await mkdir(site);
    await writeDemoFiles(site, snapshot);
    if (await checkDestination(output)) {
      await rename(output, previous);
      restoreNeeded = true;
    }
    try {
      await rename(site, output);
      restoreNeeded = false;
    } catch (error) {
      if (restoreNeeded) {
        await rename(previous, output);
        restoreNeeded = false;
      }
      throw error;
    }
  } finally {
    if (!restoreNeeded) await rm(staging, { recursive: true, force: true });
  }
  console.log(`Exported ${id} to ${output}`);
}

try {
  const { values } = parseArgs({ options: {
    project: { type: 'string' }, out: { type: 'string' },
    source: { type: 'string', multiple: true, default: [] }, help: { type: 'boolean' },
  } });
  if (values.help) console.log(usage);
  else if (!values.project || !values.out) throw new Error(`Usage: ${usage}`);
  else await exportDemo(values.project, values.out, values.source);
} catch (error) {
  console.error(`Export failed: ${error.message}`);
  process.exitCode = 1;
}

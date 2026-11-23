import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, extname, sep, basename, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import ignore from 'ignore';
import { stackLabels } from './schemas.mjs';
import { buildCodeScan, isCodeFile, scanCodeFile } from './code-scan.mjs';

const omitted = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'vendor',
  '__pycache__',
  'target',
]);
const textExtensions = new Set(
  '.ts .mts .cts .tsx .js .jsx .mjs .cjs .json .md .mdx .html .css .scss .sql .dot .txt .py .rb .go .rs .java .kt .kts .swift .m .mm .h .hpp .hh .hxx .c .cpp .cc .cxx .cs .fs .vue .svelte .php .ex .exs .erl .sh .bash .zsh .yaml .yml .toml .xml .graphql .gql .proto .tf .dockerfile .r .R .lua .dart .clj .cljs .scala .pl .ps1 .ipynb'.split(
    ' ',
  ),
);
const namedTextFiles = new Set([
  'Dockerfile',
  'Makefile',
  'Gemfile',
  'Rakefile',
  'Procfile',
  'Justfile',
  'LICENSE',
]);
export const exclusions =
  'Respects .gitignore and .codescopeignore. Hidden files, secrets, dependencies, build outputs, and symlinks are excluded. Text previews are limited to 1 MB.';

// Create an error with the HTTP status expected by API handlers.
export const fail = (message, status = 400) => Object.assign(new Error(message), { status });

// Hash source content to detect changes since analysis.
export function fingerprint(content) {
  return createHash('sha256').update(content).digest('hex');
}

// Check whether a resolved path remains within the project root.
export function isInside(root, path) {
  const local = relative(root, path);
  return local !== '..' && !local.startsWith(`..${sep}`) && !local.startsWith(sep);
}

// Canonicalize an accessible absolute project directory.
export async function validateRoot(value) {
  if (typeof value !== 'string' || !value.trim() || !isAbsolute(value.trim()))
    throw fail('Enter an absolute directory path.');

  try {
    const root = await realpath(value.trim());
    if (!(await stat(root)).isDirectory()) throw fail('The path must point to a directory.');
    await readdir(root);

    return root;
  } catch (error) {
    if (error.status) throw error;
    throw fail('The directory does not exist or cannot be read.');
  }
}

// Recognize filenames that should be excluded from indexing.
export function sensitiveFile(name) {
  return (
    /(?:^|[._-])(secrets?|credentials?|private[-_]?key)(?:[._-]|$)/i.test(name) ||
    /\.(pem|key|p12|pfx|keystore)$/i.test(name) ||
    /^id_(rsa|ed25519|ecdsa)/.test(name)
  );
}

// Each ignore file applies to paths below its own directory, including negations.
// Build a bounded directory tree using nested ignore rules.
export async function scanDirectory(root, options = {}) {
  const canonicalRoot = await realpath(root);
  const warnings = [];
  let fileCount = 0;
  let directoryCount = 0;

  // Scan a directory with its inherited ignore matchers.
  const scanChildren = async (path, inherited, depth) => {
    options.signal?.throwIfAborted();
    if (++directoryCount > 5000 || depth > 50)
      throw fail(
        'Directory limit reached (5,000 directories or 50 levels). Choose a smaller project root.',
      );
    const absolute = resolve(canonicalRoot, path);
    if (!isInside(canonicalRoot, await realpath(absolute)))
      throw fail('A directory moved outside the project during scanning. Reopen the project.');
    const rules = [...inherited];
    const matcher = ignore();

    for (const name of ['.gitignore', '.codescopeignore']) {
      try {
        matcher.add(await readFile(resolve(absolute, name), 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT')
          warnings.push(`Could not read ${path ? `${path}/` : ''}${name}.`);
      }
    }

    rules.push({ path, matcher });
    let entries;

    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch {
      warnings.push(`Could not read directory ${path || '.'}.`);
      entries = [];
    }

    const children = [];

    for (const entry of entries.sort(
      // Sort directories before files, then order names alphabetically.
      (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
    )) {
      options.signal?.throwIfAborted();
      if (
        entry.name.startsWith('.') ||
        omitted.has(entry.name) ||
        entry.isSymbolicLink() ||
        sensitiveFile(entry.name)
      )
        continue;
      const childPath = path ? `${path}/${entry.name}` : entry.name;
      let ignored = false;

      for (const rule of rules) {
        const localPath =
          (rule.path ? childPath.slice(rule.path.length + 1) : childPath) +
          (entry.isDirectory() ? '/' : '');
        const result = rule.matcher.test(localPath);
        if (result.ignored) ignored = true;
        if (result.unignored) ignored = false;
      }

      if (ignored) continue;
      if (entry.isDirectory()) children.push(await scanChildren(childPath, rules, depth + 1));
      else if (entry.isFile()) {
        if (++fileCount > 20000)
          throw fail(
            'File limit reached (20,000 files). Choose a smaller root or add .codescopeignore rules.',
          );
        children.push({
          path: childPath,
          name: entry.name,
          type: 'file',
          readable: textExtensions.has(extname(entry.name)) || namedTextFiles.has(entry.name),
          description: 'Not analyzed yet.',
        });
      }
    }

    return {
      path,
      name: path.split('/').at(-1) || basename(canonicalRoot),
      type: 'directory',
      title: path.split('/').at(-1) || options.name || basename(canonicalRoot),
      kind: path ? 'Directory' : 'Project root',
      description: 'Directory indexed; analysis has not been generated yet.',
      children,
      fileCount: children.reduce(
        // Count files recursively without including directory entries.
        (count, child) => count + (child.type === 'file' ? 1 : child.fileCount),
        0,
      ),
    };
  };

  const tree = await scanChildren('', [], 0);
  tree.warnings = warnings;

  return tree;
}

// Return every node in a directory tree in traversal order.
export function flattenTree(node) {
  return [node, ...(node.children || []).flatMap(flattenTree)];
}

// Read an indexed text file after rechecking its canonical path.
export async function readSource(root, path, tree) {
  const node = flattenTree(tree).find(
    // Find the requested readable file in the current scan.
    (entry) => entry.path === path && entry.type === 'file' && entry.readable,
  );
  if (!node || typeof path !== 'string') throw fail('Source file is not available.', 404);
  const canonicalRoot = await realpath(root);
  let canonicalFile;

  try {
    canonicalFile = await realpath(resolve(root, path));
  } catch {
    throw fail('Source file no longer exists. Reopen the project.', 404);
  }

  if (!isInside(canonicalRoot, canonicalFile) || canonicalRoot === canonicalFile)
    throw fail('Source file is not available.', 404);
  const details = await stat(canonicalFile);
  if (details.size > 1024 * 1024)
    throw fail('This file exceeds the 1 MB source preview limit.', 413);
  const content = await readFile(canonicalFile, 'utf8');
  if (content.includes('\0')) throw fail('Binary files cannot be previewed.', 415);

  return { path, content };
}

// Hash a file of any size after rechecking its canonical project boundary.
async function fingerprintFile(root, path, signal) {
  const canonicalFile = await realpath(resolve(root, path));
  if (!isInside(root, canonicalFile) || canonicalFile === root)
    throw fail('Source file is not available.', 404);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(canonicalFile, { signal })) hash.update(chunk);

  return hash.digest('hex');
}

// Build an in-memory tree and hash every eligible file, including binary files.
export async function indexProject(root, name, signal) {
  const tree = await scanDirectory(root, { name, signal });
  const files = {};
  const canonicalRoot = await realpath(root);

  for (const node of flattenTree(tree)) {
    signal?.throwIfAborted();
    if (node.type !== 'file') continue;

    try {
      files[node.path] = await fingerprintFile(canonicalRoot, node.path, signal);
    } catch (error) {
      signal?.throwIfAborted();
      files[node.path] = null;
      node.readable = false;
      node.description = error.message;
      tree.warnings.push(`Could not hash ${node.path}.`);
    }

    if (node.readable) {
      try {
        const { content } = await readSource(root, node.path, tree);
        node.bytes = Buffer.byteLength(content);
        if (isCodeFile(node.path)) node.codeScan = scanCodeFile(node.path, content);
      } catch (error) {
        node.readable = false;
        node.description = error.message;
      }
    }
  }

  return { tree, files, indexedAt: new Date().toISOString(), warnings: tree.warnings || [] };
}

// Resolve a citation against current source and report stale evidence.
export function resolveReference(reference, sources) {
  if (!reference) return null;
  const content = sources[reference.path];
  if (content === undefined) return { ...reference, line: null, stale: true };
  const lines = content.split('\n');

  return {
    ...reference,
    line:
      Number.isInteger(reference.line) && reference.line > 0 &&
      reference.line <= lines.length && (!reference.endLine || reference.endLine <= lines.length)
        ? reference.line
        : null,
    stale: Boolean(reference.hash && reference.hash !== fingerprint(content)),
  };
}

// Compare all historical files with the current scan without changing the baseline.
function compareAnalysisSource(baseline, currentHashes) {
  const available = Boolean(baseline);
  const previousHashes = baseline?.files || {};
  const changedFiles = [];
  const unknownFiles = [];
  const fileChanges = {};

  for (const [path, hash] of Object.entries(previousHashes)) {
    if (!Object.hasOwn(currentHashes, path)) fileChanges[path] = 'removed';
    else if (currentHashes[path] === null) fileChanges[path] = 'unreadable';
    else if (hash === null) unknownFiles.push(path);
    else if (currentHashes[path] !== hash) fileChanges[path] = 'modified';
    if (fileChanges[path]) changedFiles.push(path);
  }
  const newFiles = available ? Object.keys(currentHashes).filter(
    // A file is new only if it was absent from this analysis's own inventory.
    (path) => !Object.hasOwn(previousHashes, path),
  ).sort() : [];
  for (const path of newFiles) fileChanges[path] = 'added';

  return {
    available,
    reviewedAt: baseline?.analyzedAt || null,
    current: available && !changedFiles.length && !newFiles.length && !unknownFiles.length,
    changedFiles: changedFiles.sort(),
    newFiles,
    unknownFiles: unknownFiles.sort(),
    fileChanges,
  };
}

// Combine a fresh project scan with the evidence owned by each saved analysis.
export async function projectView(project, index, understanding, job) {
  const tree = structuredClone(index.tree);
  const sources = {};
  const referencedPaths = new Set();

  // Collect only cited files for source previews, leaving full baselines untouched.
  const collectReferences = (value) => {
    if (!value || typeof value !== 'object') return;
    if ('path' in value && ('line' in value || 'symbol' in value) && !('type' in value))
      referencedPaths.add(value.path);
    else for (const item of Object.values(value)) collectReferences(item);
  };

  // Present a saved result with its own source comparison, excluding storage metadata.
  const presentAnalysis = (analysis) => {
    if (!analysis) return null;
    const { baseline, coverage, ...content } = analysis;
    collectReferences(content);

    return { ...content, review: compareAnalysisSource(baseline, index.files) };
  };

  const directoryData = presentAnalysis(understanding.directoryAnalysis);
  const architectures = (understanding.architectures || []).map(presentAnalysis);
  const flows = (understanding.flows || []).map(presentAnalysis);
  const nounAnalyses = (understanding.nounAnalyses || []).map(presentAnalysis);
  const sequences = (understanding.sequences || []).map(presentAnalysis);
  const endpointAnalyses = (understanding.endpointAnalyses || []).slice(-1).map(presentAnalysis);
  const presentations = (understanding.presentations || []).map(presentAnalysis);
  const directoryDescriptions = new Map((directoryData?.directories || []).map(
    // Index directory explanations by their project-relative path.
    (node) => [node.path, node],
  ));
  const fileDescriptions = new Map((directoryData?.files || []).map(
    // Index file explanations without affecting the live directory inventory.
    (node) => [node.path, node],
  ));

  for (const node of flattenTree(tree)) {
    if (node.type === 'directory' && directoryDescriptions.has(node.path))
      Object.assign(node, directoryDescriptions.get(node.path));
    else if (node.type === 'file' && fileDescriptions.has(node.path))
      Object.assign(node, fileDescriptions.get(node.path));
  }
  for (const path of referencedPaths) {
    try {
      sources[path] = (await readSource(project.root, path, tree)).content;
    } catch {
      /* Missing, excluded, and unreadable citations remain visible as stale. */
    }
  }

  // Resolve source evidence against current content without moving saved baselines.
  const resolveSources = (value) => {
    if (Array.isArray(value)) return value.map(resolveSources);
    if (!value || typeof value !== 'object') return value;
    if ('path' in value && ('line' in value || 'symbol' in value) && !('type' in value))
      return resolveReference(value, sources);

    return Object.fromEntries(Object.entries(value).map(
      // Resolve each nested citation while preserving the shape of the result.
      ([key, item]) => [key, resolveSources(item)],
    ));
  };

  const nodes = flattenTree(tree);
  const reviews = [
    directoryData, ...architectures, ...flows, ...nounAnalyses, ...sequences, ...endpointAnalyses,
    ...presentations,
  ]
    .filter(Boolean).map(
      // Aggregate source status for the project header only.
      (analysis) => analysis.review,
    );
  const availableReviews = reviews.filter(
    // Results without historical hashes must not claim a fresh comparison.
    (review) => review.available,
  );
  const changedFiles = [...new Set(availableReviews.flatMap(
    // Count each modified or missing file once across saved analyses.
    (review) => review.changedFiles,
  ))].sort();
  const newFiles = [...new Set(availableReviews.flatMap(
    // Keep additions separate for the existing changed-files dialog.
    (review) => review.newFiles,
  ))].sort();

  return {
    ...project,
    description: directoryData?.summary ||
      'Explore this directory while CodeScope builds its understanding.',
    descriptionSources: resolveSources(directoryData?.sources || []),
    stack: stackLabels(directoryData?.stack),
    appName: project.name,
    scope: directoryData?.scope || `Analysis of ${project.name}.`,
    tree: resolveSources(tree),
    codeScan: buildCodeScan(tree),
    directoryReview: directoryData?.review || compareAnalysisSource(null, index.files),
    hasDirectoryAnalysis: Boolean(understanding.directoryAnalysis),
    flows: resolveSources(flows),
    architectures: resolveSources(architectures),
    nounAnalyses: resolveSources(nounAnalyses),
    sequences: resolveSources(sequences),
    endpointAnalyses: resolveSources(endpointAnalyses),
    presentations: resolveSources(presentations),
    nextPrompts: understanding.nextPrompts || {},
    job,
    coverage: job?.coverage || understanding.directoryAnalysis?.coverage || null,
    version: understanding.updatedAt || project.createdAt,
    sourceVersion: fingerprint(JSON.stringify([index.files, nodes.map(
      // Include directory-only changes and preview availability in browser updates.
      (node) => [node.path, node.type, node.readable],
    )])),
    stats: {
      files: nodes.filter(
        // Count current file entries, including files added since analysis.
        (node) => node.type === 'file',
      ).length,
      directories: nodes.filter(
        // Count directories below the project root.
        (node) => node.type === 'directory' && node.path,
      ).length,
      flows: flows.length,
      architectures: architectures.length,
      nounAnalyses: nounAnalyses.length,
      sequences: sequences.length,
      endpointAnalyses: endpointAnalyses.length,
      presentations: presentations.length,
    },
    review: {
      available: availableReviews.length > 0,
      current: availableReviews.length > 0 && reviews.every(
        // A project is current only when all saved results have a complete comparison.
        (review) => review.current,
      ),
      changedFiles,
      newFiles,
    },
    indexedAt: index.indexedAt,
    excluded: exclusions,
    warnings: index.warnings || [],
  };
}

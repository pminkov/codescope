import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isCodeFile, scanCodeFile, buildCodeScan } from '../src/code-scan.mjs';
import { indexProject } from '../src/analysis.mjs';
import { renderCodeScan } from '../public/code-scan.js';

// Exercise real syntax trees, ownership, source positions, and comment/string exclusions.
test('Code Scan retains classes, methods, arrow functions, and nested declarations', () => {
  const source = [
    '// function pretend() {}',
    'const text = "class Fake { run() {} }";',
    'export class Store {',
    '  constructor() {}',
    '  async save() {}',
    '  load = () => 1;',
    '}',
    '',
    'export const main = () => {',
    '  function nested() {}',
    '};',
    '',
  ].join('\n');
  const scan = scanCodeFile('app.ts', source);
  assert.equal(scan.status, 'complete');
  assert.equal(scan.lines, 11);
  assert.equal(scan.nonBlankLines, 10);
  assert.deepEqual(scan.symbols.map(
    // Compare the declared names and their exact navigation lines.
    ({ name, line }) => [name, line],
  ), [['Store', 3], ['main', 9]]);
  assert.deepEqual(scan.symbols[0].children.map(
    // Keep methods under their owning class, including arrow fields.
    ({ name }) => name,
  ), ['constructor', 'save', 'load']);
  assert.equal(scan.symbols[1].children[0].name, 'nested');
  assert.equal(scanCodeFile('empty.js', '').lines, 0);
  assert.equal(scanCodeFile('windows.js', 'const a = 1;\r\n\r\n').lines, 2);
  const assignedClass = scanCodeFile('store.js', 'const Store = class { save() {} };');
  assert.equal(assignedClass.symbols[0].name, 'Store');
  assert.equal(assignedClass.symbols[0].children[0].name, 'save');
  assert.equal(scanCodeFile('default.js', 'export default function() {}').symbols[0].name, 'default');
  assert.equal(scanCodeFile('default.ts', 'export default class { save() {} }').symbols[0].name, 'default');
});

// Check language-specific class containers and nonlexical method ownership.
test('Code Scan extracts declarations across supported source languages', () => {
  const examples = [
    ['main.py', 'class Store:\n def save(self):\n  pass\ndef main(): pass', 'Store', 'save'],
    ['main.swift', 'struct Store { init() {}\n func save() {}\n}\nfunc main() {}', 'Store', 'save'],
    ['main.go', 'package main\ntype Store struct {}\nfunc (s *Store) save() {}\nfunc main() {}', 'Store', 'save'],
    ['main.rs', 'struct Store {}\nimpl Store { fn save(&self) {} }\nfn main() {}', 'Store', 'save'],
    ['Main.java', 'class Store { Store() {} void save() {} }', 'Store', 'save'],
    ['main.cpp', 'class Store { public: Store() {} void save() {} };', 'Store', 'save'],
    ['Main.cs', 'class Store { Store() {} void Save() {} }', 'Store', 'Save'],
    ['main.rb', 'class Store\n def save\n end\nend', 'Store', 'save'],
    ['main.kt', 'class Store { fun save() {} }', 'Store', 'save'],
    ['main.php', '<?php class Store { function save() {} }', 'Store', 'save'],
  ];
  for (const [path, source, owner, method] of examples) {
    const scan = scanCodeFile(path, source);
    assert.equal(scan.status, 'complete', path);
    const type = scan.symbols.find(
      // Locate the type regardless of other top-level declarations.
      (symbol) => symbol.name === owner,
    );
    assert.ok(type, path);
    assert.ok(type.children.some(
      // Verify the method is nested rather than duplicated at file level.
      (symbol) => symbol.name === method,
    ), path);
  }
  assert.equal(scanCodeFile('main.c', 'int main(void) { return 0; }').symbols[0].name, 'main');
  assert.equal(scanCodeFile('main.sh', 'main() { echo hi; }').symbols[0].name, 'main');
});

// Preserve component source positions while leaving HTML templates out of extraction.
test('Code Scan handles component scripts, unsupported languages, and syntax errors honestly', () => {
  const scan = scanCodeFile('View.vue', '<template><p>Hello</p></template>\n<script lang="ts">\nfunction greet() {}\n</script>');
  assert.equal(scan.symbols[0].name, 'greet');
  assert.equal(scan.symbols[0].line, 3);
  assert.equal(scanCodeFile('main.js', 'function broken( {').status, 'partial');
  assert.equal(scanCodeFile('main.lua', 'function main() end').status, 'unsupported');
  for (const path of ['index.html', 'view.htm', 'README.md', 'package.json', 'styles.css', 'config.yaml']) {
    assert.equal(isCodeFile(path), false, path);
  }
});

// Check the live scanner's ignore rules, filtered directories, and fresh line inventories.
test('Code Scan lists only direct source directories and updates without model analysis', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codescope-scan-'));
  // Remove source fixtures after the integration test finishes.
  context.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ['src/nested', 'docs', 'ignored', 'node_modules/demo']) {
    await mkdir(join(root, directory), { recursive: true });
  }
  await writeFile(join(root, '.gitignore'), 'ignored/\n');
  await writeFile(join(root, 'src/nested/main.ts'), 'export function main() {}\n');
  await writeFile(join(root, 'docs/index.html'), '<h1>Docs</h1>');
  await writeFile(join(root, 'ignored/secret.js'), 'function ignored() {}');
  await writeFile(join(root, 'node_modules/demo/index.js'), 'function dependency() {}');
  let scan = buildCodeScan((await indexProject(root, 'Demo')).tree);
  assert.deepEqual(scan.directories.map(
    // Ancestor-only and HTML-only directories must not enter source navigation.
    ({ path }) => path,
  ), ['src/nested']);
  assert.equal(scan.directories[0].files[0].symbols[0].name, 'main');
  await writeFile(join(root, 'src/nested/main.ts'), 'export class Store {\n save() {}\n}\n');
  scan = buildCodeScan((await indexProject(root, 'Demo')).tree);
  assert.equal(scan.directories[0].files[0].lines, 3);
  assert.equal(scan.directories[0].files[0].symbols[0].name, 'Store');
});

// Ensure source-linked outlines escape filenames and symbols and disclose partial counts.
test('Code Scan renderer escapes content and exposes accessible directory and source controls', () => {
  const scan = { directories: [{ path: 'src/<unsafe>', files: [{
    path: 'src/<unsafe>/app.js', name: '<app>.js', readable: true,
    ...scanCodeFile('app.js', 'class Store { save() {} }'),
  }, { path: 'src/<unsafe>/huge.js', name: 'huge.js', readable: false,
    lines: null, nonBlankLines: null, symbols: [], status: 'unavailable' }] }] };
  const html = renderCodeScan(scan, 'removed', 'Demo',
    // Build a safe relative link for the isolated renderer fixture.
    (path) => `/projects/demo/code-scan/${encodeURIComponent(path)}`,
  );
  assert.match(html, /aria-current="page"/);
  assert.match(html, /&lt;app&gt;\.js/);
  assert.doesNotMatch(html, /<unsafe>|<app>/);
  assert.match(html, /data-source="src\/&lt;unsafe&gt;\/app.js"/);
  assert.match(html, /data-symbol="save"/);
  assert.match(html, /1 files without line counts/);
  assert.match(html, /Line count unavailable/);
  assert.match(html, /data-scan-refresh/);
  // Empty scans do not request any directory URLs.
  const unusedDirectoryUrl = () => '';
  assert.match(renderCodeScan({ directories: [] }, '', 'Demo', unusedDirectoryUrl), /No source code found/);
});

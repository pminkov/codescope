import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const runNode = promisify(execFile);
const exporter = fileURLToPath(new URL('../scripts/export-demo.mjs', import.meta.url));

// Isolate a saved project and exercise the public CLI with its output inside the scanned root.
async function createExportFixture(t) {
  const work = await mkdtemp(join(tmpdir(), 'codescope-export-test-'));
  // Remove only this test's isolated source, storage, and generated site.
  t.after(() => rm(work, { recursive: true, force: true }));
  const root = join(work, 'repo');
  const storage = join(work, 'store');
  const saved = join(storage, 'projects', 'example');
  const site = join(root, 'demo');
  await mkdir(root);
  await mkdir(saved, { recursive: true });

  // Run the same CLI used to publish the real demo.
  const runExport = (...args) => runNode(process.execPath, [
    exporter, '--project', 'example', '--out', site, ...args,
  ], { env: { ...process.env, CODESCOPE_DATA_DIR: storage } });

  return { root, saved, site, registryPath: join(storage, 'projects.json'), runExport };
}

// Exercise the public command against a saved analysis without running a local server.
test('static export selects one project, preserves the registry, and replaces opted-in excerpts',
  async (t) => {
    const { root, saved, site, registryPath, runExport } = await createExportFixture(t);
    await writeFile(join(root, 'README.md'), 'UNPUBLISHED\npublic one\npublic two\nPRIVATE\n');
    await writeFile(join(root, '.ignored'), 'HIDDEN FILE');
    const registry = JSON.stringify([
      { id: 'example', root, name: 'Example', job: { status: 'running', feature: 'PRIVATE JOB' } },
      { id: 'other', root, name: 'UNSELECTED PROJECT' },
    ]);
    await writeFile(registryPath, registry);
    await writeFile(join(saved, 'understanding.json'), JSON.stringify({
      nextPrompts: { flows: 'PRIVATE SUGGESTION' },
      directoryAnalysis: {
        summary: 'Example project', sources: [{ path: 'README.md', line: 2, endLine: 3 }],
      },
      architectures: [{
        id: 'overview', title: 'System', nodes: [], edges: [], notes: [],
        requestedQuestion: 'PRIVATE QUESTION', modificationPrompts: ['PRIVATE REVISION'],
        baseline: { files: {}, analyzedAt: '2026-01-01' },
      }],
    }));

    await runExport('--source', 'README.md');
    const snapshotPath = join(site, 'project.json');
    const first = await readFile(snapshotPath, 'utf8');
    assert.deepEqual(JSON.parse(first).excerpts, {
      'README.md': [{ start: 2, lines: ['public one', 'public two'] }],
    });
    assert.ok(!first.includes(root));
    assert.doesNotMatch(first, /PRIVATE|UNPUBLISHED|UNSELECTED|\.ignored|"(?:job|baseline)":/);
    const indexPath = join(site, 'index.html');
    const html = await readFile(indexPath, 'utf8');
    const moduleUrl = /src="(\.\/app\.js\?v=[a-f0-9]{16})"/;
    assert.match(html, moduleUrl);
    assert.match(html, /data-demo>/);
    assert.doesNotMatch(html, /(?:src|href)="\//);
    assert.match(html, /href="#\/architecture"/);
    assert.equal(await readFile(registryPath, 'utf8'), registry);
    assert.deepEqual(await readdir(saved), ['understanding.json']);

    await assert.rejects(runExport('--source', '.ignored'), /No resolved citations/);
    assert.equal(await readFile(snapshotPath, 'utf8'), first);
    await runExport();
    const second = await readFile(snapshotPath, 'utf8');
    assert.deepEqual(JSON.parse(second).excerpts, {});
    assert.deepEqual(JSON.parse(second).sourceFiles, {});
    assert.doesNotMatch(second, /public one|demo\/index\.html/);
    const refreshedHtml = await readFile(indexPath, 'utf8');
    assert.match(refreshedHtml, moduleUrl);
    assert.notEqual(refreshedHtml.match(moduleUrl)[1], html.match(moduleUrl)[1]);

    await writeFile(join(site, 'keep.txt'), 'keep');
    await assert.rejects(runExport(), /Output contains unrelated files/);
    assert.equal(await readFile(join(site, 'keep.txt'), 'utf8'), 'keep');
    assert.equal(await readFile(snapshotPath, 'utf8'), second);
  });

// Full previews use the scanner's exact text and disappear when a later export omits them.
test('full-source export links uncited symbols to complete files and respects preview exclusions',
  async (t) => {
    const { root, saved, site, registryPath, runExport } = await createExportFixture(t);
    await writeFile(registryPath, JSON.stringify([{ id: 'example', root, name: 'Example' }]));
    await writeFile(join(saved, 'understanding.json'), '{}');
    await mkdir(join(root, 'src'));
    const path = 'src/example #1.js';
    const content = '// Example\r\nclass Store {\r\n  load() { return "café <&>"; }\r\n}\r\n';
    await writeFile(join(root, path), content);
    await writeFile(join(root, 'README.md'), 'Read me\n');
    await writeFile(join(root, '.codescopeignore'), 'excluded.js\n');
    await writeFile(join(root, 'excluded.js'), 'ignored');
    await writeFile(join(root, 'credentials.js'), 'sensitive');
    await writeFile(join(root, 'binary.js'), 'a\0b');
    await writeFile(join(root, 'large.js'), Buffer.alloc(1024 * 1024 + 1, 32));
    await symlink(join(root, 'excluded.js'), join(root, 'linked.js'));

    await runExport('--full-source');
    const snapshotPath = join(site, 'project.json');
    const snapshotText = await readFile(snapshotPath, 'utf8');
    const { project, sourceFiles } = JSON.parse(snapshotText);
    assert.deepEqual(Object.keys(sourceFiles).sort(), ['README.md', path]);
    assert.doesNotMatch(snapshotText, /café/);
    const sources = join(site, 'sources');
    const hash = sourceFiles[path];
    assert.match(hash, /^[a-f0-9]{64}$/);
    const preview = JSON.parse(await readFile(join(sources, `${hash}.json`), 'utf8'));
    assert.equal(preview.content, content);
    const directory = project.codeScan.directories.find(
      // Select the directory containing the nested declaration.
      (entry) => entry.path === 'src',
    );
    const [method] = directory.files[0].symbols[0].children;
    assert.equal(method.name, 'load');
    assert.match(preview.content.split('\n')[method.line - 1], /load\(\)/);

    const unrelated = join(sources, `${'0'.repeat(64)}.json`);
    await writeFile(unrelated, 'keep');
    await assert.rejects(runExport(), /Output contains unrelated files/);
    assert.equal(await readFile(unrelated, 'utf8'), 'keep');
    await rm(unrelated);

    await writeFile(join(root, path), '\n' + content);
    await runExport('--full-source');
    const refreshed = JSON.parse(await readFile(snapshotPath, 'utf8'));
    assert.notEqual(refreshed.sourceFiles[path], hash);
    assert.ok(!(await readdir(sources)).includes(`${hash}.json`));
    await runExport();
    assert.deepEqual(JSON.parse(await readFile(snapshotPath, 'utf8')).sourceFiles, {});
    assert.ok(!(await readdir(site)).includes('sources'));
  });

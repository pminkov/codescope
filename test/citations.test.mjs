import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCitations, normalizeAnalysis } from '../src/citations.mjs';
import { fingerprint, resolveReference } from '../src/analysis.mjs';
import { formatText } from '../public/content.js';

const options = {
  knownPaths: new Set(['src/main.ts', 'README']),
  hashes: { 'src/main.ts': 'reviewed-hash' },
};

// Resolve exact saved lines without guessing locations from symbols or match text.
test('source references require explicit lines and retain source freshness', () => {
  const content = 'export function main() { return 42; }\n';
  const sources = { 'src/main.ts': content };
  const reference = { path: 'src/main.ts', symbol: 'main', hash: fingerprint(content) };
  assert.equal(resolveReference({ ...reference, line: 1 }, sources).line, 1);
  assert.equal(resolveReference({ ...reference, line: 1 }, sources).stale, false);
  assert.equal(resolveReference({ ...reference, match: 'return 42' }, sources).line, null);
  assert.equal(resolveReference(reference, sources).line, null);
  assert.equal(resolveReference({ ...reference, line: 99 }, sources).line, null);
  assert.equal(resolveReference({ ...reference, line: 1, endLine: 99 }, sources).line, null);
  assert.equal(resolveReference({ ...reference, line: 1, hash: 'old' }, sources).stale, true);
  assert.equal(resolveReference({ ...reference, line: 1 }, {}).stale, true);
});

// Verify generated inline markers become structured evidence without changing identifiers.
test('inline citation markers become deduplicated evidence without changing source identifiers', () => {
  const original = {
    path: 'src',
    title: '`Source` [src/main.ts:1]',
    description: 'Runs `main()`. [src/main.ts:1] [src/main.ts:1]',
    detail: 'See the guide. [README:2]',
    highlights: ['Has one handler. [src/main.ts:1]', '[src/main.ts:3]'],
    sources: [{ path: 'src/main.ts', line: 1, symbol: 'main', hash: 'reviewed-hash' }],
    source: { path: 'src/main.ts', line: 1, symbol: 'main' },
  };
  const result = normalizeAnalysis(original, options);
  assert.equal(result.title, 'Source');
  assert.equal(result.description, 'Runs `main()`.');
  assert.equal(result.detail, 'See the guide.');
  assert.deepEqual(result.highlights, ['Has one handler.']);
  assert.deepEqual(
    result.sources.map(
      // Read citation paths and lines for the expected evidence assertion.
      ({ path, line }) => [path, line],
    ),
    [
      ['src/main.ts', 1],
      ['README', 2],
      ['src/main.ts', 3],
    ],
  );
  assert.deepEqual(result.source, original.source);
  assert.equal(result.path, 'src');
  assert.ok(original.description.includes('[src/main.ts:1]'));
});

// Verify evidence remains attached to its diagram or flow record.
test('normalization keeps evidence at the relevant record across diagrams and flows', () => {
  const value = normalizeAnalysis(
    {
      description: 'Overview. [src/main.ts:1]',
      nodes: [{ id: 'entry', description: 'Entrypoint. [src/main.ts:2]' }],
      phases: [
        { title: 'Run', steps: [{ id: 'run', description: 'Calls main. [src/main.ts:3]' }] },
      ],
      requestedFeature: 'Explain [src/main.ts:1]',
    },
    options,
  );
  assert.equal(value.sources[0].line, 1);
  assert.equal(value.nodes[0].sources[0].line, 2);
  assert.equal(value.phases[0].steps[0].sources[0].line, 3);
  assert.equal(value.nodes[0].sources[0].hash, 'reviewed-hash');
  assert.equal(value.requestedFeature, 'Explain [src/main.ts:1]');
});

// Verify citation ranges survive while ordinary array slices remain prose.
test('file ranges are preserved while code array slices remain ordinary text', () => {
  const result = extractCitations('See [src/main.ts:L2-L8]. Keep `[start:10]`.', options);
  assert.equal(result.text, 'See. Keep `[start:10]`.');
  assert.deepEqual(result.sources[0], {
    path: 'src/main.ts',
    line: 2,
    endLine: 8,
    symbol: '',
    hash: 'reviewed-hash',
  });
});

// Verify supported inline formatting escapes untrusted HTML.
test('inline formatting renders code and emphasis without trusting generated HTML', () => {
  assert.equal(
    formatText('Loads `/reflections.json` and **formats** it.'),
    'Loads <code class="inline-code">/reflections.json</code> and <strong>formats</strong> it.',
  );
  const html = formatText('<img src=x onerror=alert(1)> and `<script>bad()</script>`');
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('<code class="inline-code">&lt;script&gt;bad()&lt;/script&gt;</code>'));
  assert.equal(
    formatText('First paragraph.\n\nSecond paragraph.'),
    'First paragraph.<br><br>Second paragraph.',
  );
});

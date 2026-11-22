import test from 'node:test';
import assert from 'node:assert/strict';
import { getAnalysisEntries } from '../public/analysis-list.js';

// Build a result whose creation date deliberately differs from its analysis date.
function savedAnalysis(id, analyzedAt, createdAt = '2026-01-01T00:00:00Z') {
  return {
    id, title: id, description: `Description of ${id}`, createdAt,
    review: { reviewedAt: analyzedAt },
  };
}

// Verify every analysis type participates in one ordering without changing storage order.
test('all results sort by analysis time across types, including reruns and copies', () => {
  const project = {
    hasDirectoryAnalysis: true,
    description: 'Project directory explanations',
    directoryReview: { reviewedAt: '2026-11-15T10:00:00Z' },
    architectures: [
      savedAnalysis('overview', '2026-11-14T10:00:00Z'),
      savedAnalysis('rerun', '2026-11-20T10:00:00Z'),
      savedAnalysis('copy', '2026-11-14T10:00:00Z', '2026-11-21T10:00:00Z'),
    ],
    flows: [savedAnalysis('flow', '2026-11-16T10:00:00Z')],
    nounAnalyses: [savedAnalysis('nouns', '2026-11-17T10:00:00Z')],
    sequences: [savedAnalysis('sequence', '2026-11-18T10:00:00Z')],
  };
  const original = structuredClone(project);
  const entries = getAnalysisEntries(project);

  // Compare routes as well as order so every card opens the corresponding result.
  assert.deepEqual(entries.map((entry) => [entry.tab, entry.id]), [
    ['architecture', 'rerun'],
    ['sequences', 'sequence'],
    ['nouns', 'nouns'],
    ['flows', 'flow'],
    ['directories', ''],
    ['architecture', 'overview'],
    ['architecture', 'copy'],
  ]);
  assert.equal(entries[4].description, project.description);
  assert.equal(entries[0].title, 'rerun');
  assert.equal(entries[0].analyzedAt, '2026-11-20T10:00:00Z');
  assert.deepEqual(project, original);
});

// Keep old results visible without assigning them a misleading creation date.
test('undated results come last and preserve their order', () => {
  const entries = getAnalysisEntries({
    hasDirectoryAnalysis: true,
    architectures: [savedAnalysis('missing', undefined, '2026-12-01T00:00:00Z')],
    flows: [savedAnalysis('known', '2026-11-20T10:00:00Z')],
    sequences: [savedAnalysis('invalid', 'invalid date')],
  });

  // Confirm unknown dates cannot outrank successfully analyzed results.
  assert.deepEqual(entries.map((entry) => entry.id), ['known', '', 'missing', 'invalid']);
  assert.equal(entries[1].analyzedAt, null);
  assert.equal(entries[2].analyzedAt, null);
  assert.equal(entries[3].analyzedAt, null);
});

// Exclude live file inventory when directory explanations have not been generated.
test('projects without saved results produce an empty list', () => {
  assert.deepEqual(getAnalysisEntries({}), []);
  assert.deepEqual(getAnalysisEntries({
    hasDirectoryAnalysis: false,
    directoryReview: { reviewedAt: '2026-11-20T10:00:00Z' },
    architectures: [], flows: [], nounAnalyses: [], sequences: [],
  }), []);
});

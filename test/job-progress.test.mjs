import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createJobDismissals, formatJobElapsed, formatJobMessageTime, getJobMessages,
  getJobDismissalDelay, getJobAnalysisTargets,
} from '../public/job-progress.js';

// Preserve manual closure without hiding new jobs, another project, or active work.
test('finished progress can be closed manually and closure survives reloads', () => {
  const values = new Map();
  const host = { localStorage: {
    // Read saved browser preferences shared by successive page instances.
    getItem(key) { return values.get(key) ?? null; },

    // Retain only the dismissed job ID rather than copying analysis content.
    setItem(key, value) { values.set(key, value); },
  } };
  const job = { id: 'initial-job', kind: 'initial', status: 'running' };
  const progress = createJobDismissals(host);
  assert.equal(progress.isDismissed('project', job), false);
  assert.equal(progress.dismiss('project', job), false);
  job.status = 'completed';
  assert.equal(progress.isDismissed('project', job), false);
  assert.equal(createJobDismissals(host).isDismissed('project', job), false);
  assert.equal(progress.dismiss('project', job), true);
  assert.equal(progress.isDismissed('project', job), true);
  assert.equal(progress.isDismissed('other-project', job), false);
  const reloaded = createJobDismissals(host);
  assert.equal(reloaded.isDismissed('project', job), true);

  for (const kind of ['initial', 'directories', 'architecture', 'flow', 'nouns', 'sequence']) {
    for (const status of ['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted']) {
      const next = { id: `${kind}-${status}`, kind, status };
      assert.equal(reloaded.isDismissed('project', next), false);
      assert.equal(reloaded.dismiss('project', next), !['queued', 'running'].includes(status));
    }
  }
  assert.equal(progress.isDismissed('project', { ...job, status: 'running' }), false);
  assert.equal(progress.dismiss('project', { id: 'index', kind: 'index', status: 'completed' }), false);
  assert.equal(progress.dismiss('project', null), false);
});

// Use execution time so reopening yesterday's analysis never revives its progress.
test('finished progress expires five minutes after execution, including on reload', () => {
  const finished = Date.parse('2026-11-19T12:00:00Z');
  for (const status of ['completed', 'failed', 'cancelled', 'interrupted']) {
    const job = {
      id: status, kind: 'architecture', status,
      finishedAt: new Date(finished).toISOString(),
    };
    const progress = createJobDismissals({});
    assert.equal(getJobDismissalDelay(job, finished), 300000);
    assert.equal(getJobDismissalDelay(job, finished + 299999), 1);
    assert.equal(progress.isDismissed('project', job, finished + 299999), false);
    assert.equal(getJobDismissalDelay(job, finished + 300000), 0);
    assert.equal(progress.isDismissed('project', job, finished + 300000), true);
    assert.equal(createJobDismissals({}).isDismissed(
      'project', job, finished + 24 * 60 * 60 * 1000,
    ), true);
    assert.equal(job.status, status);
  }
});

// Never expire active work or guess a missing completion time from later updates.
test('progress expiration respects active jobs and requires a completion timestamp', () => {
  const now = Date.parse('2026-11-20T12:00:00Z');
  const job = {
    id: 'finished', kind: 'flow', status: 'completed', finishedAt: '2026-11-19T12:00:00Z',
  };
  assert.equal(getJobDismissalDelay(job, now), 0);
  assert.equal(createJobDismissals({}).isDismissed('project', job, now), true);

  for (const next of [null, { ...job, status: 'queued' }, { ...job, status: 'running' },
    { ...job, kind: 'index' }, { ...job, finishedAt: undefined },
    { ...job, finishedAt: 'invalid' },
    { ...job, finishedAt: undefined, updatedAt: job.finishedAt }]) {
    assert.equal(getJobDismissalDelay(next, now), null);
    assert.equal(createJobDismissals({}).isDismissed('project', next, now), false);
  }
});

// Browser storage failures should leave manual closure usable in the current page.
test('job dismissal falls back to memory when browser storage is blocked', () => {
  const blockedHost = {
    // Model browsers that throw before the storage object can be read.
    get localStorage() { throw new Error('Storage blocked'); },
  };
  const job = { id: 'finished', kind: 'directories', status: 'completed' };
  for (const host of [blockedHost, {}, { localStorage: {
    // Model browsers whose storage methods fail rather than their getter.
    getItem() { throw new Error('Storage read blocked'); },

    // Quota limits can block writes even when a storage object exists.
    setItem() { throw new Error('Storage write blocked'); },
  } }]) {
    const progress = createJobDismissals(host);
    assert.equal(progress.isDismissed('project', job), false);
    assert.equal(progress.dismiss('project', job), true);
    assert.equal(progress.isDismissed('project', job), true);
    assert.equal(progress.isDismissed('project', { ...job, id: 'new-job' }), false);
  }
});

// Exercise minute boundaries, clock skew, and jobs that have not started.
test('elapsed time shows execution minutes and seconds from the original start', () => {
  const start = Date.parse('2026-11-19T12:00:00Z');
  const job = { status: 'running', startedAt: new Date(start).toISOString() };

  for (const [offset, expected] of [
    [-1000, '00:00'], [0, '00:00'], [999, '00:00'], [1000, '00:01'],
    [59000, '00:59'], [60000, '01:00'], [125000, '02:05'], [3661000, '61:01'],
  ])
    assert.equal(formatJobElapsed(job, start + offset), expected);
  assert.equal(formatJobElapsed({ status: 'queued', createdAt: job.startedAt }, start + 60000), '00:00');
  assert.equal(formatJobElapsed({ status: 'running', startedAt: 'invalid' }, start), '00:00');
  assert.equal(formatJobElapsed(null, start), '00:00');
});

// Terminal jobs retain their duration as time advances or the browser reloads.
test('elapsed time freezes on completion, failure, cancellation, and interruption', () => {
  for (const status of ['completed', 'failed', 'cancelled', 'interrupted']) {
    const job = {
      status, startedAt: '2026-11-19T12:00:00Z', finishedAt: '2026-11-19T12:02:03Z',
    };
    assert.equal(formatJobElapsed(job, Date.parse('2026-11-20T12:00:00Z')), '02:03');
  }
  assert.equal(formatJobElapsed({
    status: 'failed', startedAt: '2026-11-19T12:00:00Z', updatedAt: '2026-11-19T12:00:45Z',
  }), '00:00');
});

// Keep chronological order and bound displayed history without mutating saved records.
test('job message presentation preserves the latest four without mutating saved history', () => {
  const timestamp = '2026-11-19T23:07:09.123Z';
  const job = { messages: [
    { message: 'One', timestamp }, { message: 'Two', timestamp },
    { message: 'Three', timestamp }, { message: 'Four', timestamp },
    { message: 'Five', timestamp },
  ], message: 'Five' };
  const saved = structuredClone(job);
  assert.deepEqual(getJobMessages(job), [
    { message: 'Two', timestamp }, { message: 'Three', timestamp },
    { message: 'Four', timestamp }, { message: 'Five', timestamp },
  ]);
  assert.deepEqual(job, saved);
  assert.notEqual(getJobMessages(job), job.messages);
  assert.deepEqual(getJobMessages({ messages: [] }), []);
  assert.deepEqual(getJobMessages(null), []);
});

// Preserve recorded instants through reloads and visibly distinguish missing history.
test('message timestamps retain recorded seconds and handle invalid display values', () => {
  const timestamp = '2026-11-19T23:07:09.123Z';
  const job = { messages: [{ message: 'Recorded', timestamp }], message: 'Recorded' };
  assert.deepEqual(getJobMessages(job), [
    { message: 'Recorded', timestamp },
  ]);
  assert.match(formatJobMessageTime(timestamp), /^\d{2}:\d{2}:09$/);
  assert.equal(formatJobMessageTime(null), '--:--:--');
  assert.equal(formatJobMessageTime('invalid'), '--:--:--');
});

// Completed jobs link to their own saved result even when another result is listed first.
test('completed job targets preserve exact new, rerun, and modified result selections', () => {
  for (const [kind, collection, tab] of [
    ['architecture', 'architectures', 'architecture'], ['flow', 'flows', 'flows'],
    ['nouns', 'nounAnalyses', 'nouns'], ['sequence', 'sequences', 'sequences'],
  ]) {
    const project = {
      [collection]: [{ id: 'other-result' }, { id: 'completed-result' }],
      job: { status: 'completed', kind, resultId: 'completed-result' },
    };
    const expected = [{ tab, selection: 'completed-result', label: 'Open analysis' }];
    assert.deepEqual(getJobAnalysisTargets(project), expected);
    project.job = { status: 'completed', kind, analysisId: 'completed-result' };
    assert.deepEqual(getJobAnalysisTargets(project), expected);
    project.job.modificationPrompt = 'Simplify the explanation.';
    assert.deepEqual(getJobAnalysisTargets(project), expected);
  }
});

// Initial analysis produces two destinations, while directory-only refreshes have one.
test('completed initial and directory jobs link to their available saved analyses', () => {
  const project = {
    hasDirectoryAnalysis: true,
    architectures: [{ id: 'other' }, { id: 'overview' }],
    job: { status: 'completed', kind: 'initial' },
  };
  const directories = { tab: 'directories', selection: '', label: 'Open directories' };
  assert.deepEqual(getJobAnalysisTargets(project), [directories, {
    tab: 'architecture', selection: 'overview', label: 'Open architecture',
  }]);
  project.job.kind = 'directories';
  assert.deepEqual(getJobAnalysisTargets(project), [directories]);
  project.hasDirectoryAnalysis = false;
  assert.deepEqual(getJobAnalysisTargets(project), []);
});

// Missing IDs, deleted results, and failed jobs never point to another saved analysis.
test('completed job targets omit unavailable results and unsuccessful jobs', () => {
  const project = {
    architectures: [{ id: 'other' }], hasDirectoryAnalysis: true,
    job: { kind: 'architecture', status: 'completed', resultId: 'deleted' },
  };
  assert.deepEqual(getJobAnalysisTargets(project), []);
  delete project.job.resultId;
  assert.deepEqual(getJobAnalysisTargets(project), []);
  for (const status of ['failed', 'cancelled', 'interrupted']) {
    project.job = { kind: 'initial', status };
    assert.deepEqual(getJobAnalysisTargets(project), []);
  }
  assert.deepEqual(getJobAnalysisTargets({ job: { kind: 'index', status: 'completed' } }), []);
  assert.deepEqual(getJobAnalysisTargets(null), []);
});

// Active runs open their view immediately and retain exact saved targets for reruns.
test('queued and running jobs expose analysis navigation before completion', () => {
  for (const status of ['queued', 'running']) {
    for (const [kind, collection, tab] of [
      ['architecture', 'architectures', 'architecture'], ['flow', 'flows', 'flows'],
      ['nouns', 'nounAnalyses', 'nouns'], ['sequence', 'sequences', 'sequences'],
    ]) {
      const project = { job: { kind, status }, [collection]: [{ id: 'other-result' }] };
      assert.deepEqual(getJobAnalysisTargets(project), [{
        tab, selection: '', label: 'Open analysis',
      }]);
      project.job.analysisId = 'other-result';
      assert.deepEqual(getJobAnalysisTargets(project), [{
        tab, selection: 'other-result', label: 'Open analysis',
      }]);
      project.job.modificationPrompt = 'Simplify this result.';
      assert.equal(getJobAnalysisTargets(project)[0].selection, 'other-result');
      project[collection].push({ id: 'new-result' });
      project.job.resultId = 'new-result';
      assert.equal(getJobAnalysisTargets(project)[0].selection, 'new-result');
    }
    const project = { job: { kind: 'initial', status } };
    const directories = { tab: 'directories', selection: '', label: 'Open directories' };
    assert.deepEqual(getJobAnalysisTargets(project), [directories, {
      tab: 'architecture', selection: '', label: 'Open architecture',
    }]);
    project.job.kind = 'directories';
    assert.deepEqual(getJobAnalysisTargets(project), [directories]);
  }
});

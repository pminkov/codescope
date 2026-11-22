import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createJobDismissals, formatJobElapsed, formatJobMessageTime, getJobMessages,
  getJobDismissalDelay,
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

// Never expire active work or guess an end time when legacy timestamps are missing.
test('progress expiration respects active jobs and legacy completion timestamps', () => {
  const now = Date.parse('2026-11-20T12:00:00Z');
  const job = {
    id: 'legacy', kind: 'flow', status: 'completed', updatedAt: '2026-11-19T12:00:00Z',
  };
  assert.equal(getJobDismissalDelay(job, now), 0);
  assert.equal(createJobDismissals({}).isDismissed('project', job, now), true);

  for (const next of [null, { ...job, status: 'queued' }, { ...job, status: 'running' },
    { ...job, kind: 'index' }, { ...job, updatedAt: undefined },
    { ...job, updatedAt: 'invalid' }]) {
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
  }), '00:45');
});

// Keep chronological order, bound old records, and retain legacy progress text.
test('job message presentation preserves the latest four without mutating saved history', () => {
  const job = { messages: ['One', 'Two', 'Three', 'Four', 'Five'], message: 'Six' };
  assert.deepEqual(getJobMessages(job), [
    { message: 'Three', timestamp: null }, { message: 'Four', timestamp: null },
    { message: 'Five', timestamp: null }, { message: 'Six', timestamp: null },
  ]);
  assert.deepEqual(job.messages, ['One', 'Two', 'Three', 'Four', 'Five']);
  assert.deepEqual(getJobMessages({ messages: ['One', 'Two'], message: 'Two' }), [
    { message: 'One', timestamp: null }, { message: 'Two', timestamp: null },
  ]);
  assert.deepEqual(getJobMessages({ message: 'Legacy progress' }), [{ message: 'Legacy progress', timestamp: null }]);
  assert.deepEqual(getJobMessages({ messages: [null, '', '  ', 'Valid'], message: 'Latest' }), [
    { message: 'Valid', timestamp: null }, { message: 'Latest', timestamp: null },
  ]);
  assert.deepEqual(getJobMessages(null), []);
});

// Preserve recorded instants through reloads and visibly distinguish missing history.
test('message timestamps retain seconds and normalize mixed historical records', () => {
  const timestamp = '2026-11-19T23:07:09.123Z';
  const job = { messages: ['Legacy', { message: 'Recorded', timestamp }], message: 'Recorded' };
  assert.deepEqual(getJobMessages(job), [
    { message: 'Legacy', timestamp: null }, { message: 'Recorded', timestamp },
  ]);
  assert.match(formatJobMessageTime(timestamp), /^\d{2}:\d{2}:09$/);
  assert.equal(formatJobMessageTime(null), '--:--:--');
  assert.equal(formatJobMessageTime('invalid'), '--:--:--');
  assert.deepEqual(getJobMessages({ messages: [{ message: 'Bad time', timestamp: 'invalid' }] }), [
    { message: 'Bad time', timestamp: null },
  ]);
});

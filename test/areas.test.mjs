import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { ProjectStore } from '../src/storage.mjs';
import { createApp } from '../src/server.mjs';
import { indexProject, fingerprint } from '../src/analysis.mjs';
import { analysisPrompt, validateAnalysis } from '../src/runner.mjs';
import { selectedAskContext, validateQuestion } from '../src/ask.mjs';
import { renderAreasView } from '../public/views/areas.js';
import { getAnalysisEntries } from '../public/analysis-list.js';
import { getJobAnalysisTargets } from '../public/job-progress.js';
import { createAreasResult } from './area-fixtures.mjs';

// Isolate source, saved state, and the simulated model from registered user projects.
async function createAreasFixture(context) {
  const directory = await mkdtemp(join(tmpdir(), 'codescope-areas-'));
  const root = join(directory, 'app');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src/main.ts'), 'export function main() { return "hello"; }\n');
  const store = new ProjectStore({
    dataDirectory: join(directory, 'data'), run: createAreasResult,
  });
  // Stop all writers before deleting the test source and saved-state directories.
  context.after(async () => {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const project = await store.add({ path: root, analyze: false });

  return { directory, root, store, project };
}

// Wait for persisted results without depending on a real CLI or model response.
async function waitForAreasJob(store) {
  const deadline = Date.now() + 8000;
  while (store.running || store.queue.length) {
    if (Date.now() > deadline) throw new Error('Areas fixture job timed out.');
    await delay(10);
  }
}

// Exercise saved maps, revisions, source freshness, and contextual navigation together.
test('areas persist maps and support revisions and current-area Ask', async (context) => {
  const { directory, root, store, project } = await createAreasFixture(context);
  assert.deepEqual((await store.view(project.id)).areaAnalyses, []);
  for (const scope of [null, 42, {}, 'x'.repeat(4001)])
    await assert.rejects(store.enqueue(project.id, 'areas', scope), { status: 400 });
  const job = await store.enqueue(project.id, 'areas');
  await waitForAreasJob(store);
  let view = await store.view(project.id);
  assert.equal(view.job.status, 'completed');
  const first = view.areaAnalyses[0];
  assert.equal(first.requestedScope, null);
  assert.equal(first.areas.length, 8);
  assert.equal(first.areas[6].sources[0].stale, false);
  assert.ok(first.areas[6].sources[0].hash);
  assert.equal(view.stats.areaAnalyses, 1);
  assert.equal(getAnalysisEntries(view)[0].tab, 'areas');
  assert.deepEqual(getJobAnalysisTargets(view), [{
    tab: 'areas', selection: first.id, label: 'Open analysis',
  }]);
  const inputs = await store.jobPrompts(project.id, job.id);
  assert.equal(inputs.prompts[0].stage, 'areas');
  assert.match(inputs.prompts[0].content, /backend services/);
  assert.match(inputs.prompts[0].schema.content, /parentId/);
  const ask = selectedAskContext(view, { view: 'areas', selection: `${first.id}/jobs` });
  assert.equal(ask.id, first.id);
  assert.equal(ask.selectedArea.name, 'Job processing');
  assert.equal(selectedAskContext(view, { view: 'areas', selection: first.id }).selectedArea, null);
  assert.throws(
    // An old box URL must not silently resolve to a different responsibility.
    () => selectedAskContext(view, { view: 'areas', selection: `${first.id}/missing` }),
    /area no longer exists/,
  );
  assert.throws(
    // Deleted maps must not answer questions using a different saved result.
    () => selectedAskContext(view, { view: 'areas', selection: 'missing' }),
    /analysis no longer exists/,
  );
  assert.equal(validateQuestion({
    question: 'What does this area do?',
    context: { view: 'areas', selection: `${first.id}/jobs`, label: 'Jobs', excerpt: '' },
  }).context.view, 'areas');

  await store.enqueue(project.id, 'areas', ' Backend ');
  await waitForAreasJob(store);
  view = await store.view(project.id);
  assert.equal(view.areaAnalyses.length, 2);
  assert.equal(view.areaAnalyses[1].requestedScope, 'Backend');
  assert.equal(view.areaAnalyses[0].id, first.id);
  await writeFile(join(root, 'src/main.ts'), 'export function main() { return "changed"; }\n');
  view = await store.view(project.id);
  assert.equal(view.areaAnalyses[0].review.current, false);
  assert.equal(view.areaAnalyses[0].areas[6].sources[0].stale, true);
  await store.changeAnalysis(project.id, 'areas', first.id, 'rerun');
  await waitForAreasJob(store);
  view = await store.view(project.id);
  assert.equal(view.areaAnalyses.length, 2);
  assert.equal(view.areaAnalyses[0].id, first.id);
  assert.equal(view.areaAnalyses[0].review.current, true);
  await store.changeAnalysis(project.id, 'areas', first.id, 'modify', 'Clarify job ownership.');
  await waitForAreasJob(store);
  view = await store.view(project.id);
  assert.deepEqual(view.areaAnalyses[0].modificationPrompts, ['Clarify job ownership.']);
  assert.equal(view.job.status, 'completed');
  const copy = await store.changeAnalysis(project.id, 'areas', first.id, 'duplicate');
  assert.notEqual(copy.analysisId, first.id);
  view = await store.view(project.id);
  assert.equal(view.areaAnalyses.length, 3);
  assert.match(view.areaAnalyses[1].title, /\(copy\)/);
  await store.changeAnalysis(project.id, 'areas', copy.analysisId, 'delete');
  const saved = await readFile(store.path(project.id, 'understanding.json'), 'utf8');
  // A malformed rerun must leave the last usable hierarchy intact.
  store.run = () => ({ ...createAreasResult(), areas: [{ id: 'invalid' }] });
  await store.changeAnalysis(project.id, 'areas', first.id, 'rerun');
  await waitForAreasJob(store);
  assert.equal((await store.get(project.id)).job.status, 'failed');
  assert.equal(await readFile(store.path(project.id, 'understanding.json'), 'utf8'), saved);
  await store.close();
  const reopened = new ProjectStore({ dataDirectory: join(directory, 'data') });
  // Finish the reopened registry before the surrounding fixture is removed.
  context.after(() => reopened.close());
  assert.equal((await reopened.view(project.id)).areaAnalyses.length, 2);
});

// Reject malformed partitions and source claims before they become navigable saved maps.
test('areas validation rejects ambiguous hierarchies and unavailable evidence', async (context) => {
  const { root } = await createAreasFixture(context);
  const index = await indexProject(root, 'App');
  const content = await readFile(join(root, 'src/main.ts'), 'utf8');
  const snapshot = {
    sources: { 'src/main.ts': content }, fingerprints: { 'src/main.ts': fingerprint(content) },
    coverage: { included: 1, total: 1, bytes: content.length },
  };
  assert.equal(validateAnalysis('areas', createAreasResult(), index, snapshot).areas.length, 8);
  const changes = [
    // Each responsibility needs a globally unique address.
    (value) => { value.areas[1].id = value.areas[0].id; },
    // Every parent must belong to the same saved map.
    (value) => { value.areas[2].parentId = 'missing'; },
    // A box cannot contain itself.
    (value) => { value.areas[0].parentId = 'interface'; },
    // Detached cycles must be rejected even when other roots are valid.
    (value) => { value.areas[1].parentId = 'jobs'; },
    // A single child does not provide a useful breakdown.
    (value) => { value.areas.splice(3, 1); },
    // Sparse maps should stay within the three-level exploration limit.
    (value) => { value.areas[3].parentId = 'queue'; },
    // Every area needs actual implementation evidence.
    (value) => { value.areas[0].sources = []; },
    // File citations cannot escape the inspected source snapshot.
    (value) => { value.areas[0].sources[0].path = 'missing.ts'; },
    // Line citations must exist in the inspected source.
    (value) => { value.areas[0].sources[0].line = 1000; },
    // A level must remain a small collection of boxes.
    (value) => {
      value.areas = Array.from({ length: 11 },
        // Supply independent valid roots to isolate the sibling-count restriction.
        (_, index) => ({ ...value.areas[0], id: `root-${index}` }),
      );
    },
  ];
  for (const change of changes) {
    const value = createAreasResult();
    change(value);
    assert.throws(
      // Check each invalid hierarchy independently against the same inspected source.
      () => validateAnalysis('areas', value, index, snapshot),
    );
  }
  assert.deepEqual(validateAnalysis('areas', {
    ...createAreasResult(), areas: [],
  }, index, snapshot).areas, []);
  assert.equal(validateAnalysis('areas', {
    ...createAreasResult(), areas: [createAreasResult().areas[0]],
  }, index, snapshot).areas.length, 1);
  const prompt = analysisPrompt('areas', { name: 'App' }, index, snapshot, 'Backend');
  assert.match(prompt, /this scope: "Backend"/);
  assert.match(prompt, /rather than folders/);
});

// Verify HTTP dispatch, saved-result actions, and direct nested-page reloads.
test('areas HTTP APIs serve drill-down routes and saved-map actions', async (context) => {
  const { store, project } = await createAreasFixture(context);
  const app = createApp({ store });
  // Close connections before shutting down the test listener.
  context.after(async () => {
    app.closeAllConnections();
    await new Promise(
      // Await listener teardown before fixture cleanup.
      (resolve) => app.close(resolve),
    );
  });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const base = `http://127.0.0.1:${app.address().port}`;
  const route = `/api/projects/${project.id}/areas`;
  // Send bounded JSON requests through the same public API used by the browser.
  const post = (path, body) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await fetch(`${base}${route}`)).status, 405);
  assert.equal((await post(route, { scope: 42 })).status, 400);
  const response = await post(route, {});
  assert.equal(response.status, 202);
  assert.equal((await response.json()).kind, 'areas');
  await waitForAreasJob(store);
  const id = (await store.view(project.id)).areaAnalyses[0].id;
  assert.equal((await fetch(`${base}/projects/${project.id}/areas/${id}/jobs`)).status, 200);
  assert.equal((await fetch(`${base}/views/areas.js`)).status, 200);
  const action = `/api/projects/${project.id}/analyses/areas/${id}`;
  const modification = await post(`${action}/modify`, { prompt: 'Clarify responsibilities.' });
  assert.equal(modification.status, 202);
  await waitForAreasJob(store);
  assert.equal((await store.view(project.id)).job.status, 'completed');
  const copy = await post(`${action}/duplicate`, {});
  assert.equal(copy.status, 200);
  assert.equal((await store.view(project.id)).areaAnalyses.length, 2);
  assert.equal((await post(`${action}/delete`, {})).status, 200);
  assert.equal((await store.view(project.id)).areaAnalyses.length, 1);
});

// Keep each level small, source-linked, and safely escaped while exposing enclosing boxes.
test('areas view renders immediate children, breadcrumbs, leaves, and empty states', () => {
  const selected = { ...createAreasResult(), id: 'saved' };
  const project = { name: 'App <demo>', areaAnalyses: [selected] };
  const options = {
    actionsBusy: false,
    // Mirror the browser route convention, including the optional nested box ID.
    projectUrl: (tab, selection = '') => `/projects/app/${tab}/${selection}`,
  };
  const top = renderAreasView(project, selected, options);
  assert.equal((top.match(/class="area-card"/g) || []).length, 2);
  assert.match(top, /href="\/projects\/app\/areas\/saved\/backend"/);
  assert.match(top, /Explore 2 areas/);
  assert.doesNotMatch(top, /<h3[^>]*>Application areas<\/h3>/);
  assert.doesNotMatch(top, /Open a box to explore|The whole application\.|<h3>Notes<\/h3>/);
  assert.doesNotMatch(top, /The backend owns persistent analysis results\./);
  assert.doesNotMatch(top, /<h3>Job processing<\/h3>/);
  const backend = renderAreasView(project, selected, { ...options, areaId: 'backend' });
  assert.match(backend, /<h3>Job processing<\/h3>/);
  assert.match(backend, /<h3>Persistence<\/h3>/);
  assert.doesNotMatch(backend, /<h3>Navigation<\/h3>/);
  const jobs = renderAreasView(project, selected, { ...options, areaId: 'jobs' });
  assert.match(jobs, /saved\/backend/);
  assert.match(jobs, /<h3>Job queue<\/h3>/);
  const leaf = renderAreasView(project, selected, { ...options, areaId: 'queue' });
  assert.doesNotMatch(leaf, /class="area-card"/);
  assert.match(leaf, /most detailed level/);
  assert.match(leaf, /data-source="src\/main.ts"/);
  assert.match(leaf, /data-analysis-kind="areas"/);
  assert.match(leaf, /saved\/backend/);
  assert.match(leaf, /saved\/jobs/);
  assert.equal(renderAreasView(project, selected, { ...options, areaId: 'missing' }), top);
  selected.areas[0].name = '<img src=x onerror=alert(1)>';
  selected.areas[0].description = '<script>alert(1)</script>';
  const safe = renderAreasView(project, selected, options);
  assert.doesNotMatch(safe, /<img|<script/);
  assert.match(safe, /&lt;img/);
  assert.match(safe, /data-new-analysis="areas"/);
  const empty = renderAreasView(project, { ...selected, areas: [] }, options);
  assert.match(empty, /No areas were identified/);
  const introduction = renderAreasView(project, undefined, { ...options, actionsBusy: true });
  assert.match(introduction, /App &lt;demo&gt;/);
  assert.match(introduction, /backend services and infrastructure/);
  assert.match(introduction, /data-new-analysis="areas"[^>]*\bdisabled/);
});

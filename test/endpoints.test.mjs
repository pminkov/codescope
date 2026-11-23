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
import { renderEndpointsView } from '../public/views/endpoints.js';
import { getAnalysisEntries } from '../public/analysis-list.js';
import { getJobAnalysisTargets } from '../public/job-progress.js';
import { createEndpointsResult } from './endpoint-fixtures.mjs';

// Simulate structured endpoint discovery without invoking the real CLI.
function runEndpointsFixture(options) {
  options.onProgress('Inspecting server entrypoints and route handlers…');

  return createEndpointsResult();
}

// Create source and saved-state directories isolated from registered user projects.
async function createEndpointsFixture(context, run = runEndpointsFixture) {
  const directory = await mkdtemp(join(tmpdir(), 'codescope-endpoints-'));
  const root = join(directory, 'api');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src/main.ts'), 'export function main() { return "hello"; }\n');
  const store = new ProjectStore({ dataDirectory: join(directory, 'data'), run });
  // Drain the worker before removing its source and saved-state fixture.
  context.after(async () => {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const project = await store.add({ path: root, analyze: false });

  return { directory, root, store, project };
}

// Await worker teardown so assertions observe persisted result and debugging files.
async function waitForEndpointsJob(store) {
  const deadline = Date.now() + 8000;
  while (store.running || store.queue.length) {
    if (Date.now() > deadline) throw new Error('Endpoint fixture job timed out.');
    await delay(10);
  }
}

// Rediscover one project-wide inventory while retaining source evidence and saved prompts.
test('endpoints discovery replaces one inventory and refreshes stale evidence',
  async (context) => {
    const run = context.mock.fn(runEndpointsFixture);
    const { directory, root, store, project } = await createEndpointsFixture(context, run);
    assert.deepEqual((await store.view(project.id)).endpointAnalyses, []);
    for (const scope of [null, '', 'src/', 42, {}, 'x'.repeat(4001)])
      await assert.rejects(store.enqueue(project.id, 'endpoints', scope), { status: 400 });

    const initial = await store.enqueue(project.id, 'endpoints');
    await waitForEndpointsJob(store);
    let view = await store.view(project.id);
    assert.equal(view.job.status, 'completed');
    const first = view.endpointAnalyses[0];
    assert.equal(Object.hasOwn(first, 'requestedScope'), false);
    assert.equal(first.servers.length, 2);
    assert.equal(first.servers[0].endpoints.length, 2);
    assert.equal(first.servers[1].endpoints[0].path, first.servers[0].endpoints[0].path);
    assert.equal(first.servers[0].endpoints[0].sources[0].stale, false);
    assert.ok(first.servers[0].endpoints[0].sources[0].hash);
    assert.deepEqual(view.architectures, []);
    assert.deepEqual(view.flows, []);
    assert.deepEqual(view.nounAnalyses, []);
    assert.deepEqual(view.sequences, []);
    const inputs = await store.jobPrompts(project.id, initial.id);
    assert.equal(inputs.prompts.length, 1);
    assert.equal(inputs.prompts[0].stage, 'endpoints');
    assert.match(inputs.prompts[0].content, /including every server in a monorepo/);
    assert.match(inputs.prompts[0].content, /outgoing HTTP clients/);
    assert.match(inputs.prompts[0].schema.content, /servers/);

    await store.enqueue(project.id, 'endpoints');
    await waitForEndpointsJob(store);
    view = await store.view(project.id);
    assert.equal(view.endpointAnalyses.length, 1);
    const second = view.endpointAnalyses[0];
    assert.equal(second.id, first.id);
    assert.equal(view.job.resultId, second.id);
    assert.equal(view.stats.endpointAnalyses, 1);
    assert.equal(run.mock.callCount(), 2);
    assert.match(run.mock.calls[1].arguments[0].prompt, /Inspect the whole project/);
    assert.equal(getAnalysisEntries(view).filter(
      // Include the single inventory in the combined saved-results view.
      (entry) => entry.tab === 'endpoints',
    ).length, 1);
    assert.deepEqual(getJobAnalysisTargets(view), [{
      tab: 'endpoints', selection: '', label: 'Open analysis',
    }]);
    assert.equal(selectedAskContext(view, { view: 'endpoints', selection: second.id }).id,
      second.id);
    assert.throws(
      // Ask must not silently answer about a different saved endpoint inventory.
      () => selectedAskContext(view, { view: 'endpoints', selection: 'missing' }),
      /no longer exists/,
    );
    assert.equal(validateQuestion({
      question: 'Which endpoints register projects?',
      context: { view: 'endpoints', selection: second.id, label: 'Endpoints', excerpt: '' },
    }).context.view, 'endpoints');

    await writeFile(join(root, 'src/main.ts'), 'export function main() { return "changed"; }\n');
    view = await store.view(project.id);
    assert.equal(view.endpointAnalyses[0].review.current, false);
    assert.equal(view.endpointAnalyses[0].servers[0].endpoints[0].sources[0].stale, true);
    await store.changeAnalysis(project.id, 'endpoints', first.id, 'rerun');
    await waitForEndpointsJob(store);
    view = await store.view(project.id);
    assert.equal(view.endpointAnalyses.length, 1);
    assert.equal(view.endpointAnalyses[0].id, first.id);
    assert.equal(view.endpointAnalyses[0].review.current, true);
    assert.equal(view.endpointAnalyses[0].servers[0].endpoints[0].sources[0].stale, false);
    const saved = await readFile(store.path(project.id, 'understanding.json'), 'utf8');
    // Invalid rediscovery must leave the complete saved inventory untouched.
    store.run = async () => ({ ...createEndpointsResult(), servers: [{ id: 'invalid' }] });
    await store.changeAnalysis(project.id, 'endpoints', first.id, 'rerun');
    await waitForEndpointsJob(store);
    assert.equal((await store.get(project.id)).job.status, 'failed');
    assert.equal(await readFile(store.path(project.id, 'understanding.json'), 'utf8'), saved);
    await store.close();
    const reopened = new ProjectStore({ dataDirectory: join(directory, 'data'), run });
    // Close the reopened registry before its temporary directory is removed.
    context.after(() => reopened.close());
    assert.equal((await reopened.view(project.id)).endpointAnalyses.length, 1);
    assert.equal(await readFile(store.path(project.id, 'understanding.json'), 'utf8'), saved);
  });

// Refuse ambiguous inventories and unsupported claims before replacing any saved result.
test('endpoints validation enforces server-owned route identity and source evidence',
  async (context) => {
    const { root } = await createEndpointsFixture(context);
    const index = await indexProject(root, 'API');
    const content = await readFile(join(root, 'src/main.ts'), 'utf8');
    const snapshot = {
      sources: { 'src/main.ts': content }, fingerprints: { 'src/main.ts': fingerprint(content) },
      coverage: { included: 1, total: 1, bytes: content.length },
    };
    const valid = validateAnalysis('endpoints', createEndpointsResult(), index, snapshot);
    assert.ok(valid.servers[0].endpoints[0].sources[0].hash);
    const changes = [
      // Independent servers may share paths, but their identifiers must remain distinct.
      (result) => { result.servers[1].id = result.servers[0].id; },
      // A route's ID is unique even when its method differs from neighboring routes.
      (result) => { result.servers[0].endpoints[1].id = 'get-projects'; },
      // Repeated method/path pairs would falsely inflate the endpoint inventory.
      (result) => { result.servers[0].endpoints[1].method = 'GET'; },
      // Every route needs source evidence, including routes from secondary servers.
      (result) => { result.servers[1].endpoints[0].sources = []; },
      // Server groups need evidence of the actual server implementation.
      (result) => { result.servers[1].sources = []; },
      // Methods must use known uppercase HTTP names or an explicit ANY dispatch.
      (result) => { result.servers[0].endpoints[0].method = 'get'; },
      // Route paths must be server-relative, never outgoing service URLs.
      (result) => { result.servers[0].endpoints[0].path = 'https://example.com/api'; },
      // A file present on disk but absent from the snapshot cannot support a claim.
      (result) => { result.servers[0].sources[0].path = 'missing.ts'; },
      // Citations cannot point beyond the source actually inspected.
      (result) => { result.servers[0].endpoints[0].sources[0].line = 999; },
    ];
    for (const change of changes) {
      const value = createEndpointsResult();
      change(value);
      assert.throws(
        // Reject every malformed result independently without mutating later fixtures.
        () => validateAnalysis('endpoints', value, index, snapshot),
      );
    }
    const empty = {
      ...createEndpointsResult(), servers: [], notes: ['No HTTP servers found.'],
    };
    assert.deepEqual(validateAnalysis('endpoints', empty, index, snapshot).servers, []);
    const prompt = analysisPrompt('endpoints', { name: 'API' }, index, snapshot, 'worker routes');
    assert.doesNotMatch(prompt, /worker routes/);
    assert.match(prompt, /mount prefixes/);
    assert.match(prompt, /static assets/);
  });

// Serve project-wide rediscovery while rejecting modification and duplication.
test('HTTP endpoints APIs rediscover one inventory and reject unsupported actions',
  async (context) => {
    const { store, project } = await createEndpointsFixture(context);
    const app = createApp({ store });
    // Release all fixture HTTP connections when the test finishes.
    context.after(async () => {
      app.closeAllConnections();
      await new Promise(
        // Wait for the listener to stop before removing the fixture.
        (resolve) => app.close(resolve),
      );
    });
    app.listen(0, '127.0.0.1');
    await once(app, 'listening');
    const base = `http://127.0.0.1:${app.address().port}`;
    const route = `/api/projects/${project.id}/endpoints`;
    // Send JSON to the fixture server while preserving explicit header overrides.
    const post = (path, body, headers = {}) => fetch(`${base}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    assert.equal((await fetch(`${base}${route}`)).status, 405);
    assert.equal((await post(route, {}, { Origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await post(route, {}, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await post('/api/projects/missing/endpoints', {})).status, 404);
    for (const scope of [null, '', 'src/', 42, {}, 'x'.repeat(4001)])
      assert.equal((await post(route, { scope })).status, 400);
    assert.equal((await fetch(`${base}/projects/${project.id}/endpoints`)).status, 200);
    assert.equal((await fetch(`${base}/views/endpoints.js`)).status, 200);

    const response = await post(route, {});
    assert.equal(response.status, 202);
    assert.equal((await response.json()).kind, 'endpoints');
    await waitForEndpointsJob(store);
    let view = await store.view(project.id);
    const id = view.endpointAnalyses[0].id;
    const actions = `/api/projects/${project.id}/analyses/endpoints/${id}`;
    assert.equal((await post(`${actions}/rerun`, {})).status, 202);
    await waitForEndpointsJob(store);
    assert.equal((await post(`${actions}/modify`, { prompt: 'Change the routes.' })).status, 400);
    assert.equal((await post(`${actions}/duplicate`, {})).status, 400);
    assert.equal((await post(route, {})).status, 202);
    await waitForEndpointsJob(store);
    view = await store.view(project.id);
    assert.equal(view.endpointAnalyses.length, 1);
    assert.equal(view.endpointAnalyses[0].id, id);
    assert.equal(Object.hasOwn(view.endpointAnalyses[0], 'modificationPrompts'), false);
    assert.equal((await post(`${actions}/delete`, {})).status, 200);
    assert.equal((await store.view(project.id)).endpointAnalyses.length, 0);
  });

// Keep route details readable, escaped, and correctly grouped without executable model markup.
test('endpoints view renders grouped routes, safe details, and honest empty states', () => {
  const analysis = { ...createEndpointsResult(), id: 'saved' };
  analysis.servers[0].name = 'Public <API>';
  analysis.servers[0].endpoints[0].path = '/api/<projects>/:id';
  analysis.servers[0].endpoints[0].description = '<img src=x onerror=alert(1)>';
  const project = { name: 'API <demo>', endpointAnalyses: [analysis] };
  const options = {
    draft: '', actionsBusy: false,
    // Match application URLs using an explicit tab and saved-result ID.
    projectUrl: (tab, id = '') => `/projects/api/${tab}${id ? `/${id}` : ''}`,
  };
  const html = renderEndpointsView(project, analysis, options);
  assert.match(html, /Public &lt;API&gt;/);
  assert.match(html, /Administration API/);
  assert.match(html, /\/api\/&lt;projects&gt;\/:id/);
  assert.doesNotMatch(html, /<img|<projects>|<API>/);
  assert.equal((html.match(/class="endpoint-route"/g) || []).length, 3);
  assert.match(html, /data-source="src\/main.ts"/);
  assert.match(html, /data-analysis-kind="endpoints"/);
  assert.doesNotMatch(html, /data-analysis-action="modify"|data-analysis-action="duplicate"/);
  assert.match(html, /data-analysis-action="rerun"/);
  assert.doesNotMatch(html, /<textarea|endpoints-form|flow-option|<aside/);
  assert.match(html, /Handler/);
  assert.match(html, /Request/);
  assert.match(html, /Response/);
  assert.match(html, /2 servers/);
  assert.match(html, /3 endpoints/);
  const noServers = renderEndpointsView(project, { ...analysis, servers: [] }, options);
  assert.match(noServers, /No HTTP API servers were identified/);
  const noRoutes = structuredClone(analysis);
  noRoutes.servers[0].endpoints = [];
  assert.match(renderEndpointsView(project, noRoutes, options),
    /No REST endpoints were identified/);
  const introduction = renderEndpointsView(project, undefined, options);
  assert.match(introduction, /Find the REST endpoints in API &lt;demo&gt;/);
  assert.match(introduction, /Discover endpoints/);
  assert.match(introduction, /data-action="endpoints"/);
  assert.doesNotMatch(introduction, /<textarea|Scope \(optional\)|endpoints-form/);
  const busy = renderEndpointsView(project, undefined, { ...options, actionsBusy: true });
  assert.match(busy, /data-action="endpoints"[\s\S]*?disabled/);
});

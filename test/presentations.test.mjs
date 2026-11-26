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
import { getAnalysisEntries } from '../public/analysis-list.js';
import { getJobAnalysisTargets } from '../public/job-progress.js';
import { renderPresentationsView, renderPresentationDocument }
  from '../public/views/presentations.js';
import { renderPresentationDiagram } from '../public/ui/presentation-diagram.js';
import { createPresentationResult } from './presentation-fixtures.mjs';

// Isolate source and JSON storage while injecting deterministic presentation generation.
async function createPresentationFixture(context, run = createPresentationResult) {
  const directory = await mkdtemp(join(tmpdir(), 'codescope-presentations-'));
  const root = join(directory, 'project');
  await mkdir(join(root, 'src'), { recursive: true });
  const content = 'export function main() { return "hello"; }\n';
  await writeFile(join(root, 'src/main.ts'), content);
  const store = new ProjectStore({ dataDirectory: join(directory, 'data'), run });
  // Stop writers before removing their temporary source and state files.
  context.after(async () => {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const project = await store.add({ path: root, analyze: false });

  return { directory, root, store, project, content };
}

// Await persisted jobs, bounding the wait so worker regressions fail deterministically.
async function waitForPresentation(store) {
  const deadline = Date.now() + 8000;
  while (store.running || store.queue.length) {
    if (Date.now() > deadline) throw new Error('Presentation fixture timed out.');
    await delay(10);
  }
}

// Save independent decks and preserve their identity, requests, and source evidence through edits.
test('presentations persist JSON, refresh citations, and support saved-result actions',
  async (context) => {
    const run = context.mock.fn(createPresentationResult);
    const { directory, root, store, project } = await createPresentationFixture(context, run);
    assert.deepEqual((await store.view(project.id)).presentations, []);
    for (const topic of [undefined, null, '', '  ', 42, {}, 'x'.repeat(4001)])
      await assert.rejects(store.enqueue(project.id, 'presentation', topic), { status: 400 });
    const job = await store.enqueue(project.id, 'presentation', '  Explain main()  ');
    await waitForPresentation(store);
    let view = await store.view(project.id);
    assert.equal(view.job.status, 'completed');
    const first = view.presentations[0];
    assert.equal(first.formatVersion, 1);
    assert.equal(first.requestedTopic, 'Explain main()');
    assert.equal(first.slides.length, 5);
    assert.equal(view.job.resultId, first.id);
    assert.equal(first.slides[0].sources[0].stale, false);
    assert.ok(first.slides[0].sources[0].hash);
    assert.equal(view.stats.presentations, 1);
    const inputs = await store.jobPrompts(project.id, job.id);
    assert.equal(inputs.prompts[0].stage, 'presentation');
    assert.match(inputs.prompts[0].content, /Explain main\(\)/);
    assert.match(inputs.prompts[0].schema.content, /request-journey/);
    assert.deepEqual(getJobAnalysisTargets(view), [{
      tab: 'presentations', selection: first.id, label: 'Open analysis',
    }]);
    assert.equal(getAnalysisEntries(view)[0].tab, 'presentations');
    assert.equal(selectedAskContext(view, { view: 'presentations', selection: first.id }).id,
      first.id);
    assert.equal(validateQuestion({ question: 'Explain this deck.', context: {
      view: 'presentations', selection: first.id, label: 'Presentation', excerpt: '',
    } }).context.view, 'presentations');

    await store.enqueue(project.id, 'presentation', 'A different topic');
    await waitForPresentation(store);
    view = await store.view(project.id);
    assert.equal(view.presentations.length, 2);
    const second = view.presentations[1];
    assert.notEqual(second.id, first.id);
    await writeFile(join(root, 'src/main.ts'), 'export function main() { return "updated"; }\n');
    view = await store.view(project.id);
    assert.equal(view.presentations[0].review.current, false);
    assert.equal(view.presentations[0].slides[0].sources[0].stale, true);
    await store.changeAnalysis(project.id, 'presentations', first.id, 'modify', 'Focus on main().');
    await waitForPresentation(store);
    view = await store.view(project.id);
    assert.equal(view.presentations[0].id, first.id);
    assert.equal(view.presentations[0].review.current, true);
    assert.deepEqual(view.presentations[0].modificationPrompts, ['Focus on main().']);
    assert.match(run.mock.calls[2].arguments[0].prompt, /Focus on main/);
    await store.changeAnalysis(project.id, 'presentations', first.id, 'rerun');
    await waitForPresentation(store);
    assert.match(run.mock.calls[3].arguments[0].prompt, /Focus on main/);
    assert.match(run.mock.calls[3].arguments[0].prompt, /Explain main/);
    const copy = await store.changeAnalysis(project.id, 'presentations', first.id, 'duplicate');
    assert.notEqual(copy.analysisId, first.id);
    const saved = await readFile(store.path(project.id, 'understanding.json'), 'utf8');
    // Failed generation cannot partially replace a previously valid deck.
    store.run = async () => ({ ...createPresentationResult(), slides: [] });
    await store.changeAnalysis(project.id, 'presentations', first.id, 'rerun');
    await waitForPresentation(store);
    assert.equal((await store.get(project.id)).job.status, 'failed');
    assert.equal(await readFile(store.path(project.id, 'understanding.json'), 'utf8'), saved);
    await store.changeAnalysis(project.id, 'presentations', copy.analysisId, 'delete');
    await store.close();
    const reopened = new ProjectStore({ dataDirectory: join(directory, 'data'), run });
    // Close the reopened registry before fixture teardown removes its directory.
    context.after(() => reopened.close());
    const restored = await reopened.view(project.id);
    assert.deepEqual(restored.presentations.map(
      // Saved deck ordering and independent IDs survive process restart.
      (deck) => deck.id,
    ), [first.id, second.id]);
    assert.equal(restored.architectures.length, 0);
  });

// Reject broken diagram references, dense slides, executable markup fields, and bad citations.
test('presentation validation enforces diagram structure, readable slides, and source evidence',
  async (context) => {
    const { root, content } = await createPresentationFixture(context);
    const index = await indexProject(root, 'Project');
    const snapshot = {
      sources: { 'src/main.ts': content }, fingerprints: { 'src/main.ts': fingerprint(content) },
      coverage: { included: 1, total: 1, bytes: content.length },
    };
    const changes = [
      // A slide ID cannot identify two different slides.
      (deck) => { deck.slides[1].id = deck.slides[0].id; },
      // Future formats must be explicitly migrated rather than misinterpreted.
      (deck) => { deck.formatVersion = 2; },
      // Arbitrary diagram formats cannot bypass the custom SVG renderer.
      (deck) => { deck.slides[1].diagram.type = 'html'; },
      // Diagram slides cannot silently render with missing graphics.
      (deck) => { deck.slides[1].diagram = null; },
      // Other layouts cannot hide a diagram in unexpected content.
      (deck) => { deck.slides[1].layout = 'content'; },
      // Unknown node references would break SVG routing.
      (deck) => { deck.slides[1].diagram.edges[0].to = 'missing'; },
      // Repeated node IDs would make edges ambiguous.
      (deck) => { deck.slides[1].diagram.nodes[1].id = 'client'; },
      // Self connections require an unsupported layout.
      (deck) => { deck.slides[1].diagram.edges[0].to = 'client'; },
      // Too many components in a column would overlap.
      (deck) => { for (const node of deck.slides[1].diagram.nodes) node.layer = 0; },
      // Diagram slides reserve their visual space for the graphic.
      (deck) => { deck.slides[1].bullets = ['one', 'two']; },
      // A title slide uses a title and subtitle only.
      (deck) => { deck.slides[0].bullets = ['extra']; },
      // Every slide needs evidence for its claims.
      (deck) => { deck.slides[1].sources = []; },
      // A citation must exist in the captured source.
      (deck) => { deck.slides[1].sources = [{ path: 'missing.ts', line: 1, symbol: '' }]; },
      // Available files still cannot support invented line numbers.
      (deck) => { deck.slides[1].sources = [{ path: 'src/main.ts', line: 99, symbol: '' }]; },
      // Generated markup is never part of the persisted presentation contract.
      (deck) => { deck.slides[1].html = '<script>evil()</script>'; },
    ];
    for (const change of changes) {
      const deck = createPresentationResult();
      change(deck);
      assert.throws(
        // Validate each malformed result against the same real source snapshot.
        () => validateAnalysis('presentation', deck, index, snapshot),
      );
    }
    assert.equal(validateAnalysis('presentation', createPresentationResult(), index, snapshot)
      .slides[1].sources[0].hash, fingerprint(content));
    const prompt = analysisPrompt('presentation', { name: 'Project' }, index, snapshot,
      'Explain the request pipeline');
    assert.match(prompt, /Explain the request pipeline/);
    assert.match(prompt, /never return HTML, SVG or Mermaid/);
  });

// Check real HTTP creation, direct links, action routes, and portable downloads.
test('presentation HTTP APIs generate decks and export original JSON and standalone HTML',
  async (context) => {
    const { root, store, project } = await createPresentationFixture(context);
    const app = createApp({ store });
    // Release listener connections before removing the project's fixture directory.
    context.after(async () => {
      app.closeAllConnections();
      await new Promise(
        // Wait until no more requests can write fixture data.
        (resolve) => app.close(resolve),
      );
    });
    app.listen(0, '127.0.0.1');
    await once(app, 'listening');
    const base = `http://127.0.0.1:${app.address().port}`;
    const route = `/api/projects/${project.id}/presentations`;
    // Send requests through the actual HTTP dispatcher and body validation.
    const post = (path, body) => fetch(`${base}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal((await fetch(`${base}${route}`)).status, 405);
    assert.equal((await post(route, { topic: ' ' })).status, 400);
    const response = await post(route, { topic: 'Explain main()' });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).kind, 'presentation');
    await waitForPresentation(store);
    const view = await store.view(project.id);
    const deck = view.presentations[0];
    for (const path of [
      `/projects/${project.id}/presentations/${deck.id}`, '/views/presentations.js',
      '/ui/presentation-diagram.js', '/presentation.css',
    ]) assert.equal((await fetch(`${base}${path}`)).status, 200);
    const download = `${base}${route}/${deck.id}/export`;
    const json = await fetch(`${download}?format=json`);
    assert.match(json.headers.get('content-disposition'), /attachment; filename="presentation-/);
    const exported = await json.json();
    assert.equal(exported.formatVersion, 1);
    assert.equal(Object.hasOwn(exported, 'baseline'), false);
    assert.equal(Object.hasOwn(exported, 'coverage'), false);
    assert.equal(Object.hasOwn(exported, 'review'), false);
    await rm(join(root, 'src/main.ts'));
    assert.equal((await store.view(project.id)).presentations[0].slides[0].sources[0].line, null);
    const original = await (await fetch(`${download}?format=json`)).json();
    assert.equal(original.slides[0].sources[0].line, 1);
    const html = await fetch(`${download}?format=html`);
    assert.match(html.headers.get('content-type'), /text\/html/);
    const document = await html.text();
    const palette = await fetch(`${base}/theme.css`);
    assert.equal(palette.status, 200);
    assert.ok(document.includes(await palette.text()));
    assert.match(document, /<html lang="en" data-theme="dark">/);
    assert.match(document, /<style>[\s\S]*deck-slide/);
    assert.equal((document.match(/class="deck-slide deck-layout-/g) || []).length, 5);
    assert.match(document, /href="#slide-2"/);
    assert.match(document, /<svg/);
    assert.doesNotMatch(document, /<script|<link|<iframe|data-source=/);
    const light = await fetch(`${download}?format=html&theme=light`);
    assert.match(await light.text(), /<html lang="en" data-theme="light">/);
    assert.equal((await fetch(`${download}?format=pptx`)).status, 400);
    assert.equal((await fetch(`${base}${route}/missing/export?format=json`)).status, 404);
    assert.equal((await post(`${route}/${deck.id}/export?format=json`, {})).status, 405);
    const actions = `/api/projects/${project.id}/analyses/presentations/${deck.id}`;
    assert.equal((await post(`${actions}/duplicate`, {})).status, 200);
    assert.equal((await post(`${actions}/delete`, {})).status, 200);
    assert.equal((await fetch(`${download}?format=json`)).status, 404);
  });

// Escape generated presentation text while preserving notes and diagram semantics.
test('presentation views escape content and render every custom diagram type', () => {
  const deck = { ...createPresentationResult(), id: 'saved' };
  const attack = '</textarea><img src=x onerror=alert(1)> & `value`';
  deck.title = attack;
  deck.slides[1].title = attack;
  deck.slides[1].diagram.nodes[0].title = attack;
  const project = { id: 'demo', name: '<Demo>', presentations: [deck] };
  const options = {
    actionsBusy: false, slideIndex: 1,
    // Mirror the application's deck navigation URLs.
    projectUrl: (tab, id) => `/projects/demo/${tab}/${id}`,
  };
  const html = renderPresentationsView(project, deck, options);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /data-presentation-action="present"/);
  assert.match(html, /data-presentation-slide="1"[\s\S]*?aria-current="step"/);
  assert.match(html, /data-analysis-kind="presentations"/);
  assert.match(html, /data-source="src\/main.ts"/);
  assert.match(html, /data-new-analysis="presentations"/);
  assert.doesNotMatch(html, /<textarea/);
  const empty = renderPresentationsView(project, null, { ...options, actionsBusy: true });
  assert.match(empty, /Turn your codebase into a story/);
  assert.match(empty, /data-new-analysis="presentations"[^>]*\bdisabled/);
  const document = renderPresentationDocument(deck, project.name, '.deck-slide {}');
  assert.doesNotMatch(document, /<img|<script|<textarea/);
  assert.match(document, /&lt;\/textarea&gt;/);
  assert.match(document, /deck-arrow-1/);
  assert.match(document, /deck-arrow-2/);
  for (const slide of deck.slides.filter(
    // Exercise each custom diagram renderer without a browser or generated scripts.
    (entry) => entry.diagram,
  )) {
    const diagram = renderPresentationDiagram(slide.diagram);
    assert.match(diagram, new RegExp(`data-diagram-type="${slide.diagram.type}"`));
    assert.match(diagram, /<desc>/);
    assert.match(diagram, /Dashed connections are inferred/);
    assert.doesNotMatch(diagram, /<img/);
  }
});

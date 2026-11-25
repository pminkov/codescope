import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../public/content.js';
import { renderAnalysisMenu } from '../public/ui/analysis-controls.js';
import { renderSourceButton, renderSourceDisclosure } from '../public/ui/source-links.js';
import { renderSourcePreview } from '../public/ui/source-preview.js';
import {
  renderDirectoriesView,
  renderDirectoryTree,
  renderDirectorySearchResults,
} from '../public/views/directories.js';
import { renderFlowsView } from '../public/views/flows.js';
import { renderNounsView, renderNounDetails } from '../public/views/nouns.js';
import { renderSequencesView, renderSequenceDetails } from '../public/views/sequences.js';
import { renderArchitectureView, renderNodeDetails } from '../public/views/architecture.js';
import { renderAllAnalysesView } from '../public/views/all-analyses.js';
import { renderJobProgress } from '../public/views/job-progress.js';

const reference = { path: 'src/<entry>.js', line: 2, endLine: 4, symbol: 'main' };

// Provide isolated rendering inputs without browser globals, fetching, or real analysis.
function createViewProject() {
  const child = {
    type: 'directory',
    path: 'src',
    name: 'src',
    title: 'Runtime source',
    kind: 'server',
    description: 'Runs `main()`.',
    children: [],
    fileCount: 0,
  };

  return {
    id: 'demo',
    name: 'Demo <&>',
    description: 'Project **overview**.',
    tree: {
      type: 'directory',
      path: '',
      name: 'demo',
      title: 'Demo',
      kind: 'application',
      description: 'A project.',
      children: [child],
      fileCount: 0,
    },
    flows: [],
    architectures: [],
    nounAnalyses: [],
    sequences: [],
    hasDirectoryAnalysis: false,
    scope: 'Whole project.',
  };
}

// Supply deterministic project routes and view state shared by renderer examples.
function createViewOptions() {
  return {
    draft: '',
    query: '',
    expanded: new Set(['']),
    detailState: new Map(),
    actionsBusy: false,
    // Encode selection segments just as app.js does for project navigation.
    projectUrl: (tab, selection = '') =>
      '/projects/demo/' +
      tab +
      (selection ? '/' + selection.split('/').map(encodeURIComponent).join('/') : ''),
  };
}

// Moving forms must not add indentation or trim drafts when generating their HTML.
test('request forms preserve exact escaped drafts and disable fields only for active jobs', () => {
  const draft = '\n  first line\n</textarea><img src=x onerror=alert(1)> & `value`';
  for (const status of ['completed', 'queued', 'running']) {
    const project = { ...createViewProject(), job: { status } };
    const options = { ...createViewOptions(), draft };
    for (const render of [
      renderFlowsView,
      renderNounsView,
      renderSequencesView,
      renderArchitectureView,
    ]) {
      const html = render(project, undefined, options);
      const field = html.match(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/);
      assert.ok(field);
      assert.equal(field[2], escapeHtml(draft));
      assert.equal(/\bdisabled\b/.test(field[1]), status !== 'completed');
      assert.doesNotMatch(html, /<img/);
    }
  }
});

// Preserve the recent directory design changes and the searchable tree's navigation.
test('directory views retain root labels, nested kinds, filtering, and expansion state', () => {
  const project = createViewProject();
  const options = createViewOptions();
  const root = renderDirectoriesView(project, project.tree, options);
  const child = renderDirectoriesView(project, project.tree.children[0], options);
  assert.doesNotMatch(root, /Repository structure|\bDIRS\b/);
  assert.match(root, /<h2 class="directory-overview-title">Directory overview<\/h2>/);
  assert.match(child.match(/class="eyebrow">([\s\S]*?)<\/div>/)[1], /server/);
  assert.match(child, /<h2>Runtime source<\/h2>/);
  assert.match(root, /Demo &lt;&amp;&gt;/);
  assert.match(root, /href="\/projects\/demo\/directories\/src"/);
  assert.match(root, /src<span class="slash">\/<\/span>/);
  const expanded = new Set();
  const treeOptions = {
    expanded,
    query: 'Runtime',
    projectName: project.name,
    // Provide directory URLs independently of app.js state.
    directoryUrl: (path) => options.projectUrl('directories', path),
  };
  assert.match(renderDirectoryTree(project.tree, 'src', treeOptions), /aria-current="page"/);
  assert.deepEqual([...expanded], []);
  const noMatches = renderDirectoryTree(project.tree, '', { ...treeOptions, query: 'missing' });
  assert.match(renderDirectorySearchResults(noMatches), /No directories match/);
});

// Shared controls must retain source evidence and action availability after extraction.
test('shared controls escape citations, show unavailable references, and gate actions', () => {
  assert.match(renderSourceButton(reference), /data-source="src\/&lt;entry&gt;\.js"/);
  assert.match(renderSourceButton({ ...reference, line: null }), /unresolved/);
  const disclosure = renderSourceDisclosure([reference, reference]);
  assert.equal((disclosure.match(/class="line-reference/g) || []).length, 1);
  assert.match(disclosure, /L2–4/);
  const directoryMenu = renderAnalysisMenu('directories', 'directories', {
    busy: false,
    hasDirectoryAnalysis: false,
  });
  assert.doesNotMatch(directoryMenu, /data-analysis-action="modify"/);
  assert.match(directoryMenu, /data-analysis-action="delete"[\s\S]*?disabled/);
  const flowMenu = renderAnalysisMenu('flows', 'flow', { busy: true });
  assert.equal((flowMenu.match(/\bdisabled\b/g) || []).length, 4);
});

// Preserve continuous step numbering and caller-owned expansion preferences.
test('flow templates keep numbered phases, collapsed steps, and encoded related links', () => {
  const project = createViewProject();
  const step = {
    id: 'first',
    name: 'main()',
    title: 'Begin',
    description: 'Read **source**.',
    source: reference,
    calls: [],
    tables: ['jobs'],
  };
  const flow = {
    id: 'flow',
    title: 'Walkthrough',
    description: 'Description.',
    precondition: 'Start.',
    insight: 'Direct call.',
    outcome: 'Done.',
    branches: [],
    phases: [
      { title: 'First', route: 'start', steps: [step] },
      { title: 'Second', route: 'finish', steps: [{ ...step, id: 'last', relatedFlow: 'a/b c' }] },
    ],
  };
  project.flows = [flow];
  const options = createViewOptions();
  options.detailState.set('flow:first', false);
  const html = renderFlowsView(project, flow, options);
  assert.match(html, /class="step-number">01<\/span>/);
  assert.match(html, /class="step-number">02<\/span>/);
  assert.doesNotMatch(html.match(/<details[^>]*data-detail="flow:first"[^>]*>/)[0], /\bopen\b/);
  assert.match(html, /href="\/projects\/demo\/flows\/a\/b%20c"/);
  assert.deepEqual([...options.detailState], [['flow:first', false]]);
});

// Detail renderers keep safe inline formatting and readable participant endpoints.
test('noun and sequence dialogs render escaped model text and source-linked details', () => {
  const noun = {
    id: 'job',
    name: 'Job',
    description: 'Tracks **work** <script>',
    responsibilities: ['Save `status` & state.'],
    sources: [reference],
  };
  const nounHtml = renderNounDetails(noun);
  assert.match(nounHtml, /<strong>work<\/strong> &lt;script&gt;/);
  assert.match(nounHtml, /Save <code class="inline-code">status<\/code> &amp; state\./);
  const analysis = {
    participants: [
      { id: 'a', name: 'Caller <&>' },
      { id: 'b', name: 'Storage' },
    ],
  };
  const message = {
    from: 'a',
    to: 'b',
    condition: 'Has <work>',
    description: 'Writes `status`.',
    sources: [reference],
  };
  const html = renderSequenceDetails(analysis, message);
  assert.match(html, /Caller &lt;&amp;&gt; → Storage/);
  assert.match(html, /When: Has &lt;work&gt;/);
  assert.match(renderSequenceDetails(analysis, null, noun), /Tracks <strong>work<\/strong>/);
});

// Diagrams keep the identifiers and connection attributes used by app.js event handlers.
test('architecture templates retain graph controls, related components, and empty states', () => {
  const project = createViewProject();
  const graph = {
    id: 'overview',
    title: 'System',
    description: 'Summary.',
    scope: 'All source.',
    notes: [],
    nodes: [
      { id: 'a', title: 'Caller', kind: 'module', description: 'Starts.', tags: [] },
      { id: 'b', title: 'Store', kind: 'module', description: 'Saves.', tags: [] },
    ],
    edges: [{ from: 'a', to: 'b', label: 'Save', description: 'Writes.', inferred: true }],
  };
  project.architectures = [graph];
  const html = renderArchitectureView(project, graph, createViewOptions());
  assert.match(html, /id="graph-node-a"/);
  assert.match(html, /id="graph-edge-0"/);
  assert.match(html, /marker-end="url\(#graph-arrow-inferred\)"/);
  assert.match(renderNodeDetails(graph, graph.nodes[1]), /data-node="a"/);
  assert.match(
    renderArchitectureView(project, { ...graph, nodes: [], edges: [] }, createViewOptions()),
    /No components in this diagram/,
  );
  assert.match(
    renderAllAnalysesView(createViewProject(), createViewOptions().projectUrl),
    /No saved analyses yet/,
  );
});

// Whitespace inside source code must remain exact even though its tags span several lines.
test('source previews preserve indentation and empty lines while escaping source markup', () => {
  const lines = ['  const html = "<div>";', '', '\treturn html;'];
  const html = renderSourcePreview(lines, 2, 3);
  const text = [...html.matchAll(/class="line-text"\s*>([\s\S]*?)<\/span>/g)];
  assert.deepEqual(
    text.map(
      // Read source payloads without trimming the whitespace under test.
      (match) => match[1],
    ),
    ['  const html = &quot;&lt;div&gt;&quot;;', ' ', '\treturn html;'],
  );
  assert.equal((html.match(/source-line highlight/g) || []).length, 2);
  assert.doesNotMatch(html, /<div>/);
});

// Progress markup keeps terminal controls, recorded times, and the newest-message animation.
test('progress cards retain retry, close, cancellation, and message presentation', () => {
  const messages = [
    { message: 'Read <source>', timestamp: '2026-11-19T12:00:09Z' },
    { message: 'Stopped', timestamp: '2026-11-19T12:00:10Z' },
  ];
  const options = {
    busy: false,
    completed: false,
    messages,
    newMessage: true,
    jobTypeLabels: { flow: 'Code flow' },
  };
  const failed = renderJobProgress({ kind: 'flow', status: 'failed' }, options);
  assert.match(failed, /Read &lt;source&gt;/);
  assert.match(failed, /datetime="2026-11-19T12:00:09Z"/);
  assert.match(failed, /datetime="2026-11-19T12:00:10Z"/);
  assert.equal((failed.match(/class="job-message-new"/g) || []).length, 1);
  assert.match(failed, /data-action="retry"/);
  assert.match(failed, /data-action="dismiss-job"/);
  const running = renderJobProgress(
    { kind: 'flow', status: 'running' },
    {
      ...options,
      busy: true,
    },
  );
  assert.match(running, /data-action="cancel"/);
  assert.doesNotMatch(running, /data-action="retry"|data-action="dismiss-job"/);
});

// Progress actions share a dropdown with result navigation during and after a run.
test('progress dropdowns expose escaped result links and state-appropriate controls', () => {
  const options = {
    messages: [], newMessage: false, jobTypeLabels: {},
    resultLinks: [{ href: '/projects/demo/sequences/result?x=1&y=2', label: 'Open <analysis>' }],
  };
  for (const status of ['queued', 'running', 'completed']) {
    const html = renderJobProgress({ kind: 'sequence', status }, {
      ...options, busy: status !== 'completed', completed: status === 'completed',
    });
    const dropdown = html.match(/<details class="job-actions actions-dropdown"[\s\S]*?<\/details>/);
    assert.ok(dropdown);
    assert.match(dropdown[0], /<summary class="button">Actions/);
    assert.match(dropdown[0], /aria-label="Analysis progress actions"/);
    assert.match(dropdown[0], /href="\/projects\/demo\/sequences\/result\?x=1&amp;y=2"/);
    assert.match(dropdown[0], /Open &lt;analysis&gt;/);
    assert.match(dropdown[0], /data-action="view-prompt"/);
    assert.match(dropdown[0], status === 'completed'
      ? /data-action="dismiss-job"/ : /data-action="cancel"/);
    assert.doesNotMatch(html.replace(dropdown[0], ''), /href=|data-action=/);
  }
  for (const status of ['failed', 'cancelled', 'interrupted']) {
    const html = renderJobProgress({ kind: 'sequence', status }, {
      ...options, resultLinks: [], busy: false, completed: false,
    });
    assert.doesNotMatch(html, /href=/);
    assert.match(html, /data-action="retry"/);
    assert.match(html, /data-action="dismiss-job"/);
  }
  const refreshed = renderJobProgress({ kind: 'sequence', status: 'running' }, {
    ...options, busy: true, completed: false, actionsOpen: true,
  });
  assert.match(refreshed, /<details class="job-actions actions-dropdown" open>/);
});

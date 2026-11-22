import { escapeHtml as escape, formatText } from './content.js';
import {
  createJobDismissals, formatJobElapsed, formatJobMessageTime, getJobMessages,
  getJobDismissalDelay,
} from './job-progress.js';
import {
  renderSequenceDiagram, renderSequenceZoomControls, setupSequenceZoom,
} from './sequence-diagram.js';
import { routeGraphEdges } from './graph-routing.js';
import { getAnalysisEntries } from './analysis-list.js';
import { renderCodeScan } from './code-scan.js';
import { setupAsk } from './ask.js';
import { setupDialogStack } from './dialog-stack.js';

// Select a single UI element by its CSS selector.
const selectElement = (selector) => document.querySelector(selector);

const icons = {
  folder:
    '<path d="M3 7V5a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/>',
  flow: '<path d="M9 5h8.5a3.5 3.5 0 0 1 0 7h-11a3.5 3.5 0 0 0 0 7H15"/><circle cx="18" cy="19" r="3"/><circle cx="6" cy="5" r="3"/>',
  sequences: '<path d="m16 3 4 4-4 4M20 7H4m4 14-4-4 4-4M4 17h16"/>',
  nouns: '<rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="13" width="7" height="7" rx="1.5"/><path d="M6 11v6h8M10 7h7v6"/>',
  code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 20"/>',
  scan: '<path d="M4 7V4h3m10 0h3v3m0 10v3h-3M7 20H4v-3M7 8h10M7 12h10M7 16h6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  moon: '<path d="M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8Zm0 0v5h5M8 13h8m-8 4h5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v1"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  architecture:
    '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="2" y="16" width="6" height="5" rx="1"/><rect x="16" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M5 16v-4h14v4"/>',
  browser: '<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M2 8h20M5 5.5h1m2 0h1"/>',
  database:
    '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  external:
    '<path d="M14 3h7v7m0-7L10 14M10 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5"/>',
  rename: '<path d="m16 3 5 5-12 12H4v-5ZM14 5l5 5"/>',
  rerun: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5"/>',
  duplicate: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  delete: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  all: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
};

// Render an accessible decorative SVG from the shared icon set.
const renderIcon = (name, extra = '') =>
  `<svg class="icon ${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.file}</svg>`;

// Populate static icon placeholders when the page loads.
document.querySelectorAll('[data-icon]').forEach((element) => {
  element.innerHTML = renderIcon(element.dataset.icon);
});

let data;
let expanded = new Set(['']);
let query = '';
let sourceRequest = 0;
const detailState = new Map();
let diagramObserver;
let disposeSequenceZoom;
const sequenceZoomPreferences = new Map();
let projects = [];
let pollTimer;
let jobElapsedTimer;
let jobDismissalTimer;
let jobPromptRequest = 0;
let jobPromptFiles = [];
let jobInputKind = 'prompt';
const jobDismissals = createJobDismissals();
let loadSequence = 0;
let directoryPickerRequest;
let deletingNode = false;
let deletingProject = false;
let renamingProject = false;
let analysisActionPending = false;
const flowDrafts = new Map();
const architectureDrafts = new Map();
const nounsDrafts = new Map();
const sequenceDrafts = new Map();
const modificationDrafts = new Map();
const projectTabs = ['directories', 'code-scan', 'architecture', 'flows', 'nouns', 'sequences', 'all'];
const analysisForms = {
  'flow-form': { action: 'flows', field: 'feature', drafts: flowDrafts },
  'architecture-form': { action: 'architecture', field: 'question', drafts: architectureDrafts },
  'sequence-form': { action: 'sequences', field: 'question', drafts: sequenceDrafts },
  'nouns-form': { action: 'nouns', field: 'scope', drafts: nounsDrafts },
};
const jobTypeLabels = {
  initial: 'Directories + architecture',
  directories: 'Directories',
  architecture: 'Architecture',
  flow: 'Code flow',
  nouns: 'Nouns',
  sequence: 'Sequence diagram',
};
const dialogStack = setupDialogStack();

// Describe the actual selected result, including the UI's default selections.
function currentAskContext() {
  if (!data || currentRoute().id !== data.id || deletingProject) return null;
  const { tab, selection } = currentRoute();
  let selected;
  if (tab === 'architecture') selected = getSelectedArchitecture();
  else if (tab === 'nouns') selected = getSelectedNounsAnalysis();
  else if (tab === 'sequences') selected = getSelectedSequence();
  else if (tab === 'flows') selected = data.flows.find(
    // Use the same first-flow fallback as the visible content.
    (flow) => flow.id === selection,
  ) || data.flows[0];
  if (tab === 'directories') selected = flattenTree(data.tree).find(
    // A missing directory is displayed as the project root by the directory view.
    (entry) => entry.type === 'directory' && entry.path === selection,
  ) || data.tree;
  if (tab === 'code-scan') selected = data.codeScan?.directories.find(
    // Code Scan defaults to its first directory containing source files.
    (directory) => directory.path === selection,
  ) || data.codeScan?.directories[0];
  const labels = { directories: 'Directories', 'code-scan': 'Code Scan',
    architecture: 'Architecture', flows: 'Code flows', nouns: 'Nouns',
    sequences: 'Sequences', all: 'All analyses' };
  const detailDialog = dialogStack.latestDialog();
  const detail = detailDialog?.querySelector('h2')?.textContent;
  const title = selected?.title || selected?.path || labels[tab];

  return { projectId: data.id, view: tab, selection: selected?.id ?? selected?.path ?? '',
    label: `${data.name} · ${labels[tab]}${title !== labels[tab] ? ` · ${title}` : ''}${detail ? ` · ${detail}` : ''}`.slice(0, 500) };
}

const ask = setupAsk(currentAskContext, openSource, dialogStack);

// Return every node in the browser's directory tree.
function flattenTree(node) {
  return [node, ...(node.children || []).flatMap(flattenTree)];
}

// Build a project route with safely encoded selection segments.
function projectUrl(tab, selection = '', id = data?.id) {
  return `/projects/${id}/${tab}${selection ? `/${selection.split('/').map(encodeURIComponent).join('/')}` : ''}`;
}

// Build the directory view URL for a source path.
function directoryUrl(path) {
  return projectUrl('directories', path);
}

// Read the selected project, view, and item from the current URL.
function currentRoute() {
  const parts = location.pathname.slice(1).split('/');
  const id = parts[0] === 'projects' ? parts.splice(0, 2)[1] : null;
  const [tab, ...selection] = parts;
  let path = '';

  try {
    path = decodeURIComponent(selection.join('/'));
  } catch {
    /* Invalid selections fall back to the root. */
  }

  return {
    id,
    tab: projectTabs.includes(tab) ? tab : 'directories',
    selection: path,
  };
}

// Load current source state whenever navigation opens an analysis or directory.
async function navigate(url, replace = false) {
  if (replace) history.replaceState(null, '', url);
  else if (url !== location.pathname) history.pushState(null, '', url);
  await loadCurrentProject();
}

// Apply the chosen theme and remember the browser preference.
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  selectElement('#theme-toggle').innerHTML = renderIcon(theme === 'dark' ? 'sun' : 'moon');
  selectElement('#theme-toggle').setAttribute(
    'aria-label',
    `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`,
  );

  try {
    localStorage.setItem('codescope-theme', theme);
  } catch {
    /* A blocked store should not block the app. */
  }
}

let savedTheme;
try {
  savedTheme = localStorage.getItem('codescope-theme');
} catch {
  /* Use the default theme. */
}
setTheme(savedTheme === 'light' ? 'light' : 'dark');
// Switch between the light and dark themes.
selectElement('#theme-toggle').addEventListener('click', () =>
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'),
);

// Match a directory or any descendant against the search query.
function treeMatches(node) {
  return (
    `${node.name} ${node.title} ${node.description} ${node.path}`
      .toLowerCase()
      .includes(query.toLowerCase()) ||
    node.children?.some(
      // Keep parent directories visible when a nested directory matches.
      (child) => child.type === 'directory' && treeMatches(child),
    )
  );
}

// Render a directory tree row and its expanded children.
function renderTree(node, selected, depth = 0) {
  if (!treeMatches(node)) return '';
  const children = node.children.filter(
    // Select only directory children for tree navigation.
    (child) => child.type === 'directory',
  );
  const isOpen = expanded.has(node.path) || Boolean(query);
  const label = node.path ? node.name : data.name;

  return `<li class="tree-item level-${Math.min(depth, 3)}"><div class="tree-row ${selected === node.path ? 'selected' : ''}">
    ${children.length ? `<button class="tree-toggle ${isOpen ? 'open' : ''}" data-expand="${escape(node.path)}" aria-expanded="${isOpen}" aria-label="${isOpen ? 'Collapse' : 'Expand'} ${escape(label)}">${renderIcon('chevron')}</button>` : '<span class="tree-spacer"></span>'}
    <a href="${directoryUrl(node.path)}" ${selected === node.path ? 'aria-current="page"' : ''}>${renderIcon('folder')}<span>${escape(label)}${node.path ? '<span class="slash">/</span>' : ''}</span><small>${node.fileCount}</small></a></div>
    ${
      isOpen && children.length
        ? `<ul>${children
            .map(
              // Render each visible child with its selection and nesting depth.
              (child) => renderTree(child, selected, depth + 1),
            )
            .join('')}</ul>`
        : ''
    }</li>`;
}

// Render a source preview link or an unresolved reference label.
function renderSourceButton(reference, label, className = '') {
  if (!reference) return '';
  if (Object.hasOwn(reference, 'line') && !reference.line)
    return `<span class="source-unavailable" title="This reference could not be resolved in the current source">${escape(label || reference.path)} · unresolved</span>`;

  return `<button class="source-link ${reference.stale ? 'stale-source' : ''} ${className}" data-source="${escape(reference.path)}" data-line="${reference.line || 1}" data-symbol="${escape(reference.symbol || '')}" title="${reference.stale ? 'Source changed since analysis; preview shows current code' : 'Open source preview'}">${renderIcon('code')}<span>${escape(label || `${reference.path}:${reference.line || 1}`)}</span>${renderIcon('arrow')}</button>`;
}

// Group deduplicated source citations into a collapsible disclosure.
function renderSourceDisclosure(sources = [], exclude = []) {
  const groups = new Map();

  for (const source of sources) {
    if (
      exclude.some(
        // Omit references that already have a visible source button.
        (reference) => reference.path === source.path && reference.line === source.line,
      )
    )
      continue;
    if (!groups.has(source.path)) groups.set(source.path, []);
    const group = groups.get(source.path);
    if (
      !group.some(
        // Detect a line range already present in the file group.
        (entry) => entry.line === source.line && entry.endLine === source.endLine,
      )
    )
      group.push(source);
  }

  if (!groups.size) return '';

  return `<details class="source-disclosure"><summary>${renderIcon('chevron')}Sources <span>${groups.size} ${groups.size === 1 ? 'file' : 'files'}</span></summary><ul>${[
    ...groups,
  ]
    .map(
      // Render each file's grouped source references.
      ([path, references]) => renderSourceGroup(path, references),
    )
    .join('')}</ul></details>`;
}

// Render the source line controls belonging to one file.
function renderSourceGroup(path, references) {
  return `<li><span class="source-file-name">${escape(path)}</span><div class="source-line-links">${references
    .map(
      // Render a resolved line link or an unavailable reference marker.
      (reference) =>
        reference.line
          ? `<button type="button" class="line-reference ${reference.stale ? 'stale-source' : ''}" data-source="${escape(path)}" data-line="${reference.line}" aria-label="Open ${escape(path)} at line ${reference.line}" title="${reference.stale ? 'Source changed since analysis; opens current code' : 'View source'}">L${reference.line}${reference.endLine ? `–${reference.endLine}` : ''}</button>`
          : '<span class="source-unavailable">Unavailable</span>',
    )
    .join('')}</div></li>`;
}

// Show the selected analysis's date and an expandable count of changed files.
function renderAnalysisFreshness(review) {
  if (!review?.available)
    return '<p class="analysis-freshness">Source comparison unavailable for this analysis.</p>';
  const count = new Set([...review.changedFiles, ...review.newFiles]).size;
  const date = review.reviewedAt
    ? `<time datetime="${escape(review.reviewedAt)}">Analyzed ${escape(new Date(review.reviewedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))}</time>`
    : '';
  const incomplete = review.unknownFiles?.length
    ? '<span class="analysis-incomplete">Comparison incomplete: some file hashes are unavailable.</span>'
    : '';

  return `<div class="analysis-freshness">${date}${count
    ? `<button type="button" class="analysis-changes" data-analysis-changes aria-haspopup="dialog">${renderIcon('clock')}<span>${count} ${count === 1 ? 'file' : 'files'} changed since this analysis</span>${renderIcon('chevron')}</button>`
    : incomplete ? ''
      : '<span class="analysis-current">No files changed since this analysis</span>'}${incomplete}</div>`;
}

// Find the source comparison belonging to the analysis currently on screen.
function getSelectedAnalysisReview() {
  const { tab, selection } = currentRoute();
  if (tab === 'architecture') return getSelectedArchitecture();
  if (['flows', 'nouns', 'sequences'].includes(tab)) {
    const analyses = (tab === 'flows' ? data.flows
      : tab === 'sequences' ? data.sequences : data.nounAnalyses) || [];
    return analyses.find(
      // Match the same saved result used by the content view.
      (analysis) => analysis.id === selection,
    ) || analyses[0];
  }

  return { title: 'Directory analysis', review: data.directoryReview };
}

// Open the full filename list for the selected analysis without changing its results.
function openAnalysisChanges() {
  const analysis = getSelectedAnalysisReview();
  const review = analysis?.review;
  if (!review?.available) return;
  const changeTypes = {
    added: 'Added',
    modified: 'Modified',
    removed: 'Removed',
    unreadable: 'Could not read',
    changed: 'Changed',
  };
  const paths = [...new Set([...review.changedFiles, ...review.newFiles])].sort();
  const dialog = selectElement('#analysis-changes-dialog');
  selectElement('#analysis-changes-name').textContent = analysis.title;
  selectElement('#analysis-changes-title').textContent =
    `${paths.length} ${paths.length === 1 ? 'file' : 'files'} changed since this analysis`;
  selectElement('#analysis-changes-list').innerHTML = paths.map(
    // Keep badge styles limited to the known comparison reasons.
    (path) => {
      const reason = review.fileChanges?.[path];
      const status = Object.hasOwn(changeTypes, reason) ? reason : 'changed';
      const label = changeTypes[status];

      return `<li><code>${escape(path)}</code><span class="file-change-badge" data-change="${status}">${label}</span></li>`;
    },
  ).join('');
  dialog.dataset.route = location.pathname;
  if (!dialog.open) dialog.showModal();
}

// Render a subdirectory card with its description and file count.
function renderDirectoryCard(child) {
  return `<a class="folder-card" href="${directoryUrl(child.path)}"><div class="folder-card-top">${renderIcon('folder')}<strong>${escape(child.name)}<span class="slash">/</span></strong><span class="kind">${escape(child.kind)}</span>${renderIcon('arrow')}</div><p>${formatText(child.description)}</p><span class="file-count">${child.fileCount} ${child.fileCount === 1 ? 'file' : 'files'}</span></a>`;
}

// Render an indexed file row with evidence and source preview controls.
function renderFileRow(file) {
  return `<div class="file-row"><span class="file-icon">${renderIcon('file')}</span><div><strong>${file.readable ? `<button class="file-button" data-source="${escape(file.path)}">${escape(file.name)}</button>` : escape(file.name)}</strong><p>${formatText(file.description)}</p>${renderSourceDisclosure(file.sources)}</div><span class="file-type">${escape(file.name.split('.').at(-1))}</span>${file.readable ? `<button class="icon-button file-open" data-source="${escape(file.path)}" aria-label="Preview ${escape(file.name)}">${renderIcon('arrow')}</button>` : '<span class="binary-label">No preview</span>'}</div>`;
}

// Render a saved flow's navigation entry and selection state.
function renderFlowOption(flow, index, selected) {
  return `<a class="flow-option ${flow.id === selected.id ? 'active' : ''}" href="${projectUrl('flows', flow.id)}" ${flow.id === selected.id ? 'aria-current="page"' : ''}><span class="flow-option-number">0${index + 1}</span><div><strong>${escape(flow.title)}</strong><p>${formatText(flow.subtitle)}</p><span>${escape(flow.tag || 'Source-linked walkthrough')}</span></div>${renderIcon('arrow')}</a>`;
}

// Render an alternate flow branch with its source evidence.
function renderFlowBranch(branch) {
  return `<div class="branch"><span class="branch-marker">↳</span><div><h4>${escape(branch.title)}</h4><p>${formatText(branch.text)}</p>${renderSourceDisclosure(branch.sources)}</div></div>`;
}

// Render a saved architecture view's navigation entry.
function renderArchitectureOption(graph, index, selected) {
  return `<a class="flow-option ${graph.id === selected?.id ? 'active' : ''}" href="${projectUrl('architecture', graph.id)}" ${graph.id === selected?.id ? 'aria-current="page"' : ''}><span class="flow-option-number">${String(index + 1).padStart(2, '0')}</span><div><strong>${escape(graph.title)}</strong><p>${escape(graph.requestedQuestion || 'Overall system architecture')}</p></div>${renderIcon('arrow')}</a>`;
}

// Render a compact architecture component card.
function renderGraphNode(node) {
  return `<button type="button" class="system-node graph-node" id="graph-node-${node.id}" data-node="${escape(node.id)}" aria-label="View details for ${escape(node.title)}" aria-haspopup="dialog"><span class="graph-node-top"><span class="system-node-icon" aria-hidden="true">${renderIcon(node.icon || 'code')}</span><span class="graph-node-kind">${escape(node.kind)}</span></span><span class="graph-node-title">${escape(node.title)}</span></button>`;
}

// Render one menu for the selected saved result, omitting copies for directories.
function renderAnalysisMenu(kind, id) {
  const busy = analysisActionPending || ['queued', 'running'].includes(data.job?.status);
  const missing = kind === 'directories' && !data.hasDirectoryAnalysis;
  const attributes = `data-analysis-kind="${kind}" data-analysis-id="${escape(id)}"`;
  const disabled = busy ? 'disabled' : '';

  return `<details class="analysis-actions actions-dropdown"><summary class="button">Actions ${renderIcon('down')}</summary><div class="actions-menu" role="group" aria-label="Analysis actions">${busy ? '<p class="analysis-actions-status">Wait for the current operation to finish.</p>' : ''}<button type="button" data-analysis-action="rerun" aria-label="Rerun analysis" ${attributes} ${disabled}>${renderIcon('rerun')}<span><strong>Rerun</strong><small>Analyze the current source</small></span></button>${kind !== 'directories' ? `<button type="button" data-analysis-action="modify" aria-label="Modify analysis" aria-haspopup="dialog" aria-controls="modify-analysis-dialog" ${attributes} ${disabled}>${renderIcon('rename')}<span><strong>Modify</strong><small>Describe changes to this result</small></span></button><button type="button" data-analysis-action="duplicate" aria-label="Duplicate analysis" ${attributes} ${disabled}>${renderIcon('duplicate')}<span><strong>Duplicate</strong><small>Create a saved copy</small></span></button>` : ''}<div class="actions-divider"></div><button type="button" class="action-delete" data-analysis-action="delete" aria-label="Delete analysis" ${attributes} ${busy || missing ? 'disabled' : ''}>${renderIcon('delete')}<span><strong>Delete</strong><small>Remove this saved analysis</small></span></button></div></details>`;
}

// Explain the directory analysis status and how to refresh it.
function renderDirectoryAnalysisControls() {
  return `<div class="directory-analysis-controls"><div>${renderAnalysisFreshness(data.directoryReview)}${data.hasDirectoryAnalysis ? '' : '<p>No saved directory explanations. Choose Actions → Rerun to analyze the directories.</p>'}</div></div>`;
}

// Compose a directory's summary, evidence, folders, and file inventory.
function renderDirectoryContent(node) {
  const folders = node.children.filter(
    // Select the current directory's subdirectories for their cards.
    (child) => child.type === 'directory',
  );
  const files = node.children.filter(
    // Select the files directly inside the current directory.
    (child) => child.type === 'file',
  );

  return `<div class="content-heading"><div><div class="eyebrow">DIRECTORY OVERVIEW <span>/</span> ${escape(node.kind)}</div><h2>${escape(node.title)}</h2><p class="lead">${formatText(node.description)}</p></div>${renderAnalysisMenu('directories', 'directories')}</div>
    ${renderDirectoryAnalysisControls()}
    <div class="directory-summary"><p>${formatText(node.detail || node.description)}</p><div class="directory-stats"><div><strong>${node.fileCount}</strong><span>${node.fileCount === 1 ? 'file' : 'files'} inside</span></div><div><strong>${folders.length}</strong><span>subdirectories</span></div><div><strong>${files.length}</strong><span>direct ${files.length === 1 ? 'file' : 'files'}</span></div></div></div>
    ${
      node.highlights?.length
        ? `<div class="notes-list">${node.highlights
            .map(
              // Render an analyzed directory highlight.
              (note) => `<div>${renderIcon('check')}<span>${formatText(note)}</span></div>`,
            )
            .join('')}</div>`
        : ''
    }
    ${renderSourceDisclosure(node.sources)}
    ${node.entry ? `<div class="entrypoint"><span>${renderIcon('arrow')} START READING</span>${renderSourceButton({ path: node.entry }, node.entry)}</div>` : ''}
    ${folders.length ? `<section class="subdirectories"><div class="section-label"><h3>Subdirectories</h3><span>${folders.length} directories</span></div><div class="folder-cards">${folders.map(renderDirectoryCard).join('')}</div></section>` : ''}
    <section class="files-section"><div class="section-label"><h3>Files in this directory</h3><span>${files.length} ${files.length === 1 ? 'file' : 'files'}</span></div>${files.length ? `<div class="file-list">${files.map(renderFileRow).join('')}</div>` : '<div class="empty-small">This directory contains subdirectories only.</div>'}</section>
    ${data.flows.length ? `<a class="related-link" href="${projectUrl('flows', data.flows[0]?.id)}"><span class="related-icon">${renderIcon('flow')}</span><div><strong>See how these pieces work together</strong><p>${escape(data.flows[0]?.title)}</p></div>${renderIcon('arrow')}</a>` : ''}`;
}

// Render the selected directory alongside its searchable navigation tree.
function renderDirectories() {
  const nodes = flattenTree(data.tree);
  const selection = currentRoute().selection;
  const node =
    nodes.find(
      // Find the requested directory or fall back to the project root.
      (entry) => entry.type === 'directory' && entry.path === selection,
    ) || data.tree;
  // Reveal ancestors when navigating directly to a nested directory.
  const segments = node.path.split('/');

  for (let index = 0; index < segments.length; index++)
    expanded.add(segments.slice(0, index).join('/'));

  selectElement('#view').innerHTML =
    `<div class="workspace directory-workspace"><aside class="sidebar" aria-label="Directory navigation"><div class="sidebar-heading"><h2>Repository structure</h2><span class="tiny-label">${data.stats.directories} DIRS</span></div><label class="search-field">${renderIcon('search')}<input id="directory-search" type="search" placeholder="Find a directory…" aria-label="Find a directory" value="${escape(query)}"><kbd>/</kbd></label><div id="tree-container"><ul class="tree">${renderTree(data.tree, node.path)}</ul></div></aside><article class="directory-content">${renderDirectoryContent(node)}</article></div>`;
  // Refresh only the directory tree when the search query changes.
  selectElement('#directory-search').addEventListener('input', (event) => {
    query = event.target.value;
    const tree = renderTree(data.tree, node.path);
    selectElement('#tree-container').innerHTML = tree
      ? `<ul class="tree">${tree}</ul>`
      : '<p class="no-results">No directories match. Try another name or description.</p>';
  });
}

// Render one flow step with evidence, supporting calls, and saved expansion state.
function renderFlowStep(flow, step, number) {
  const key = `${flow.id}:${step.id}`;
  const open = detailState.get(key) !== false;

  return `<li class="timeline-item ${step.depth ? `depth-${step.depth}` : ''} ${step.external ? 'external-step' : ''}"><span class="step-number">${String(number).padStart(2, '0')}</span><details class="step-card" data-detail="${escape(key)}" ${open ? 'open' : ''}><summary><div class="step-title"><span class="function-name">${escape(step.name)}</span>${step.effect ? `<span class="effect ${step.external ? 'external' : ''}">${escape(step.effect)}</span>` : ''}<h4>${escape(step.title)}</h4></div>${renderIcon('chevron', 'step-chevron')}</summary><div class="step-body"><p>${formatText(step.description)}</p>${step.source ? renderSourceButton(step.source) : '<span class="external-reference">Outside this repository</span>'}${renderSourceDisclosure(step.sources, [step.source, ...(step.calls || [])].filter(Boolean))}${
    step.calls?.length
      ? `<div class="supporting-calls"><span>SUPPORTING CALLS</span><div>${step.calls
          .map(
            // Render supporting call links using their symbols when available.
            (reference) =>
              renderSourceButton(
                reference,
                reference.symbol
                  ? `${reference.symbol}()`
                  : `${reference.path}:${reference.line || '?'}`,
              ),
          )
          .join('')}</div></div>`
      : ''
  }${
    step.tables
      ? `<div class="tables"><span>TABLES</span>${step.tables
          .map(
            // Render a table name associated with the flow step.
            (table) => `<code>${escape(table)}</code>`,
          )
          .join('')}</div>`
      : ''
  }${step.relatedFlow ? `<a class="inline-flow-link" href="${projectUrl('flows', step.relatedFlow)}">Open the related flow →</a>` : ''}</div></details></li>`;
}

// Render the selected flow and preserve its step expansion controls.
function renderFlows() {
  if (!data.flows.length) {
    selectElement('#view').innerHTML =
      `<article class="empty-analysis"><span class="eyebrow">CODE FLOWS</span><h2>Follow a feature through the code</h2><p>Describe a user action, request, or process to trace. CodeScope will inspect this project and create a source-linked walkthrough.</p>${renderFlowComposer()}</article>`;
    return;
  }

  const selected =
    data.flows.find(
      // Find the requested flow or fall back to the first saved flow.
      (flow) => flow.id === currentRoute().selection,
    ) || data.flows[0];
  let number = 0;
  const steps = selected.phases.flatMap(
    // Collect steps across all phases for counts and expansion state.
    (phase) => phase.steps,
  );
  const sourceFiles = new Set(
    steps
      .flatMap(
        // Collect the primary and supporting citations for each step.
        (step) => [step.source, ...(step.calls || [])],
      )
      .filter(Boolean)
      .map(
        // Collect cited paths for the unique source file count.
        (reference) => reference.path,
      ),
  );
  const allOpen = steps.every(
    // Check whether every step is currently expanded.
    (step) => detailState.get(`${selected.id}:${step.id}`) !== false,
  );
  selectElement('#view').innerHTML =
    `<div class="workspace flow-workspace"><aside class="sidebar flow-sidebar" aria-label="Code flow navigation"><div class="sidebar-heading"><h2>Code flows</h2><span class="tiny-label">${data.flows.length} FLOWS</span></div><p class="sidebar-description">From a user action to the code that makes it happen.</p>${renderFlowComposer()}<div class="flow-options">${data.flows
      .map(
        // Render each flow navigation entry using the current selection.
        (flow, index) => renderFlowOption(flow, index, selected),
      )
      .join(
        '',
      )}</div><div class="sidebar-bottom"><span class="eyebrow">FLOW SCOPE</span><p>${formatText(data.scope)}</p><div class="scope-tag"><i></i>${escape(data.name)}</div></div></aside><article class="flow-content"><div class="content-heading"><div><div class="eyebrow">CODE FLOW <span>/</span> 0${data.flows.indexOf(selected) + 1}</div><h2>${escape(selected.title)}</h2><p class="lead">${formatText(selected.description)}</p></div>${renderAnalysisMenu('flows', selected.id)}</div>${renderAnalysisFreshness(selected.review)}<div class="flow-stats"><span><strong>${steps.length}</strong> steps</span><span><strong>${sourceFiles.size}</strong> source files</span><span><strong>${selected.phases.length}</strong> ${selected.phases.length === 1 ? 'request' : 'request phases'}</span></div><div class="precondition"><span>STARTS WITH</span><p>${formatText(selected.precondition)}</p></div><div class="insight">${renderIcon('info')}<p>${formatText(selected.insight)}</p></div>${renderSourceDisclosure(selected.sources)}<div class="section-label execution-label"><h3>Execution walkthrough</h3><button id="toggle-details" class="text-button">${allOpen ? 'Collapse' : 'Expand'} details</button></div><div class="execution">${selected.phases
      .map(
        // Render a phase and its globally numbered execution steps.
        (phase, index) =>
          `${phase.transition ? `<div class="phase-transition"><span>↓</span>${escape(phase.transition)}</div>` : ''}<section class="phase"><div class="phase-header"><span class="phase-index">${String(index + 1).padStart(2, '0')}</span><h3>${escape(phase.title)}</h3><code>${escape(phase.route)}</code></div>${renderSourceDisclosure(phase.sources)}<ol class="timeline">${phase.steps
            .map(
              // Render each phase step while advancing the flow-wide number.
              (step) => renderFlowStep(selected, step, ++number),
            )
            .join('')}</ol></section>`,
      )
      .join(
        '',
      )}</div><div class="outcome">${renderIcon('check')}<div><span class="eyebrow">RESULT</span><p>${formatText(selected.outcome)}</p></div></div><section class="branches"><div class="section-label"><h3>Other paths to know</h3><span>${selected.branches.length} branches</span></div><div class="branch-grid">${selected.branches.map(renderFlowBranch).join('')}</div></section><div class="trace-note">${renderIcon('info')}<p>A source-reviewed walkthrough of the main calls. Indented steps run inside the preceding caller; supporting calls show helpers. Request phases are separated by browser actions and redirects.</p></div></article></div>`;
  // Expand or collapse all steps based on their current state.
  selectElement('#toggle-details').addEventListener('click', () => {
    const currentlyOpen = [...document.querySelectorAll('[data-detail]')].every(
      // Check the visible step controls before toggling them together.
      (detail) => detail.open,
    );

    for (const step of steps) detailState.set(`${selected.id}:${step.id}`, !currentlyOpen);

    renderFlows();
  });
  // Register expansion tracking for each rendered step.
  document.querySelectorAll('[data-detail]').forEach((element) =>
    element.addEventListener(
      'toggle',
      // Remember a step's open state and update the group toggle label.
      () => {
        if (!element.isConnected) return;
        detailState.set(element.dataset.detail, element.open);
        const open = [...document.querySelectorAll('[data-detail]')].every(
          // Check whether all remaining step disclosures are open.
          (detail) => detail.open,
        );
        const toggle = selectElement('#toggle-details');
        if (toggle) toggle.textContent = `${open ? 'Collapse' : 'Expand'} details`;
      },
    ),
  );
}

// Prefer an explicit draft, including an empty one, over the generated suggestion.
function getAnalysisRequest(kind, drafts) {
  if (drafts.has(data.id)) return drafts.get(data.id);
  const suggestion = data.nextPrompts?.[kind];

  return typeof suggestion === 'string' ? suggestion : '';
}

// Render the flow question form with its draft or next suggestion and busy state.
function renderFlowComposer() {
  const busy = ['queued', 'running'].includes(data.job?.status);
  return `<form id="flow-form" class="flow-composer"><label for="flow-feature">Add a code flow</label><textarea id="flow-feature" required maxlength="4000" rows="3" placeholder="What happens when a user signs in?" ${busy ? 'disabled' : ''}>${escape(getAnalysisRequest('flows', flowDrafts))}</textarea><button class="button" type="submit" ${busy ? 'disabled' : ''}>Trace flow</button><p class="flow-error" role="alert"></p></form>`;
}

// Render a saved nouns analysis in the scope navigation.
function renderNounsOption(analysis, index, selected) {
  return `<a class="flow-option ${analysis.id === selected?.id ? 'active' : ''}" href="${projectUrl('nouns', analysis.id)}" ${analysis.id === selected?.id ? 'aria-current="page"' : ''}><span class="flow-option-number">${String(index + 1).padStart(2, '0')}</span><div><strong>${escape(analysis.title)}</strong><p>${escape(analysis.requestedScope || 'Entire project')}</p></div>${renderIcon('arrow')}</a>`;
}

// Keep the concept inventory compact while making its full details discoverable.
function renderNounCard(noun) {
  return `<section class="noun-card"><div class="noun-card-heading"><h3>${escape(noun.name)}</h3><button type="button" class="noun-details-button" data-noun="${escape(noun.id)}" aria-label="View details for ${escape(noun.name)}" aria-haspopup="dialog" aria-controls="noun-details-dialog">Details</button></div><p>${formatText(noun.description)}</p></section>`;
}

// Resolve the active nouns analysis consistently for cards and their detail dialog.
function getSelectedNounsAnalysis() {
  const analyses = data?.nounAnalyses || [];

  return analyses.find(
    // Saved URLs select an analysis before falling back to the first available result.
    (analysis) => analysis.id === currentRoute().selection,
  ) || analyses[0];
}

// Show the complete concept card, including responsibilities and source evidence.
function openNounDetails(id) {
  if (currentRoute().tab !== 'nouns') return;
  const analysis = getSelectedNounsAnalysis();
  const noun = analysis?.nouns.find(
    // Resolve IDs only inside the analysis currently visible in the inventory.
    (entry) => entry.id === id,
  );
  if (!noun) return;
  const dialog = selectElement('#noun-details-dialog');
  dialog.dataset.route = location.pathname;
  dialog.dataset.analysis = analysis.id;
  dialog.dataset.nounId = noun.id;
  selectElement('#noun-details-title').textContent = noun.name;
  selectElement('#noun-details-body').innerHTML =
    `<p class="node-description">${formatText(noun.description)}</p>${noun.responsibilities.length ? `<section class="noun-responsibilities"><h3>Responsibilities</h3><ul>${noun.responsibilities.map(
      // Preserve each responsibility and its existing safe inline formatting.
      (responsibility) => `<li>${formatText(responsibility)}</li>`,
    ).join('')}</ul></section>` : ''}${renderSourceDisclosure(noun.sources)}`;
  // Show the complete evidence immediately, retaining the shared source-preview controls.
  dialog.querySelectorAll('.source-disclosure').forEach((disclosure) => {
    disclosure.open = true;
  });
  selectElement('#noun-details-body').scrollTop = 0;
  if (!dialog.open) dialog.showModal();
}

// Render relationships using the noun names rather than internal identifiers.
function renderNounRelationships(analysis) {
  if (!analysis.relationships.length) return '';
  const names = new Map(analysis.nouns.map(
    // Index the display name of every noun referenced by a relationship.
    (noun) => [noun.id, noun.name],
  ));
  return `<section class="noun-relationships"><h3>Relationships</h3><div class="noun-table-scroll"><table><thead><tr><th scope="col">From</th><th scope="col">To</th><th scope="col">Relationship</th></tr></thead><tbody>${analysis.relationships.map(
    // Keep relationship explanations and their evidence in the same row.
    (relationship) => `<tr><th scope="row">${escape(names.get(relationship.from))}</th><td>${escape(names.get(relationship.to))}</td><td>${formatText(relationship.description)}${renderSourceDisclosure(relationship.sources)}</td></tr>`,
  ).join('')}</tbody></table></div></section>`;
}

// Compose the scoped nouns form, saved analyses, and selected concept inventory.
function renderNouns() {
  const analyses = data.nounAnalyses || [];
  const selected = getSelectedNounsAnalysis();
  const busy = ['queued', 'running'].includes(data.job?.status);
  const navigation = `<aside class="sidebar nouns-sidebar" aria-label="Nouns analysis navigation"><div class="sidebar-heading"><h2>Nouns analyses</h2><span class="tiny-label">${analyses.length} SAVED</span></div><p class="sidebar-description">Main concepts, their responsibilities, and relationships.</p><form id="nouns-form" class="flow-composer"><label for="nouns-scope">Scope (optional)</label><textarea id="nouns-scope" maxlength="4000" rows="4" placeholder="For example: job processing in src/storage.mjs" ${busy ? 'disabled' : ''}>${escape(getAnalysisRequest('nouns', nounsDrafts))}</textarea><p class="composer-hint">Leave blank for the whole project. Each run saves a separate analysis.</p><button class="button" type="submit" ${busy ? 'disabled' : ''}>Analyze nouns</button><p class="flow-error" role="alert"></p></form><div class="flow-options">${analyses.map(
    // Keep each requested scope available as a separate navigation entry.
    (analysis, index) => renderNounsOption(analysis, index, selected),
  ).join('')}</div></aside>`;
  const content = selected
    ? `<div class="content-heading"><div><span class="eyebrow">NOUNS</span><h2>${escape(selected.title)}</h2><p class="lead">${formatText(selected.description)}</p>${renderSourceDisclosure(selected.sources)}</div>${renderAnalysisMenu('nouns', selected.id)}</div>${renderAnalysisFreshness(selected.review)}<div class="nouns-scope"><span class="eyebrow">SCOPE</span><p>${formatText(selected.scope)}</p>${selected.requestedScope ? `<p class="nouns-request">Requested: ${escape(selected.requestedScope)}</p>` : ''}</div><div class="noun-grid">${selected.nouns.map(renderNounCard).join('')}</div>${!selected.nouns.length ? '<p class="lead">No nouns were identified in this scope.</p>' : ''}${renderNounRelationships(selected)}${selected.notes.length ? `<section class="noun-notes"><h3>Notes</h3><ul>${selected.notes.map(
      // Surface limitations and missing implementation described by the analysis.
      (note) => `<li>${formatText(note)}</li>`,
    ).join('')}</ul></section>` : ''}`
    : `<span class="eyebrow">NOUNS</span><h2>Identify the concepts in ${escape(data.name)}</h2><p class="lead">Analyze the whole project or describe a folder, subsystem, or feature to focus on. Results explain what each concept means and link to its implementation.</p>${busy ? '<p class="lead">Analysis is in progress. Saved results will appear here when ready.</p>' : ''}`;
  selectElement('#view').innerHTML = `<div class="workspace nouns-workspace">${navigation}<article class="nouns-content">${content}</article></div>`;
}

// Render saved sequence navigation with the original interaction request.
function renderSequenceOption(analysis, index, selected) {
  return `<a class="flow-option ${analysis.id === selected?.id ? 'active' : ''}" href="${projectUrl('sequences', analysis.id)}" ${analysis.id === selected?.id ? 'aria-current="page"' : ''}><span class="flow-option-number">${String(index + 1).padStart(2, '0')}</span><div><strong>${escape(analysis.title)}</strong><p>${escape(analysis.requestedQuestion)}</p></div>${renderIcon('arrow')}</a>`;
}

// Share message explanations and evidence between the modal and optional list.
function renderSequenceMessageBody(message) {
  return `${message.condition ? `<p class="sequence-branch">When: ${escape(message.condition)}</p>` : ''}<p class="node-description">${formatText(message.description)}</p>${renderSourceDisclosure(message.sources)}`;
}

// Explain one numbered interaction with its branch condition and source evidence.
function renderSequenceMessage(message, index, names) {
  return `<details class="edge-row" id="sequence-message-${index + 1}"><summary><span class="edge-number">${String(index + 1).padStart(2, '0')}</span><div><span class="edge-ends">${escape(names.get(message.from))} → ${escape(names.get(message.to))} · ${escape(message.kind)}${message.inferred ? ' · Inferred' : ''}</span><strong>${escape(message.label)}</strong></div>${renderIcon('chevron')}</summary><div class="edge-details">${renderSequenceMessageBody(message)}</div></details>`;
}

// Restore the selected sequence diagram using the same fallback as its navigation.
function getSelectedSequence() {
  const analyses = data?.sequences || [];
  return analyses.find(
    // Resolve saved bookmarks before falling back to the first diagram.
    (analysis) => analysis.id === currentRoute().selection,
  ) || analyses[0];
}

// Show a message or participant's evidence without moving the diagram viewport.
function openSequenceDetails({ messageNumber, participantId }) {
  if (currentRoute().tab !== 'sequences') return;
  const analysis = getSelectedSequence();
  if (!analysis) return;
  const message = Number.isInteger(messageNumber) ? analysis.messages[messageNumber - 1] : null;
  const participant = analysis.participants.find(
    // Resolve only participants belonging to the selected diagram.
    (entry) => entry.id === participantId,
  );
  if (!message && !participant) return;
  const dialog = selectElement('#sequence-details-dialog');
  dialog.dataset.route = location.pathname;
  dialog.dataset.analysis = analysis.id;
  dialog.dataset.messageNumber = message ? String(messageNumber) : '';
  selectElement('#sequence-details-title').textContent = message ? message.label : participant.name;
  selectElement('#sequence-details-kind').textContent = message
    ? `MESSAGE ${String(messageNumber).padStart(2, '0')} · ${message.kind}${message.inferred ? ' · Inferred' : ''}`
    : 'PARTICIPANT';
  selectElement('#sequence-message-navigation').hidden = !message;
  selectElement('#sequence-message-previous').disabled = !message || messageNumber === 1;
  selectElement('#sequence-message-next').disabled = !message || messageNumber === analysis.messages.length;
  selectElement('#sequence-message-position').textContent = message
    ? `Message ${messageNumber} of ${analysis.messages.length}` : '';

  if (message) {
    const names = new Map(analysis.participants.map(
      // Use human-readable participant names in the interaction heading.
      (entry) => [entry.id, entry.name],
    ));
    selectElement('#sequence-details-body').innerHTML =
      `<p class="sequence-message-endpoints">${escape(names.get(message.from))} → ${escape(names.get(message.to))}</p>${renderSequenceMessageBody(message)}`;
  } else {
    selectElement('#sequence-details-body').innerHTML =
      `<p class="node-description">${formatText(participant.description)}</p>${renderSourceDisclosure(participant.sources)}`;
  }

  selectElement('#sequence-details-body').scrollTop = 0;
  if (!dialog.open) dialog.showModal();
}

// Step through this diagram's messages while retaining the open modal and its focus.
function stepSequenceMessage(direction) {
  const dialog = selectElement('#sequence-details-dialog');
  const analysis = getSelectedSequence();
  if (
    !dialog.open || !dialog.dataset.messageNumber ||
    dialog.dataset.route !== location.pathname || dialog.dataset.analysis !== analysis?.id
  ) return;
  const messageNumber = Number(dialog.dataset.messageNumber) + direction;
  if (!Number.isInteger(messageNumber) || !analysis.messages[messageNumber - 1]) return;
  const focusedControl = document.activeElement;
  openSequenceDetails({ messageNumber });

  // Keep keyboard focus usable when the pressed button reaches a sequence boundary.
  if (focusedControl?.disabled)
    selectElement(direction > 0 ? '#sequence-message-previous' : '#sequence-message-next')
      .focus({ preventScroll: true });
}

// Compose the sequence request form, lifeline diagram, and source-backed walkthrough.
function renderSequences() {
  const analyses = data.sequences || [];
  const selected = getSelectedSequence();
  const busy = ['queued', 'running'].includes(data.job?.status);
  const navigation = `<aside class="sidebar sequence-sidebar" aria-label="Sequence diagram navigation"><div class="sidebar-heading"><h2>Sequence diagrams</h2><span class="tiny-label">${analyses.length} SAVED</span></div><p class="sidebar-description">Who calls whom, in what order, and what happens next.</p><form id="sequence-form" class="flow-composer"><label for="sequence-question">Describe an interaction</label><textarea id="sequence-question" required maxlength="4000" rows="4" placeholder="What happens when an analysis starts?" ${busy ? 'disabled' : ''}>${escape(getAnalysisRequest('sequences', sequenceDrafts))}</textarea><p class="composer-hint">Each request saves a separate diagram with source links.</p><button class="button" type="submit" ${busy ? 'disabled' : ''}>Generate sequence</button><p class="flow-error" role="alert"></p></form><div class="flow-options">${analyses.map(
    // Keep earlier diagrams available while another analysis is running.
    (analysis, index) => renderSequenceOption(analysis, index, selected),
  ).join('')}</div></aside>`;
  let content = `<span class="eyebrow">SEQUENCES</span><h2>Follow an interaction in ${escape(data.name)}</h2><p class="lead">Describe an action to see its participants, calls, replies, and asynchronous handoffs in order.</p>${busy ? '<p class="lead">Analysis is in progress. Saved diagrams will appear here when ready.</p>' : ''}`;

  if (selected) {
    const names = new Map(selected.participants.map(
      // Translate message endpoint IDs into readable participant names.
      (participant) => [participant.id, participant.name],
    ));
    content = `<div class="content-heading"><div><span class="eyebrow">SEQUENCE ANALYSIS</span><h2>${escape(selected.title)}</h2><p class="lead">${formatText(selected.description)}</p>${renderSourceDisclosure(selected.sources)}</div>${renderAnalysisMenu('sequences', selected.id)}</div>${renderAnalysisFreshness(selected.review)}<div class="precondition"><span>STARTS WITH</span><p>${formatText(selected.precondition)}</p></div>${selected.messages.length ? `<figure class="sequence-figure"><figcaption><strong>Read from top to bottom</strong><span>Solid: call · Dashed: reply · Open arrow: async · Amber: inferred</span><span>Drag blank space to pan. Select a participant or message to open its details and sources. Fit to width shows all participants.</span>${renderSequenceZoomControls()}</figcaption><div class="sequence-scroll" tabindex="0" role="region" aria-label="Scrollable sequence diagram">${renderSequenceDiagram(selected)}</div></figure><details class="sequence-participants"><summary>Participants · ${selected.participants.length}</summary>${selected.participants.map(
      // Describe each lifeline and retain its implementation evidence.
      (participant) => `<section><h3>${escape(participant.name)}</h3><p>${formatText(participant.description)}</p>${renderSourceDisclosure(participant.sources)}</section>`,
    ).join('')}</details><details class="sequence-messages"><summary>Messages and sources · ${selected.messages.length}</summary>${selected.messages.map(
      // Match message numbers to the arrows in the diagram.
      (message, index) => renderSequenceMessage(message, index, names),
    ).join('')}</details>` : '<p class="lead">No implemented interaction was found for this request.</p>'}<div class="outcome"><span>${renderIcon('check')} OUTCOME</span><p>${formatText(selected.outcome)}</p></div>${selected.notes.length ? `<section class="noun-notes"><h3>Notes and branches</h3><ul>${selected.notes.map(
      // Explain loops, alternative paths, concurrency, and coverage limitations.
      (note) => `<li>${formatText(note)}</li>`,
    ).join('')}</ul></section>` : ''}`;
  }

  selectElement('#view').innerHTML = `<div class="workspace sequence-workspace">${navigation}<article class="sequence-content">${content}</article></div>`;
  const figure = selectElement('.sequence-figure');
  if (figure) {
    const key = `${data.id}:${selected.id}`;
    if (!sequenceZoomPreferences.has(key))
      sequenceZoomPreferences.set(key, { mode: 'fit', scale: 1 });
    disposeSequenceZoom = setupSequenceZoom(figure, sequenceZoomPreferences.get(key));
  }
}

// Read the single ordered list of saved architecture diagrams.
function getArchitectureViews() {
  return data.architectures || [];
}

// Find the selected architecture view or fall back to the first.
function getSelectedArchitecture() {
  const views = getArchitectureViews();
  return (
    views.find(
      // Match a saved diagram to the URL selection.
      (graph) => graph.id === currentRoute().selection,
    ) || views[0]
  );
}

// Compose architecture navigation and the focused diagram question form.
function renderArchitectureNavigation(views, selected) {
  const busy = ['queued', 'running'].includes(data.job?.status);
  return `<aside class="sidebar architecture-sidebar" aria-label="Architecture navigation"><div class="sidebar-heading"><h2>Architecture views</h2><span class="tiny-label">${views.length} ${views.length === 1 ? 'DIAGRAM' : 'DIAGRAMS'}</span></div><p class="sidebar-description">Explore the whole system or focus on a smaller part.</p><form id="architecture-form" class="flow-composer"><label for="architecture-question">Ask an architecture question</label><textarea id="architecture-question" required maxlength="4000" rows="4" placeholder="How does authentication fit together?" ${busy ? 'disabled' : ''}>${escape(getAnalysisRequest('architecture', architectureDrafts))}</textarea><p class="composer-hint">Each question adds a saved, source-linked diagram.</p><button class="button" type="submit" ${busy ? 'disabled' : ''}>Generate diagram</button><p class="architecture-error flow-error" role="alert"></p></form><div class="flow-options">${views
    .map(
      // Render each saved diagram with the selected view highlighted.
      (graph, index) => renderArchitectureOption(graph, index, selected),
    )
    .join('')}</div></aside>`;
}

// Group components into dependency levels while tolerating cycles.
function groupGraphLevels(graph) {
  const rank = new Map(
    graph.nodes.map(
      // Initialize every component's display rank.
      (node) => [node.id, 0],
    ),
  );
  const degree = new Map(
    graph.nodes.map(
      // Initialize incoming connection counts for topological traversal.
      (node) => [node.id, 0],
    ),
  );

  for (const edge of graph.edges)
    if (edge.from !== edge.to) degree.set(edge.to, degree.get(edge.to) + 1);

  const queue = graph.nodes
    .filter(
      // Select components without incoming dependencies as traversal roots.
      (node) => !degree.get(node.id),
    )
    .map(
      // Read root identifiers for the traversal queue.
      (node) => node.id,
    );

  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];

    for (const edge of graph.edges.filter(
      // Visit outgoing connections while ignoring self loops.
      (edge) => edge.from === id && edge.to !== id,
    )) {
      rank.set(edge.to, Math.max(rank.get(edge.to), rank.get(id) + 1));
      degree.set(edge.to, degree.get(edge.to) - 1);
      if (!degree.get(edge.to)) queue.push(edge.to);
    }
  }

  const groups = [];

  for (const node of graph.nodes) {
    const level = Math.min(rank.get(node.id), graph.nodes.length - 1);
    (groups[level] ||= []).push(node);
  }

  return groups.filter(Boolean);
}

// Measure diagram cards and update SVG connection paths.
function drawGraphEdges() {
  const canvas = selectElement('.graph-canvas');
  const graph = getSelectedArchitecture();
  if (!canvas || !graph) return;
  const bounds = canvas.getBoundingClientRect();
  const svg = selectElement('.graph-edges');
  svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
  const nodes = graph.nodes.map(
    // Convert each component's DOM bounds into canvas coordinates.
    (node) => {
      const rect = document.getElementById(`graph-node-${node.id}`).getBoundingClientRect();
      return {
        id: node.id,
        x: rect.left - bounds.left,
        y: rect.top - bounds.top,
        width: rect.width,
        height: rect.height,
      };
    },
  );

  for (const edge of routeGraphEdges(nodes, graph.edges, bounds))
    document.getElementById(`graph-edge-${edge.index}`).setAttribute('d', edge.path);
}

// Render architecture navigation, components, connections, and notes.
function renderArchitecture() {
  const views = getArchitectureViews();
  const graph = getSelectedArchitecture();
  const navigation = renderArchitectureNavigation(views, graph);
  if (!graph) {
    selectElement('#view').innerHTML =
      `<div class="workspace architecture-workspace">${navigation}<article class="architecture-content"><span class="eyebrow">ARCHITECTURE</span><h2>Explore the architecture of ${escape(data.name)}</h2><p class="lead">${['running', 'queued'].includes(data.job?.status) ? 'Analysis is in progress. Saved diagrams will appear here as they finish.' : 'Ask a question to diagram a subsystem, boundary, or dependency.'}</p></article></div>`;
    return;
  }

  const titles = new Map(
    graph.nodes.map(
      // Index component titles for readable connection labels.
      (node) => [node.id, node.title],
    ),
  );
  const levels = groupGraphLevels(graph);
  selectElement('#view').innerHTML =
    `<div class="workspace architecture-workspace">${navigation}<article class="architecture-content"><div class="content-heading"><div><div class="eyebrow">ARCHITECTURE <span>/</span> ${String(views.indexOf(graph) + 1).padStart(2, '0')} OF ${views.length}</div><h2>${escape(graph.title)}</h2><p class="lead">${formatText(graph.description)}</p>${renderSourceDisclosure(graph.sources)}</div>${renderAnalysisMenu('architecture', graph.id)}</div>
    ${renderAnalysisFreshness(graph.review)}
    ${graph.requestedQuestion ? `<div class="architecture-question"><span class="eyebrow">QUESTION</span><p>${escape(graph.requestedQuestion)}</p></div>` : ''}
    <figure class="system-figure" aria-labelledby="system-caption"><figcaption id="system-caption"><span>${escape(data.name)} · ${(graph.id === 'overview' || graph.requestedQuestion === null) ? 'System overview' : 'Focused architecture'}</span><span class="diagram-legend"><span><i></i>Source-backed connection</span><span><i class="oauth-dot"></i>Redirect or inferred connection</span></span></figcaption>
    <div class="graph-canvas"><svg class="graph-edges" aria-hidden="true"><defs><marker id="graph-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path d="M 2 2 L 8 5 L 2 8"/></marker><marker id="graph-arrow-inferred" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path d="M 2 2 L 8 5 L 2 8"/></marker></defs>${graph.edges
      .map(
        // Render an SVG path placeholder with the correct arrow style.
        (edge, index) =>
          `<path id="graph-edge-${index}" class="${edge.inferred || edge.kind === 'redirect' ? 'inferred-edge' : ''}" marker-end="url(#${edge.inferred || edge.kind === 'redirect' ? 'graph-arrow-inferred' : 'graph-arrow'})"/>`,
      )
      .join('')}</svg>
    ${
      levels
        .map(
          // Render a row of component cards at the same dependency level.
          (level) => `<div class="graph-level">${level.map(renderGraphNode).join('')}</div>`,
        )
        .join('') ||
      '<div class="graph-empty"><h3>No components in this diagram</h3><p>All nodes have been removed. Generate a new architecture view, or analyze the project to rebuild its overall diagram.</p></div>'
    }</div>
    <div class="diagram-caption">${renderIcon('info')}<p>Hover or focus a component to highlight its connections. Click it to view descriptions, sources, and related components in a dialog. Inferred relationships are marked explicitly.</p></div></figure>
    <section class="graph-connections"><div class="section-label"><h3>Connections</h3><span>${graph.edges.length} ${graph.edges.length === 1 ? 'relationship' : 'relationships'}</span></div>${
      graph.edges
        .map(
          // Render a connection's label, description, and source evidence.
          (edge, index) =>
            `<details class="edge-row" data-edge="${index}"><summary><span class="edge-number">${index + 1}</span><div><span class="edge-ends">${escape(titles.get(edge.from))} → ${escape(titles.get(edge.to))}</span><strong>${escape(edge.label)}</strong></div>${edge.inferred ? '<span class="effect external">Inferred</span>' : ''}${renderIcon('chevron')}</summary><div class="edge-details"><p>${formatText(edge.description)}</p>${renderSourceDisclosure(edge.sources)}</div></details>`,
        )
        .join('') || '<p class="lead">No inter-component connections were identified.</p>'
    }</section>
    <div class="architecture-notes">${(graph.notes || [])
      .map(
        // Render an architecture note and its optional related flow link.
        (note) =>
          `<section><h3>${escape(note.title)}</h3><p>${formatText(note.description)}</p>${renderSourceDisclosure(note.sources)}${note.flow ? `<a href="${projectUrl('flows', note.flow)}">${escape(note.link)} ${renderIcon('arrow')}</a>` : ''}</section>`,
      )
      .join(
        '',
      )}</div><div class="scope-note">${renderIcon('info')}<span>${formatText(graph.scope)}</span></div></article></div>`;
  diagramObserver = new ResizeObserver(drawGraphEdges);
  diagramObserver.observe(selectElement('.graph-canvas'));

  for (const target of document.querySelectorAll('.graph-node, [data-edge]')) {
    for (const event of ['mouseenter', 'mouseleave', 'focusin', 'focusout'])
      // Update connection highlighting when hover or keyboard focus changes.
      target.addEventListener(event, () => highlightGraphEdges(graph));
  }
}

// Highlight connections belonging to active components or connection rows.
function highlightGraphEdges(graph) {
  const active = new Set(
    graph.nodes
      .filter(
        // Select components currently hovered or focused.
        (node) =>
          document.getElementById(`graph-node-${node.id}`)?.matches(':hover, :focus-within'),
      )
      .map(
        // Collect the identifiers of active components.
        (node) => node.id,
      ),
  );
  let highlighted = false;
  // Update each connection's active state and track whether any are highlighted.
  graph.edges.forEach((edge, index) => {
    const enabled =
      active.has(edge.from) ||
      active.has(edge.to) ||
      selectElement(`[data-edge="${index}"]`)?.matches(':hover, :focus-within');
    document.getElementById(`graph-edge-${index}`)?.classList.toggle('highlight-edge', enabled);
    highlighted ||= enabled;
  });
  selectElement('.graph-canvas')?.classList.toggle('is-highlighting', highlighted);
}

// Open the selected component's details and related connections.
function openNodeDetails(id) {
  if (deletingNode) return;
  const graph = getSelectedArchitecture();
  const node = graph?.nodes.find(
    // Find the component requested by the card or connection control.
    (entry) => entry.id === id,
  );
  if (!node) return;
  const dialog = selectElement('#node-dialog');
  if (dialog.open) dialog.close();
  dialog.dataset.project = data.id;
  dialog.dataset.graph = graph.id;
  dialog.dataset.nodeId = node.id;
  selectElement('#node-delete-error').textContent = '';
  selectElement('#delete-node').disabled = ['queued', 'running'].includes(data.job?.status);
  selectElement('#delete-node').textContent = 'Delete node';
  selectElement('#node-kind').textContent = node.kind;
  selectElement('#node-title').textContent = node.title;
  const related = graph.edges.filter(
    // Select incoming and outgoing connections for the component.
    (edge) => edge.from === id || edge.to === id,
  );
  selectElement('#node-body').innerHTML =
    `<p class="node-description">${formatText(node.description)}</p>${
      node.tags?.length
        ? `<div class="system-tables">${node.tags
            .map(
              // Render a component's associated technology or data tag.
              (tag) => `<code>${escape(tag)}</code>`,
            )
            .join('')}</div>`
        : ''
    }${renderSourceDisclosure(node.sources)}${
      related.length
        ? `<section class="node-relationships"><h3>Connections</h3><ul>${related
            .map(
              // Render a navigable connection to the neighboring component.
              (edge) => {
                const outgoing = edge.from === id;
                const other = graph.nodes.find(
                  // Find the component at the opposite end of a connection.
                  (entry) => entry.id === (outgoing ? edge.to : edge.from),
                );
                if (!other) return '';

                return `<li><button type="button" class="node-connection" data-node="${escape(other.id)}" aria-label="View details for ${escape(other.title)}" aria-haspopup="dialog"><span class="node-direction">${outgoing ? 'To' : 'From'}</span><span class="node-connection-main"><strong>${escape(other.title)}</strong><span class="node-connection-label">${formatText(edge.label)}</span>${edge.inferred ? '<span class="effect external">Inferred</span>' : ''}</span>${renderIcon('arrow')}</button></li>`;
              },
            )
            .join('')}</ul></section>`
        : ''
    }`;
  selectElement('#node-body').scrollTop = 0;
  dialog.showModal();
}

// Confirm and delete the selected diagram node while guarding against stale UI state.
async function deleteCurrentNode() {
  const details = selectElement('#node-dialog'),
    confirmation = selectElement('#delete-node-dialog');
  if (deletingNode || confirmation.open || !details.open) return;
  const graph = getSelectedArchitecture();
  const node = graph?.nodes.find(
    // Find the component still selected in the details dialog.
    (entry) => entry.id === details.dataset.nodeId,
  );
  if (!node) return;
  const projectId = data.id,
    diagramId = graph.id;
  const connections = graph.edges.filter(
    // Count the connections that deletion would remove.
    (edge) => edge.from === node.id || edge.to === node.id,
  ).length;
  selectElement('#delete-node-description').textContent =
    `Delete “${node.title}”${connections ? ` and ${connections === 1 ? 'its connection' : `its ${connections} connections`}` : ''} from “${graph.title}”?${graph.nodes.length === 1 ? ' This is the last node, so the diagram will be empty.' : ''}`;
  confirmation.returnValue = '';
  const confirmed = await new Promise(
    // Wait for the deletion confirmation dialog to close.
    (resolve) => {
      // Resolve deletion confirmation only for an explicit yes response.
      confirmation.addEventListener('close', () => resolve(confirmation.returnValue === 'yes'), {
        once: true,
      });
      confirmation.showModal();
    },
  );
  if (
    !confirmed ||
    !details.open ||
    data.id !== projectId ||
    details.dataset.graph !== diagramId ||
    details.dataset.nodeId !== node.id
  )
    return;
  deletingNode = true;
  selectElement('#delete-node').disabled = true;
  selectElement('#delete-node').textContent = 'Deleting…';
  selectElement('#node-delete-error').textContent = '';

  for (const link of details.querySelectorAll('.node-connection')) link.disabled = true;

  try {
    await postJson(
      `/api/projects/${projectId}/architecture/${encodeURIComponent(diagramId)}/nodes/${encodeURIComponent(node.id)}/delete`,
    );
    if (data.id === projectId) {
      details.close();
      await loadCurrentProject();
    }
  } catch (error) {
    if (details.open && details.dataset.project === projectId && details.dataset.nodeId === node.id)
      selectElement('#node-delete-error').textContent = error.message;
    else showError(error.message);
  } finally {
    deletingNode = false;
    selectElement('#delete-node').disabled = ['queued', 'running'].includes(data.job?.status);
    selectElement('#delete-node').textContent = 'Delete node';

    for (const link of details.querySelectorAll('.node-connection')) link.disabled = false;
  }
}

// Render a saved result with its type, last analysis date, and original detail link.
function renderAnalysisEntry(entry) {
  const date = entry.analyzedAt
    ? `<time datetime="${escape(entry.analyzedAt)}">Analyzed ${escape(new Date(entry.analyzedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))}</time>`
    : '<span>Analysis date unavailable</span>';

  return `<li><a class="analysis-list-entry" href="${projectUrl(entry.tab, entry.id)}"><span class="analysis-list-icon">${renderIcon(entry.icon)}</span><div class="analysis-list-content"><div class="analysis-list-meta"><span class="analysis-type">${escape(entry.label)}</span>${date}</div><h3>${escape(entry.title)}</h3><p>${formatText(entry.description)}</p></div>${renderIcon('arrow')}</a></li>`;
}

// List every saved analysis in this project, most recently analyzed first.
function renderAllAnalyses() {
  const entries = getAnalysisEntries(data);

  selectElement('#view').innerHTML =
    `<article class="all-analyses"><div class="all-analyses-heading"><span class="eyebrow">ALL</span><h2>All analyses</h2><p>Diagrams and analyses, most recently analyzed first.</p></div>${entries.length
      ? `<ul class="analysis-list" aria-label="Analyses, most recently analyzed first">${entries.map(renderAnalysisEntry).join('')}</ul>`
      : '<div class="all-analyses-empty"><h3>No saved analyses yet</h3><p>Run an analysis from any of the other tabs. Completed results will appear here.</p></div>'}</article>`;
}

// Render the current project view and close dialogs tied to an obsolete selection.
function render() {
  if (!data) return;
  disposeSequenceZoom?.();
  disposeSequenceZoom = undefined;
  diagramObserver?.disconnect();
  diagramObserver = undefined;
  const { tab } = currentRoute();
  const changesDialog = selectElement('#analysis-changes-dialog');
  if (changesDialog.open && changesDialog.dataset.route !== location.pathname)
    changesDialog.close();
  const sequenceDialog = selectElement('#sequence-details-dialog');
  if (sequenceDialog.open && sequenceDialog.dataset.route !== location.pathname) {
    selectElement('#source-dialog').close();
    sequenceDialog.close();
  }
  const nounDialog = selectElement('#noun-details-dialog');
  const nounsAnalysis = getSelectedNounsAnalysis();
  if (nounDialog.open && (nounDialog.dataset.route !== location.pathname ||
      nounDialog.dataset.analysis !== nounsAnalysis?.id || !nounsAnalysis?.nouns.some(
        // Close details when the selected concept no longer belongs to this result.
        (noun) => noun.id === nounDialog.dataset.nounId,
      ))) {
    selectElement('#source-dialog').close();
    nounDialog.close();
  }
  const nodeDialog = selectElement('#node-dialog');
  const modificationDialog = selectElement('#modify-analysis-dialog');
  if (modificationDialog.open && modificationDialog.dataset.route !== location.pathname)
    modificationDialog.close('cancel');
  if (
    nodeDialog.open &&
    (tab !== 'architecture' ||
      nodeDialog.dataset.project !== data.id ||
      nodeDialog.dataset.graph !== getSelectedArchitecture()?.id)
  ) {
    selectElement('#delete-node-dialog').close('no');
    selectElement('#source-dialog').close();
    nodeDialog.close();
  }

  for (const name of projectTabs) {
    selectElement(`#tab-${name}`).classList.toggle('active', tab === name);
    if (tab === name) selectElement(`#tab-${name}`).setAttribute('aria-current', 'page');
    else selectElement(`#tab-${name}`).removeAttribute('aria-current');
  }

  if (tab === 'flows') renderFlows();
  else if (tab === 'architecture') renderArchitecture();
  else if (tab === 'nouns') renderNouns();
  else if (tab === 'sequences') renderSequences();
  else if (tab === 'code-scan') {
    selectElement('#view').innerHTML = renderCodeScan(
      data.codeScan, currentRoute().selection, data.name,
      // Keep directory selections addressable through reloads and Back/Forward.
      (path) => projectUrl('code-scan', path),
    );
  } else if (tab === 'all') renderAllAnalyses();
  else renderDirectories();
  ask.refresh();
}

// Fetch JSON and surface API errors as readable exceptions.
async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Could not load the project.');

  return body;
}

// Send a JSON mutation request through the shared response handler.
const postJson = (url, body = {}) =>
  fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

// Build an API URL for the current project and optional action.
const projectApiUrl = (action = '') => `/api/projects/${data.id}${action ? `/${action}` : ''}`;

// Show a request error in the project notice area.
function showError(message) {
  selectElement('#notice').innerHTML = `<div class="warning">${escape(message)}</div>`;
}

// Tick only the elapsed label so the progress list and analysis view stay in place.
function updateJobElapsedTime() {
  const timer = selectElement('#job-elapsed-time');
  if (timer) timer.textContent = formatJobElapsed(data?.job);
}

// Close a finished job's panel without changing its results or saved progress history.
function dismissJobProgress() {
  if (!data || !jobDismissals.dismiss(data.id, data.job)) return;
  renderJob();
  const nextControl = selectElement('.analysis-actions > summary') ||
    selectElement('#project-actions > summary');
  nextControl?.focus({ preventScroll: true });
}

// Display the selected stage's prompt or readable JSON schema as plain text.
function renderSelectedJobPrompt() {
  const stage = selectElement('#job-prompt-stage').value;
  const prompt = jobPromptFiles.find(
    // Match the user's stage selection to the saved input.
    (entry) => entry.stage === stage,
  );
  if (!prompt) return;
  const schemaSelected = jobInputKind === 'schema';
  const input = schemaSelected ? prompt.schema : prompt;
  selectElement('#job-input-prompt').setAttribute('aria-pressed', String(!schemaSelected));
  selectElement('#job-input-schema').setAttribute('aria-pressed', String(schemaSelected));
  selectElement('#job-input-label').textContent = schemaSelected ? 'Saved output schema' : 'Saved prompt';
  selectElement('#job-prompt-path').textContent = input?.path || '';
  let content = input?.content ?? 'No saved output schema is available for this stage.';
  if (schemaSelected && input) {
    try {
      content = JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      // Keep damaged or legacy files inspectable instead of hiding their contents.
    }
  }

  const preview = selectElement('#job-prompt-text');
  preview.setAttribute('aria-label', schemaSelected
    ? 'Output schema supplied to Codex' : 'Exact prompt sent to Codex');
  if (preview.textContent !== content) preview.textContent = content;
}

// Refresh available prompts while the job advances, preserving the selected stage.
async function loadJobPrompts() {
  const dialog = selectElement('#job-prompts-dialog');
  const request = ++jobPromptRequest;
  const { projectId, jobId } = dialog.dataset;

  try {
    const result = await fetchJson(`/api/projects/${projectId}/jobs/${jobId}/prompts`);
    if (request !== jobPromptRequest || !dialog.open) return;
    jobPromptFiles = result.prompts;
    const status = selectElement('#job-prompts-status');
    status.hidden = result.prompts.length > 0;
    selectElement('#job-prompts-content').hidden = !result.prompts.length;
    if (!result.prompts.length) {
      const pending = ['queued', 'running'].includes(data?.job?.status);
      status.textContent = `${pending ? 'The prompt will appear when the analysis stage starts.' : 'No saved prompt is available for this job.'} Job files: ${result.directory}`;
      return;
    }

    const stage = selectElement('#job-prompt-stage');
    const options = result.prompts.map(
      // Name each generated stage using the progress panel's labels.
      (prompt) => `<option value="${escape(prompt.stage)}">${escape(jobTypeLabels[prompt.stage] || prompt.stage)}</option>`,
    ).join('');
    if (stage.innerHTML !== options) {
      const selected = stage.value;
      stage.innerHTML = options;
      stage.value = result.prompts.some(
        // Keep a manually selected earlier stage available as later stages start.
        (prompt) => prompt.stage === selected,
      ) ? selected : result.prompts.at(-1).stage;
    }
    renderSelectedJobPrompt();
  } catch (error) {
    if (request !== jobPromptRequest || !dialog.open) return;
    selectElement('#job-prompts-status').hidden = false;
    selectElement('#job-prompts-status').textContent = error.message;
  }
}

// Open the current job's exact input and its saved file location.
function openJobPrompts() {
  if (!data?.job) return;
  const dialog = selectElement('#job-prompts-dialog');
  dialog.dataset.projectId = data.id;
  dialog.dataset.jobId = data.job.id;
  selectElement('#job-prompts-status').textContent = 'Loading prompt…';
  selectElement('#job-prompts-status').hidden = false;
  selectElement('#job-prompts-content').hidden = true;
  selectElement('#job-prompt-stage').innerHTML = '';
  selectElement('#job-prompt-text').textContent = '';
  jobPromptFiles = [];
  jobInputKind = 'prompt';
  dialog.showModal();
  loadJobPrompts();
}

// Retain finished progress until it is closed manually or five minutes have passed.
function renderJob() {
  clearInterval(jobElapsedTimer);
  clearTimeout(jobDismissalTimer);
  const panel = selectElement('#job-panel');
  const job = data?.job;
  const promptDialog = selectElement('#job-prompts-dialog');
  if (promptDialog.open) {
    if (promptDialog.dataset.projectId !== data?.id || promptDialog.dataset.jobId !== job?.id)
      promptDialog.close();
    else loadJobPrompts();
  }
  if (!job || job.kind === 'index' || jobDismissals.isDismissed(data.id, job)) {
    panel.innerHTML = '';
    delete panel.dataset.signature;
    delete panel.dataset.jobId;
    delete panel.dataset.latestMessage;
    return;
  }

  const busy = ['queued', 'running'].includes(job.status);
  const completed = job.status === 'completed';
  const messages = getJobMessages(job);
  const signature = JSON.stringify([
    data.id, job.id, job.kind, job.status, job.stage, job.startedAt, job.finishedAt,
    messages, job.coverage,
  ]);

  // Polling unchanged progress must not replay the incoming-message animation.
  if (!panel.firstElementChild || panel.dataset.signature !== signature) {
    const newMessage = panel.dataset.jobId === job.id &&
      panel.dataset.latestMessage !== messages.at(-1)?.message;
    panel.innerHTML =
      `<div class="job-card ${busy ? 'job-active' : completed ? 'job-completed' : ''} ${['failed', 'interrupted'].includes(job.status) ? 'job-failed' : ''}"><div class="job-content"><div class="job-heading"><span class="job-type">${job.modificationPrompt ? 'Modify · ' : ''}${escape(jobTypeLabels[job.kind] || 'Analysis')}</span>${job.status === 'running' ? '' : `<span class="eyebrow">${completed ? `${renderIcon('check')} Analysis complete` : escape(job.status)}</span>`}<span class="job-elapsed">${renderIcon('clock')}<span>Elapsed</span><span id="job-elapsed-time" aria-live="off">${formatJobElapsed(job)}</span></span></div><ol class="job-messages ${messages.length === 4 ? 'has-four' : ''}" aria-label="Recent analysis progress" aria-live="polite">${messages.map(
        // Keep chronological order, muting the oldest row only when all four exist.
        ({ message, timestamp }, index) => `<li${newMessage && index === messages.length - 1 ? ' class="job-message-new"' : ''}><time class="job-message-time" ${timestamp ? `datetime="${escape(timestamp)}"` : 'title="Timestamp unavailable for this older message"'}>${formatJobMessageTime(timestamp)}</time><span>${escape(message)}</span></li>`,
      ).join('')}</ol>${job.coverage?.limited ? `<small>Analysis snapshot: ${job.coverage.included} of ${job.coverage.total} text files. Large files and instruction files may be omitted.</small>` : ''}</div><div class="job-controls"><button type="button" class="button" data-action="view-prompt" aria-haspopup="dialog" aria-controls="job-prompts-dialog">View prompt</button>${busy ? '<button class="button" data-action="cancel">Cancel</button>' : `${['failed', 'cancelled', 'interrupted'].includes(job.status) ? '<button class="button" data-action="retry">Retry</button>' : ''}<button type="button" class="button ${completed ? 'primary' : ''}" data-action="dismiss-job" aria-label="Close analysis progress">Close</button>`}</div></div>`;
    panel.dataset.signature = signature;
    panel.dataset.jobId = job.id;
    panel.dataset.latestMessage = messages.at(-1)?.message || '';
  }

  updateJobElapsedTime();
  if (job.status === 'running') jobElapsedTimer = setInterval(updateJobElapsedTime, 1000);
  const dismissalDelay = getJobDismissalDelay(job);
  if (dismissalDelay !== null) jobDismissalTimer = setTimeout(renderJob, dismissalDelay);
}

// Update project metadata, action availability, and source freshness notices.
function updateHeader() {
  const busy = ['queued', 'running'].includes(data.job?.status);
  document.title = `${data.name} · CodeScope`;
  selectElement('#project-name').textContent = data.name;
  selectElement('#project-info-title').textContent = data.name;
  selectElement('#project-path').textContent = data.root;
  selectElement('#project-path').title = data.root;
  selectElement('#stack').innerHTML = data.stack
    .map(
      // Render a technology label in the project Info dialog.
      (label) => `<span class="stack-label">${escape(label)}</span>`,
    )
    .join('') || '<span class="stack-empty">No stack tags yet.</span>';
  selectElement('#flow-count').textContent = data.flows.length;
  selectElement('#architecture-count').textContent = getArchitectureViews().length;
  selectElement('#nouns-count').textContent = (data.nounAnalyses || []).length;
  selectElement('#sequences-count').textContent = (data.sequences || []).length;
  selectElement('#all-count').textContent = getAnalysisEntries(data).length;
  selectElement('#project-actions').hidden = false;
  selectElement('#project-info').disabled = deletingProject;
  selectElement('#delete-project').disabled = deletingProject;
  selectElement('#rename-project').disabled = deletingProject || renamingProject;
  selectElement('#delete-node').disabled = busy || deletingNode;
  selectElement('#delete-node').title = busy
    ? 'Wait for the current analysis to finish before editing this diagram.'
    : 'Delete this node and its connections from the saved diagram';

  for (const tab of projectTabs)
    selectElement(`#tab-${tab}`).href = projectUrl(tab);

  selectElement('.brand').href = projectUrl('directories');
  const messages = [];
  if (data.warnings?.length) messages.push(data.warnings.join(' '));
  selectElement('#notice').innerHTML = messages.length
    ? `<div class="warning">${escape(messages.join(' '))}</div>`
    : '';
  renderJob();
}

// Reload the registered projects and update the project picker.
async function loadProjects() {
  projects = (await fetchJson('/api/projects')).projects;
  selectElement('#project-picker').innerHTML = projects.length
    ? projects
        .map(
          // Render a registered project as a picker option.
          (project) => `<option value="${project.id}">${escape(project.name)}</option>`,
        )
        .join('')
    : '<option value="">No projects yet</option>';
  selectElement('#project-picker').disabled = !projects.length;
  if (data) selectElement('#project-picker').value = data.id;
}

// Load the current project, reject stale responses, and poll active jobs.
async function loadCurrentProject({ quiet = false } = {}) {
  if (deletingProject) return;
  clearTimeout(pollTimer);
  const sequence = ++loadSequence;
  const id = currentRoute().id;
  if (!id) return;

  try {
    const next = await fetchJson(`/api/projects/${id}`);
    if (sequence !== loadSequence || id !== currentRoute().id) return;
    const previous = data;
    const changed =
      previous?.id !== next.id ||
      previous?.name !== next.name ||
      previous?.version !== next.version ||
      previous?.sourceVersion !== next.sourceVersion ||
      previous?.job?.status !== next.job?.status;
    if (previous?.id !== next.id) {
      expanded = new Set(['']);
      query = '';
      detailState.clear();
      selectElement('#source-dialog').close();
      selectElement('#action-dialog').close('no');
      selectElement('#modify-analysis-dialog').close('cancel');
      selectElement('#rename-project-dialog').close();
      selectElement('#project-info-dialog').close();
      selectElement('#project-actions').open = false;
    }

    data = next;

    try {
      localStorage.setItem('codescope-project', id);
    } catch {
      /* Preference storage is optional. */
    }

    await loadProjects();
    if (sequence !== loadSequence || id !== currentRoute().id) return;
    updateHeader();
    if (
      previous?.id === next.id &&
      ['queued', 'running'].includes(previous.job?.status) &&
      next.job?.status === 'completed' &&
      next.job.kind === 'flow' &&
      !next.job.analysisId &&
      currentRoute().tab === 'flows' &&
      next.flows.length
    )
      history.replaceState(null, '', projectUrl('flows', next.flows.at(-1).id));
    if (
      previous?.id === next.id &&
      previous.job?.id === next.job?.id &&
      ['queued', 'running'].includes(previous.job?.status) &&
      next.job?.status === 'completed' &&
      ['architecture', 'nouns', 'sequence'].includes(next.job.kind) &&
      next.job.resultId &&
      !next.job.analysisId &&
      currentRoute().tab === (next.job.kind === 'sequence' ? 'sequences' : next.job.kind)
    )
      history.replaceState(null, '', projectUrl(next.job.kind === 'sequence' ? 'sequences' : next.job.kind, next.job.resultId));
    if (!quiet || changed) render();
    if (['queued', 'running'].includes(data.job?.status))
      pollTimer = setTimeout(
        // Poll an active job without rebuilding an unchanged view.
        () => loadCurrentProject({ quiet: true }),
        2000,
      );
  } catch (error) {
    if (sequence !== loadSequence || id !== currentRoute().id) return;
    showError(error.message);
    if (!data || data.id !== id)
      selectElement('#view').innerHTML =
        '<div class="error-state"><h2>Could not open this project</h2><p>Select another project, or check that its directory is still available.</p></div>';
    if (quiet)
      pollTimer = setTimeout(
        // Retry a failed background poll after a short delay.
        () => loadCurrentProject({ quiet: true }),
        4000,
      );
  }
}

// Explain project deletion and wait for explicit confirmation.
function confirmProjectDeletion() {
  const dialog = selectElement('#action-dialog');
  if (dialog.open) return Promise.resolve(false);
  selectElement('#action-project').textContent = data.name;
  selectElement('#action-title').textContent = 'Delete project?';
  selectElement('#action-description').textContent =
    `Delete “${data.name}” from CodeScope? This removes its saved explanations, diagrams, flows, Nouns analyses, sequence analyses, and debugging job history. This cannot be undone.`;
  selectElement('#action-usage').textContent =
    'Any queued or running analysis for this project will be stopped.';
  selectElement('#action-result').textContent =
    `Your source directory stays in place: ${data.root}.`;
  selectElement('#confirm-action').textContent = 'Yes, delete project';
  selectElement('#confirm-action').className = 'button danger';
  dialog.returnValue = '';

  return new Promise(
    // Wait for the project action dialog to close.
    (resolve) => {
      // Accept the project action only when the dialog returns yes.
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), { once: true });
      dialog.showModal();
    },
  );
}

// Resolve the selected result's name for an explicit deletion confirmation.
function analysisTitle(kind, id) {
  if (kind === 'directories') return 'Directories';
  const collections = { architecture: data.architectures, flows: data.flows,
    nouns: data.nounAnalyses, sequences: data.sequences };

  return collections[kind]?.find(
    // Use the captured ID so changing selection cannot delete a different result.
    (analysis) => analysis.id === id,
  )?.title || 'this analysis';
}

// Confirm removal of one saved analysis using the shared confirmation dialog.
function confirmAnalysisDeletion(title) {
  const dialog = selectElement('#action-dialog');
  if (dialog.open) return Promise.resolve(false);
  selectElement('#action-project').textContent = data.name;
  selectElement('#action-title').textContent = 'Delete analysis?';
  selectElement('#action-description').textContent = `Delete “${title}”? This removes its saved result and cannot be undone.`;
  selectElement('#action-usage').textContent = 'Your other analyses and source files stay in place.';
  selectElement('#action-result').textContent = 'You can run a new analysis later.';
  selectElement('#confirm-action').textContent = 'Delete analysis';
  selectElement('#confirm-action').className = 'button danger';
  dialog.returnValue = '';

  return new Promise(
    // Wait for the selected analysis confirmation to close.
    (resolve) => {
      // Accept only the explicit delete button, including keyboard submission.
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), { once: true });
      dialog.showModal();
    },
  );
}

// Build the endpoint for one saved analysis rather than starting a new result.
function analysisActionUrl(projectId, kind, id, action) {
  return `/api/projects/${projectId}/analyses/${kind}/${encodeURIComponent(id)}/${action}`;
}

// Collect a modification request while preserving an unsent draft for this result.
function promptForAnalysisModification(kind, id) {
  const dialog = selectElement('#modify-analysis-dialog');
  if (dialog.open) return Promise.resolve(null);
  const key = `${data.id}:${kind}:${id}`;
  const input = selectElement('#modification-prompt');
  selectElement('#modify-analysis-name').textContent = analysisTitle(kind, id);
  input.value = modificationDrafts.get(key) || '';
  input.setCustomValidity('');
  dialog.returnValue = '';
  dialog.dataset.route = location.pathname;

  return new Promise(
    // Resolve only an explicit submission and retain the text after cancellation.
    (resolve) => {
      // Store the draft before the next rendering can change the selected analysis.
      dialog.addEventListener('close', () => {
        modificationDrafts.set(key, input.value);
        resolve(dialog.returnValue === 'modify' ? input.value.trim() : null);
      }, { once: true });
      dialog.showModal();
    },
  );
}

// Apply one menu action and select its resulting copy or remaining analyses.
async function runAnalysisAction(action, kind, id) {
  if (!data || analysisActionPending || deletingProject ||
      ['queued', 'running'].includes(data.job?.status)) return;
  const projectId = data.id;
  const pathname = location.pathname;
  analysisActionPending = true;

  try {
    if (action === 'delete' && !(await confirmAnalysisDeletion(analysisTitle(kind, id)))) return;
    const prompt = action === 'modify' ? await promptForAnalysisModification(kind, id) : null;
    if (action === 'modify' && !prompt) return;
    if (data?.id !== projectId || location.pathname !== pathname) return;
    render();
    const url = kind === 'directories' && !data.hasDirectoryAnalysis && action === 'rerun'
      ? `/api/projects/${projectId}/directories`
      : analysisActionUrl(projectId, kind, id, action);
    const result = await postJson(url, action === 'modify' ? { prompt } : {});
    if (action === 'modify') modificationDrafts.delete(`${projectId}:${kind}:${id}`);
    if (data?.id !== projectId || currentRoute().id !== projectId) return;
    if (['rerun', 'modify'].includes(action)) data.job = result;
    else if (location.pathname === pathname)
      history.replaceState(null, '', projectUrl(kind, action === 'duplicate' ? result.analysisId : ''));
    await loadCurrentProject();
  } catch (error) {
    showError(error.message);
  } finally {
    analysisActionPending = false;
    if (data?.id === currentRoute().id) {
      render();
      if (data.id === projectId)
        selectElement('.analysis-actions > summary')?.focus({ preventScroll: true });
    }
  }
}

// Confirm, submit, or retry a project job and refresh its state.
async function runAction(action) {
  if (!data || deletingProject || analysisActionPending) return;
  const projectId = data.id;

  try {
    if (action === 'delete' && !(await confirmProjectDeletion())) return;
    if (data?.id !== projectId) return;
    if (action === 'delete') {
      await deleteCurrentProject(projectId);

      return;
    }
    if (action === 'retry') {
      const job = data.job;
      await postJson(
        job.analysisId ? analysisActionUrl(projectId,
          job.kind === 'flow' ? 'flows' : job.kind === 'sequence' ? 'sequences' : job.kind,
          job.analysisId, job.modificationPrompt ? 'modify' : 'rerun') : projectApiUrl(
          job.kind === 'sequence'
            ? 'sequences'
            : job.kind === 'flow'
              ? 'flows'
              : ['architecture', 'nouns', 'directories'].includes(job.kind)
                ? job.kind
                : 'analysis',
        ),
        job.modificationPrompt
          ? { prompt: job.modificationPrompt }
          : job.kind === 'flow'
          ? { feature: job.feature }
          : ['architecture', 'sequence'].includes(job.kind)
            ? { question: job.feature }
            : job.kind === 'nouns'
              ? { scope: job.feature || '' }
              : {},
      );
    } else {
      const result = await postJson(projectApiUrl(action));
      if (action === 'directories' && data?.id === projectId) data.job = result;
    }

    await loadCurrentProject();
  } catch (error) {
    showError(error.message);
  }
}

// Delete saved project data and select a remaining project or the empty workspace.
async function deleteCurrentProject(id) {
  deletingProject = true;
  selectElement('#project-info').disabled = true;
  clearTimeout(pollTimer);
  ++loadSequence;
  selectElement('#delete-project').disabled = true;
  selectElement('#delete-project-label').textContent = 'Deleting…';
  selectElement('#rename-project').disabled = true;
  selectElement('#project-picker').disabled = true;

  try {
    await postJson(`/api/projects/${id}/delete`);
    flowDrafts.delete(id);
    architectureDrafts.delete(id);
    nounsDrafts.delete(id);
    sequenceDrafts.delete(id);
    await loadProjects();
    if (currentRoute().id === id) {
      ++sourceRequest;
      for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close('no');
      data = undefined;
      history.replaceState(null, '', projects.length ? projectUrl('directories', '', projects[0].id) : '/');
      try {
        localStorage.removeItem('codescope-project');
      } catch {
        /* Browser preference storage is optional. */
      }
    }
  } finally {
    deletingProject = false;
    selectElement('#delete-project-label').textContent = 'Delete';
    selectElement('#delete-project').disabled = !data;
    selectElement('#project-picker').disabled = !projects.length;
    if (projects.length) await loadCurrentProject();
    else renderEmptyWorkspace();
  }
}

// Clear project-specific UI when the workspace has no registered projects.
function renderEmptyWorkspace() {
  clearInterval(jobElapsedTimer);
  clearTimeout(jobDismissalTimer);
  disposeSequenceZoom?.();
  disposeSequenceZoom = undefined;
  clearTimeout(pollTimer);
  ++loadSequence;
  ++sourceRequest;
  data = undefined;
  ask.refresh();
  diagramObserver?.disconnect();
  diagramObserver = undefined;
  document.title = 'CodeScope · Understand your projects';
  selectElement('#project-name').textContent = 'CodeScope';
  selectElement('#project-actions').open = false;
  selectElement('#project-actions').hidden = true;
  selectElement('#project-info-dialog').close();
  selectElement('#project-info-title').textContent = '';
  selectElement('#project-path').textContent = '';
  selectElement('#project-path').title = '';
  selectElement('#stack').innerHTML = '';
  selectElement('#notice').innerHTML = '';
  selectElement('#job-panel').innerHTML = '';
  selectElement('.brand').href = '/';
  for (const tab of projectTabs) {
    selectElement(`#tab-${tab}`).href = `/${tab}`;
    selectElement(`#tab-${tab}`).classList.remove('active');
    selectElement(`#tab-${tab}`).removeAttribute('aria-current');
  }
  for (const counter of ['flow-count', 'architecture-count', 'nouns-count', 'sequences-count', 'all-count'])
    selectElement(`#${counter}`).textContent = '0';
  for (const button of ['project-info', 'rename-project', 'delete-project'])
    selectElement(`#${button}`).disabled = true;
  selectElement('#view').innerHTML =
    '<article class="empty-analysis"><h2>Understand a local project</h2><p>Add a repository or directory to explore its structure, architecture, and code flows.</p><button class="button primary" data-action="add">+ Add project</button></article>';
}

// Show the current project's directory and stack without crowding its page header.
function showProjectInfo() {
  if (!data || deletingProject) return;
  selectElement('#project-actions').open = false;
  selectElement('#project-actions > summary').focus();
  selectElement('#project-info-body').scrollTop = 0;
  selectElement('#project-info-dialog').showModal();
}

// Open display-name editing for the current project with its name selected.
function showRenameProject() {
  if (!data || deletingProject || renamingProject) return;
  selectElement('#project-actions').open = false;
  selectElement('#project-actions > summary').focus();
  const dialog = selectElement('#rename-project-dialog');
  dialog.dataset.projectId = data.id;
  selectElement('#renamed-project-name').value = data.name;
  selectElement('#rename-project-error').textContent = '';
  dialog.showModal();
  selectElement('#renamed-project-name').focus();
  selectElement('#renamed-project-name').select();
}

// Save the dialog's project name and refresh visible project labels.
async function saveProjectName(event) {
  event.preventDefault();
  const dialog = selectElement('#rename-project-dialog');
  const id = dialog.dataset.projectId;
  if (renamingProject || deletingProject || !data || data.id !== id) return;
  const button = selectElement('#save-project-name');
  renamingProject = true;
  button.disabled = true;
  button.textContent = 'Saving…';
  selectElement('#rename-project').disabled = true;
  selectElement('#rename-project-error').textContent = '';

  try {
    await postJson(`/api/projects/${id}/rename`, {
      name: selectElement('#renamed-project-name').value.trim(),
    });
    dialog.close();
    if (currentRoute().id === id) await loadCurrentProject();
    else await loadProjects();
  } catch (error) {
    selectElement('#rename-project-error').textContent = error.message;
  } finally {
    renamingProject = false;
    button.disabled = false;
    button.textContent = 'Save name';
    selectElement('#rename-project').disabled = !data || deletingProject;
  }
}

// Open project registration and show the runner's availability.
async function showAddProject() {
  selectElement('#project-form-error').textContent = '';
  selectElement('#project-dialog').showModal();

  try {
    const state = await fetchJson('/api/runner');
    selectElement('#runner-status').textContent = state.message;
  } catch {
    selectElement('#runner-status').textContent =
      'Codex availability will be checked when analysis starts.';
  }
}

// Open the native folder picker while preserving cancellation and manual entry.
async function browseProjectDirectory() {
  if (directoryPickerRequest) return;
  const controller = new AbortController();
  directoryPickerRequest = controller;
  const button = selectElement('#browse-directory');
  button.disabled = true;
  button.textContent = 'Choosing…';
  selectElement('#submit-project').disabled = true;
  selectElement('#project-form-error').textContent = '';

  try {
    const selection = await fetchJson('/api/choose-directory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: controller.signal,
    });
    if (!selection.cancelled && selectElement('#project-dialog').open) {
      selectElement('#project-directory').value = selection.path;
      selectElement('#project-directory').focus();
    }
  } catch (error) {
    if (!controller.signal.aborted)
      selectElement('#project-form-error').textContent = error.message;
  } finally {
    if (directoryPickerRequest === controller) {
      directoryPickerRequest = undefined;
      button.disabled = false;
      button.textContent = 'Browse…';
      selectElement('#submit-project').disabled = false;
    }
  }
}

// Load projects and restore a saved project or legacy route on startup.
async function initializeApp() {
  try {
    await loadProjects();
    if (!projects.length) {
      renderEmptyWorkspace();

      return;
    }

    if (!currentRoute().id) {
      let saved;

      try {
        saved = localStorage.getItem('codescope-project');
      } catch {
        /* Use the first project. */
      }

      const id =
        projects.find(
          // Find the browser's previously selected project if it still exists.
          (project) => project.id === saved,
        )?.id || projects[0].id;
      const oldHash = location.hash.match(/^#(flows|directories|architecture|nouns|sequences|code-scan|all)(?:\/(.*))?$/);
      const current = currentRoute();
      history.replaceState(
        null,
        '',
        projectUrl(
          oldHash?.[1] || current.tab,
          oldHash?.[2] ? decodeURIComponent(oldHash[2]) : current.selection,
          id,
        ),
      );
    }

    // Show the registered name before the slower source scan finishes.
    const project = projects.find(
      // Match direct links and restored project selections against the registry.
      (entry) => entry.id === currentRoute().id,
    );
    if (project) {
      selectElement('#project-name').textContent = project.name;
    }

    await loadCurrentProject();
  } catch (error) {
    showError(error.message);
  }
}

// Open a read-only source preview and ignore obsolete fetch responses.
async function openSource(path, line = 1, symbol = '', endLine = line) {
  const requestId = ++sourceRequest;
  const dialog = selectElement('#source-dialog');
  const targetLine = Math.max(1, Number(line) || 1);
  selectElement('#source-title').textContent = `/${path.replace(/^\/+/, '')}`;
  const finalLine = Math.max(targetLine, Number(endLine) || targetLine);
  const sourceLabel = symbol.endsWith('()') || symbol.includes(' ') ? symbol : `${symbol}()`;
  selectElement('#source-context').textContent = symbol
    ? `${sourceLabel} · line ${targetLine} · Current local source`
    : 'Current local source · Read-only preview';
  selectElement('#source-body').innerHTML = '<div class="loading">Loading source…</div>';
  if (!dialog.open) dialog.showModal();

  try {
    const result = await fetchJson(`${projectApiUrl('source')}?path=${encodeURIComponent(path)}`);
    if (requestId !== sourceRequest || !dialog.open) return;
    const lines = result.content.split('\n');
    selectElement('#source-body').innerHTML = `<pre class="source-code"><code>${lines
      .map(
        // Render escaped source lines and highlight the requested citation line.
        (text, index) =>
          `<span class="source-line ${index + 1 >= targetLine && index + 1 <= finalLine ? 'highlight' : ''}" id="source-line-${index + 1}"><span class="line-number">${index + 1}</span><span class="line-text">${escape(text) || ' '}</span></span>`,
      )
      .join('')}</code></pre>`;
    selectElement(`#source-line-${Math.min(targetLine, lines.length)}`)?.scrollIntoView({
      block: 'center',
    });
  } catch (error) {
    if (requestId === sourceRequest)
      selectElement('#source-body').innerHTML =
        `<div class="source-error">${escape(error.message)}</div>`;
  }
}

// Handle internal navigation, project actions, source links, and tree expansion.
document.addEventListener('click', (event) => {
  const menuAction = event.target.closest('[data-analysis-action]');
  if (menuAction) {
    if (menuAction.disabled) return;
    menuAction.closest('details').open = false;
    runAnalysisAction(menuAction.dataset.analysisAction,
      menuAction.dataset.analysisKind, menuAction.dataset.analysisId);

    return;
  }
  // Close an open dropdown when interacting elsewhere on the page.
  document.querySelectorAll('.actions-dropdown[open]').forEach((menu) => {
    if (!menu.contains(event.target)) menu.open = false;
  });

  const nounButton = event.target.closest('[data-noun]');
  if (nounButton) {
    openNounDetails(nounButton.dataset.noun);

    return;
  }

  const sequenceItem = event.target.closest('[data-sequence-message], [data-sequence-participant]');
  if (sequenceItem && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    openSequenceDetails({
      messageNumber: Number(sequenceItem.dataset.sequenceMessage),
      participantId: sequenceItem.dataset.sequenceParticipant,
    });

    return;
  }

  const link = event.target.closest('a[href]');
  if (
    link &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !link.target &&
    !link.hasAttribute('download')
  ) {
    const url = new URL(link.href, location.href);
    if (
      url.origin === location.origin &&
      /^\/projects\/[a-zA-Z0-9_-]+\/(flows|directories|architecture|nouns|sequences|code-scan|all)(\/|$)/.test(url.pathname)
    ) {
      event.preventDefault();
      navigate(url.pathname);

      return;
    }
  }

  const action = event.target.closest('[data-action]');
  if (action) {
    if (action.dataset.action === 'add') showAddProject();
    else if (action.dataset.action === 'view-prompt') openJobPrompts();
    else if (action.dataset.action === 'dismiss-job') dismissJobProgress();
    else runAction(action.dataset.action);
    return;
  }

  if (event.target.closest('[data-scan-refresh]')) {
    const button = event.target.closest('[data-scan-refresh]');
    button.disabled = true;
    button.textContent = 'Scanning…';
    // Always restore the control after a failed or successful source reload.
    loadCurrentProject().finally(() => {
      button.disabled = false;
      button.textContent = 'Rescan';
    });
  }

  const source = event.target.closest('[data-source]');
  if (source) openSource(source.dataset.source, source.dataset.line, source.dataset.symbol);
  if (event.target.closest('[data-analysis-changes]')) openAnalysisChanges();
  const node = event.target.closest('button[data-node]');
  if (node) openNodeDetails(node.dataset.node);
  const toggle = event.target.closest('[data-expand]');
  if (toggle) {
    const path = toggle.dataset.expand;
    if (expanded.has(path)) expanded.delete(path);
    else expanded.add(path);
    const selected =
      flattenTree(data.tree).find(
        // Retain the selected directory while updating expanded tree nodes.
        (entry) => entry.path === currentRoute().selection,
      )?.path || '';
    selectElement('#tree-container').innerHTML =
      `<ul class="tree">${renderTree(data.tree, selected)}</ul>`;
  }
});

// Switch between the actual inputs generated for this job's analysis stages.
selectElement('#job-prompt-stage').addEventListener('change', renderSelectedJobPrompt);

// Inspect either artifact while retaining the currently selected analysis stage.
selectElement('.job-input-controls').addEventListener('click', (event) => {
  const button = event.target.closest('[data-job-input]');
  if (!button) return;
  jobInputKind = button.dataset.jobInput;
  renderSelectedJobPrompt();
});

// Dismiss the prompt viewer with its close control.
selectElement('#close-job-prompts').addEventListener('click', () =>
  selectElement('#job-prompts-dialog').close(),
);

// Invalidate pending prompt reads and restore focus when its trigger still exists.
selectElement('#job-prompts-dialog').addEventListener('close', () => {
  jobPromptRequest++;
  const dialog = selectElement('#job-prompts-dialog');
  if (dialog.dataset.projectId === data?.id && dialog.dataset.jobId === data?.job?.id)
    selectElement('[data-action="view-prompt"]')?.focus({ preventScroll: true });
});

// Close the prompt viewer only when the click falls outside its content bounds.
selectElement('#job-prompts-dialog').addEventListener('click', (event) => {
  const dialog = event.currentTarget;
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
});

// Close the analysis comparison and return focus to its trigger.
selectElement('#close-analysis-changes').addEventListener('click', () =>
  selectElement('#analysis-changes-dialog').close(),
);

// Dismiss the filename list only when the click is outside its visible bounds.
selectElement('#analysis-changes-dialog').addEventListener('click', (event) => {
  const dialog = selectElement('#analysis-changes-dialog');
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (
    event.clientX < bounds.left || event.clientX > bounds.right ||
    event.clientY < bounds.top || event.clientY > bounds.bottom
  ) dialog.close();
});

// Close the source preview from its close button.
selectElement('#close-source').addEventListener('click', () =>
  selectElement('#source-dialog').close(),
);
// Close the source preview when its backdrop is clicked.
selectElement('#source-dialog').addEventListener('click', (event) => {
  if (event.target === selectElement('#source-dialog')) selectElement('#source-dialog').close();
});
// Close concept details while leaving the inventory at its current scroll position.
selectElement('#close-noun-details').addEventListener('click', () =>
  selectElement('#noun-details-dialog').close(),
);

// Return focus to the matching card even if the inventory was refreshed while open.
selectElement('#noun-details-dialog').addEventListener('close', (event) => {
  const dialog = event.currentTarget;
  if (dialog.dataset.route !== location.pathname) return;
  selectElement(`[data-noun="${CSS.escape(dialog.dataset.nounId)}"]`)?.focus({ preventScroll: true });
});

// Dismiss concept details only when the pointer is outside the dialog's bounds.
selectElement('#noun-details-dialog').addEventListener('click', (event) => {
  const dialog = event.currentTarget;
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
});

// Dismiss the modification prompt without submitting a job.
selectElement('#close-modify-analysis').addEventListener('click', () =>
  selectElement('#modify-analysis-dialog').close('cancel'),
);

// Reject whitespace-only modification requests before closing the dialog.
selectElement('#modify-analysis-form').addEventListener('submit', (event) => {
  if (event.submitter?.value !== 'modify') return;
  const input = selectElement('#modification-prompt');
  input.setCustomValidity(input.value.trim() ? '' : 'Describe what you would like to change.');
  if (!input.reportValidity()) event.preventDefault();
});

// Clear a validation message as soon as the modification text is edited.
selectElement('#modification-prompt').addEventListener('input', (event) =>
  event.target.setCustomValidity(''),
);

// Close component details from their close button.
selectElement('#close-node').addEventListener('click', () => selectElement('#node-dialog').close());
// Return focus to the diagram when sequence details are dismissed.
selectElement('#close-sequence-details').addEventListener('click', () =>
  selectElement('#sequence-details-dialog').close(),
);

// Show the preceding message without closing the sequence details modal.
selectElement('#sequence-message-previous').addEventListener('click', () => stepSequenceMessage(-1));

// Show the following message without closing the sequence details modal.
selectElement('#sequence-message-next').addEventListener('click', () => stepSequenceMessage(1));

// Dismiss sequence details only when the click falls outside the modal bounds.
selectElement('#sequence-details-dialog').addEventListener('click', (event) => {
  if (event.target !== event.currentTarget) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  if (
    event.clientX < bounds.left || event.clientX > bounds.right ||
    event.clientY < bounds.top || event.clientY > bounds.bottom
  ) event.currentTarget.close();
});

// Delete the component selected in the architecture details dialog.
selectElement('#delete-node').addEventListener('click', deleteCurrentNode);
// Confirm deletion of the currently selected project.
selectElement('#delete-project').addEventListener('click', () => {
  selectElement('#project-actions').open = false;
  selectElement('#project-actions > summary').focus();
  runAction('delete');
});
// Cancel node deletion from its close button.
selectElement('#close-delete-node').addEventListener('click', () =>
  selectElement('#delete-node-dialog').close('no'),
);
// Cancel node deletion only when the click lies outside the dialog bounds.
selectElement('#delete-node-dialog').addEventListener('click', (event) => {
  if (event.target !== selectElement('#delete-node-dialog')) return;
  const bounds = event.target.getBoundingClientRect();
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  )
    event.target.close('no');
});
// Close component details only for clicks outside their bounds.
selectElement('#node-dialog').addEventListener('click', (event) => {
  if (event.target !== selectElement('#node-dialog')) return;
  const bounds = event.target.getBoundingClientRect();
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  )
    event.target.close();
});
// Cancel a project action from its close button.
selectElement('#close-action').addEventListener('click', () =>
  selectElement('#action-dialog').close('no'),
);
// Cancel a project action only when its backdrop is clicked.
selectElement('#action-dialog').addEventListener('click', (event) => {
  if (event.target !== selectElement('#action-dialog')) return;
  const bounds = event.target.getBoundingClientRect();
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  )
    event.target.close('no');
});
// Open project metadata from the first item in its overflow menu.
selectElement('#project-info').addEventListener('click', showProjectInfo);

// Dismiss project info and restore focus to the project's overflow trigger.
selectElement('#close-project-info').addEventListener('click', () =>
  selectElement('#project-info-dialog').close(),
);

// Close metadata only when clicking outside the dialog's content bounds.
selectElement('#project-info-dialog').addEventListener('click', (event) => {
  const dialog = event.currentTarget;
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
});

// Open the rename dialog beside the other project actions.
selectElement('#rename-project').addEventListener('click', showRenameProject);

// Persist a name only when the rename form is submitted.
selectElement('#rename-project-form').addEventListener('submit', saveProjectName);

// Dismiss name editing from its close button.
selectElement('#close-rename-project').addEventListener('click', () =>
  selectElement('#rename-project-dialog').close(),
);

// Dismiss name editing without submitting the form.
selectElement('#cancel-rename-project').addEventListener('click', () =>
  selectElement('#rename-project-dialog').close(),
);

// Close name editing only for clicks outside the dialog bounds.
selectElement('#rename-project-dialog').addEventListener('click', (event) => {
  if (event.target !== event.currentTarget) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  ) event.currentTarget.close();
});

selectElement('#add-project').addEventListener('click', showAddProject);
selectElement('#browse-directory').addEventListener('click', browseProjectDirectory);
// Abort an outstanding folder selection when registration closes.
selectElement('#project-dialog').addEventListener('close', () => directoryPickerRequest?.abort());
// Close project registration from its close button.
selectElement('#close-project').addEventListener('click', () =>
  selectElement('#project-dialog').close(),
);
// Close project registration when its backdrop is clicked.
selectElement('#project-dialog').addEventListener('click', (event) => {
  if (event.target === selectElement('#project-dialog')) selectElement('#project-dialog').close();
});
// Navigate to the selected project while keeping the current view.
selectElement('#project-picker').addEventListener('change', (event) =>
  navigate(projectUrl(currentRoute().tab, '', event.target.value)),
);
// Register the entered project and open its directory view.
selectElement('#project-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (directoryPickerRequest) return;
  const button = selectElement('#submit-project');
  button.disabled = true;
  selectElement('#project-form-error').textContent = '';

  try {
    const project = await postJson('/api/projects', {
      path: selectElement('#project-directory').value.trim(),
      name: selectElement('#new-project-name').value.trim(),
    });
    selectElement('#project-dialog').close();
    selectElement('#project-form').reset();
    await loadProjects();
    await navigate(projectUrl('directories', '', project.id));
  } catch (error) {
    selectElement('#project-form-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
// Remember unsent flow, architecture, and nouns requests per project.
document.addEventListener('input', (event) => {
  if (event.target.id === 'flow-feature') flowDrafts.set(data.id, event.target.value);
  if (event.target.id === 'architecture-question')
    architectureDrafts.set(data.id, event.target.value);
  if (event.target.id === 'sequence-question') sequenceDrafts.set(data.id, event.target.value);
  if (event.target.id === 'nouns-scope') nounsDrafts.set(data.id, event.target.value);
});
// Submit an independent analysis request and display validation failures.
document.addEventListener('submit', async (event) => {
  const form = analysisForms[event.target.id];
  if (!form || deletingProject || !data) return;
  event.preventDefault();
  const projectId = data.id;
  const feature = event.target.querySelector('textarea').value.trim();
  if (!feature && form.action !== 'nouns') return;
  event.target.querySelector('button').disabled = true;

  try {
    const job = await postJson(
      `/api/projects/${projectId}/${form.action}`,
      { [form.field]: feature },
    );
    form.drafts.delete(projectId);
    if (data?.id === projectId) {
      data.job = job;
      await loadCurrentProject();
    }
  } catch (error) {
    if (event.target.isConnected) {
      event.target.querySelector('.flow-error').textContent = error.message;
      event.target.querySelector('button').disabled = false;
    }
  }
});
// Restore the current project view after browser history navigation.
window.addEventListener('popstate', () => {
  loadCurrentProject();
});
// Focus directory search on the slash shortcut when no dialog or text input is active.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    // Return keyboard focus to the dropdown's trigger when dismissing it.
    document.querySelectorAll('.actions-dropdown[open]').forEach((menu) => {
      menu.open = false;
      menu.querySelector('summary').focus();
    });
  }
  if (
    event.key === '/' &&
    !selectElement('#source-dialog').open &&
    !selectElement('#job-prompts-dialog').open &&
    !selectElement('#project-dialog').open &&
    !selectElement('#project-info-dialog').open &&
    !selectElement('#rename-project-dialog').open &&
    !selectElement('#action-dialog').open &&
    !selectElement('#modify-analysis-dialog').open &&
    !selectElement('#node-dialog').open &&
    !selectElement('#noun-details-dialog').open &&
    !selectElement('#sequence-details-dialog').open &&
    !selectElement('#analysis-changes-dialog').open &&
    !['INPUT', 'TEXTAREA'].includes(event.target.tagName) &&
    selectElement('#directory-search')
  ) {
    event.preventDefault();
    selectElement('#directory-search').focus();
  }
});
await initializeApp();

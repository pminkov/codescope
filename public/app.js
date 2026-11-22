import { renderIcon } from './ui/icons.js';
import { renderAnalysisChanges, formatAnalysisDate } from './ui/analysis-controls.js';
import { renderSourcePreview } from './ui/source-preview.js';
import { renderEmptyProjectWorkspace, renderProjectLoadError } from './views/workspace.js';
import {
  renderDirectoriesView,
  renderDirectoryTree,
  renderDirectorySearchResults,
} from './views/directories.js';
import { renderFlowsView } from './views/flows.js';
import { renderNounsView, renderNounDetails } from './views/nouns.js';
import { renderSequencesView, renderSequenceDetails } from './views/sequences.js';
import { renderArchitectureView, renderNodeDetails } from './views/architecture.js';
import { renderAllAnalysesView } from './views/all-analyses.js';
import { renderJobProgress } from './views/job-progress.js';
import { escapeHtml as escape } from './content.js';
import {
  createJobDismissals,
  formatJobElapsed,
  getJobMessages,
  getJobDismissalDelay,
  getCompletedJobTargets,
} from './job-progress.js';
import { setupSequenceZoom } from './sequence-diagram.js';
import { routeGraphEdges } from './graph-routing.js';
import { getAnalysisEntries } from './analysis-list.js';
import { renderCodeScan } from './code-scan.js';
import { setupAsk } from './ask.js';
import { setupDialogStack } from './dialog-stack.js';

// Select a single UI element by its CSS selector.
const selectElement = (selector) => document.querySelector(selector);

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
const projectTabs = [
  'directories',
  'code-scan',
  'architecture',
  'flows',
  'nouns',
  'sequences',
  'all',
];
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
  else if (tab === 'flows')
    selected =
      data.flows.find(
        // Use the same first-flow fallback as the visible content.
        (flow) => flow.id === selection,
      ) || data.flows[0];
  if (tab === 'directories')
    selected =
      flattenTree(data.tree).find(
        // A missing directory is displayed as the project root by the directory view.
        (entry) => entry.type === 'directory' && entry.path === selection,
      ) || data.tree;
  if (tab === 'code-scan')
    selected =
      data.codeScan?.directories.find(
        // Code Scan defaults to its first directory containing source files.
        (directory) => directory.path === selection,
      ) || data.codeScan?.directories[0];
  const labels = {
    directories: 'Directories',
    'code-scan': 'Code Scan',
    architecture: 'Architecture',
    flows: 'Code flows',
    nouns: 'Nouns',
    sequences: 'Sequences',
    all: 'All analyses',
  };
  const detailDialog = dialogStack.latestDialog();
  const detail = detailDialog?.querySelector('h2')?.textContent;
  const title = selected?.title || selected?.path || labels[tab];

  const contextLabel = `${data.name} · ${labels[tab]}`;
  const selectionLabel = title !== labels[tab] ? ` · ${title}` : '';
  const detailLabel = detail ? ` · ${detail}` : '';

  return {
    projectId: data.id,
    view: tab,
    selection: selected?.id ?? selected?.path ?? '',
    label: `${contextLabel}${selectionLabel}${detailLabel}`.slice(0, 500),
  };
}

const ask = setupAsk(currentAskContext, openSource, dialogStack);

// Return every node in the browser's directory tree.
function flattenTree(node) {
  return [node, ...(node.children || []).flatMap(flattenTree)];
}

// Build a project route with safely encoded selection segments.
function projectUrl(tab, selection = '', id = data?.id) {
  const path = selection.split('/').map(encodeURIComponent).join('/');

  return `/projects/${id}/${tab}${selection ? `/${path}` : ''}`;
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

// Find the source comparison belonging to the analysis currently on screen.
function getSelectedAnalysisReview() {
  const { tab, selection } = currentRoute();
  if (tab === 'architecture') return getSelectedArchitecture();
  if (['flows', 'nouns', 'sequences'].includes(tab)) {
    const analyses =
      (tab === 'flows' ? data.flows : tab === 'sequences' ? data.sequences : data.nounAnalyses) ||
      [];
    return (
      analyses.find(
        // Match the same saved result used by the content view.
        (analysis) => analysis.id === selection,
      ) || analyses[0]
    );
  }

  return { title: 'Directory analysis', review: data.directoryReview };
}

// Show the selected analysis's timestamp and full source comparison without changing results.
function openAnalysisChanges() {
  const analysis = getSelectedAnalysisReview();
  const review = analysis?.review;
  if (!review?.available) return;
  const paths = [...new Set([...review.changedFiles, ...review.newFiles])].sort();
  const dialog = selectElement('#analysis-changes-dialog');
  const date = selectElement('#analysis-changes-date');
  date.hidden = !review.reviewedAt;
  date.dateTime = review.reviewedAt || '';
  date.textContent = review.reviewedAt ? `Analyzed ${formatAnalysisDate(review.reviewedAt)}` : '';

  selectElement('#analysis-changes-name').textContent = analysis.title;
  selectElement('#analysis-changes-title').textContent =
    `${paths.length} ${paths.length === 1 ? 'file' : 'files'} changed since this analysis`;
  selectElement('#analysis-changes-list').innerHTML = renderAnalysisChanges(paths, review);
  dialog.dataset.route = location.pathname;
  if (!dialog.open) dialog.showModal();
}

// Render the selected directory and attach its search behavior.
function renderDirectories() {
  const node =
    flattenTree(data.tree).find(
      // A missing directory falls back to the project root.
      (entry) => entry.type === 'directory' && entry.path === currentRoute().selection,
    ) || data.tree;
  const segments = node.path.split('/');
  for (let index = 0; index < segments.length; index++)
    expanded.add(segments.slice(0, index).join('/'));

  selectElement('#view').innerHTML = renderDirectoriesView(data, node, {
    query,
    expanded,
    projectUrl,
    actionsBusy: isAnalysisBusy(),
  });
  // Refresh only navigation when the user filters directories.
  selectElement('#directory-search').addEventListener('input', (event) => {
    query = event.target.value;
    const tree = renderDirectoryTree(data.tree, node.path, {
      expanded,
      query,
      projectName: data.name,
      directoryUrl,
    });
    selectElement('#tree-container').innerHTML = renderDirectorySearchResults(tree);
  });
}

// Render the selected flow and attach expansion tracking to its steps.
function renderFlows() {
  const selected =
    data.flows.find(
      // Restore a saved flow URL or select the first walkthrough.
      (flow) => flow.id === currentRoute().selection,
    ) || data.flows[0];
  selectElement('#view').innerHTML = renderFlowsView(data, selected, {
    draft: getAnalysisRequest('flows', flowDrafts),
    detailState,
    projectUrl,
    actionsBusy: isAnalysisBusy(),
  });
  if (!selected) return;
  const steps = selected.phases.flatMap(
    // Track every step across the entire walkthrough.
    (phase) => phase.steps,
  );
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

// Disable analysis actions while a request or worker is active.
function isAnalysisBusy() {
  return analysisActionPending || ['queued', 'running'].includes(data?.job?.status);
}

// Prefer an explicit draft, including an empty one, over the generated suggestion.
function getAnalysisRequest(kind, drafts) {
  if (drafts.has(data.id)) return drafts.get(data.id);
  const suggestion = data.nextPrompts?.[kind];

  return typeof suggestion === 'string' ? suggestion : '';
}

// Resolve the active nouns analysis consistently for cards and their detail dialog.
function getSelectedNounsAnalysis() {
  const analyses = data?.nounAnalyses || [];

  return (
    analyses.find(
      // Saved URLs select an analysis before falling back to the first available result.
      (analysis) => analysis.id === currentRoute().selection,
    ) || analyses[0]
  );
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
  selectElement('#noun-details-body').innerHTML = renderNounDetails(noun);
  // Show the complete evidence immediately, retaining the shared source-preview controls.
  dialog.querySelectorAll('.source-disclosure').forEach((disclosure) => {
    disclosure.open = true;
  });
  selectElement('#noun-details-body').scrollTop = 0;
  if (!dialog.open) dialog.showModal();
}

// Render nouns using the selected result and the current request draft.
function renderNouns() {
  selectElement('#view').innerHTML = renderNounsView(data, getSelectedNounsAnalysis(), {
    draft: getAnalysisRequest('nouns', nounsDrafts),
    projectUrl,
    actionsBusy: isAnalysisBusy(),
  });
}

// Restore the selected sequence diagram using the same fallback as its navigation.
function getSelectedSequence() {
  const analyses = data?.sequences || [];
  return (
    analyses.find(
      // Resolve saved bookmarks before falling back to the first diagram.
      (analysis) => analysis.id === currentRoute().selection,
    ) || analyses[0]
  );
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
  const messageLabel = message
    ? `MESSAGE ${String(messageNumber).padStart(2, '0')} · ${message.kind}`
    : '';
  selectElement('#sequence-details-kind').textContent = message
    ? `${messageLabel}${message.inferred ? ' · Inferred' : ''}`
    : 'PARTICIPANT';
  selectElement('#sequence-message-navigation').hidden = !message;
  selectElement('#sequence-message-previous').disabled = !message || messageNumber === 1;
  selectElement('#sequence-message-next').disabled =
    !message || messageNumber === analysis.messages.length;
  selectElement('#sequence-message-position').textContent = message
    ? `Message ${messageNumber} of ${analysis.messages.length}`
    : '';

  selectElement('#sequence-details-body').innerHTML = renderSequenceDetails(
    analysis,
    message,
    participant,
  );

  selectElement('#sequence-details-body').scrollTop = 0;
  if (!dialog.open) dialog.showModal();
}

// Step through this diagram's messages while retaining the open modal and its focus.
function stepSequenceMessage(direction) {
  const dialog = selectElement('#sequence-details-dialog');
  const analysis = getSelectedSequence();
  if (
    !dialog.open ||
    !dialog.dataset.messageNumber ||
    dialog.dataset.route !== location.pathname ||
    dialog.dataset.analysis !== analysis?.id
  )
    return;
  const messageNumber = Number(dialog.dataset.messageNumber) + direction;
  if (!Number.isInteger(messageNumber) || !analysis.messages[messageNumber - 1]) return;
  const focusedControl = document.activeElement;
  openSequenceDetails({ messageNumber });

  // Keep keyboard focus usable when the pressed button reaches a sequence boundary.
  if (focusedControl?.disabled)
    selectElement(direction > 0 ? '#sequence-message-previous' : '#sequence-message-next').focus({
      preventScroll: true,
    });
}

// Render the selected sequence and restore its zoom preferences.
function renderSequences() {
  const selected = getSelectedSequence();
  selectElement('#view').innerHTML = renderSequencesView(data, selected, {
    draft: getAnalysisRequest('sequences', sequenceDrafts),
    projectUrl,
    actionsBusy: isAnalysisBusy(),
  });
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

// Render the selected graph and attach measurement and highlighting behavior.
function renderArchitecture() {
  const graph = getSelectedArchitecture();
  selectElement('#view').innerHTML = renderArchitectureView(data, graph, {
    draft: getAnalysisRequest('architecture', architectureDrafts),
    projectUrl,
    actionsBusy: isAnalysisBusy(),
  });
  if (!graph) return;
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
  selectElement('#node-body').innerHTML = renderNodeDetails(graph, node);
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
  const connectionLabel = connections === 1 ? 'its connection' : `its ${connections} connections`;
  const lastNodeNotice =
    graph.nodes.length === 1 ? ' This is the last node, so the diagram will be empty.' : '';
  selectElement('#delete-node-description').textContent =
    `Delete “${node.title}”${connections ? ` and ${connectionLabel}` : ''}` +
    ` from “${graph.title}”?${lastNodeNotice}`;
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
    const graphUrl = `/api/projects/${projectId}/architecture/${encodeURIComponent(diagramId)}`;
    await postJson(`${graphUrl}/nodes/${encodeURIComponent(node.id)}/delete`);
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

// Show saved results in analysis date order.
function renderAllAnalyses() {
  selectElement('#view').innerHTML = renderAllAnalysesView(data, projectUrl);
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
  if (
    nounDialog.open &&
    (nounDialog.dataset.route !== location.pathname ||
      nounDialog.dataset.analysis !== nounsAnalysis?.id ||
      !nounsAnalysis?.nouns.some(
        // Close details when the selected concept no longer belongs to this result.
        (noun) => noun.id === nounDialog.dataset.nounId,
      ))
  ) {
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
      data.codeScan,
      currentRoute().selection,
      data.name,
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
  selectElement('#notice').innerHTML = /* HTML */ `
    <div class="warning">${escape(message)}</div>
  `;
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
  const nextControl =
    selectElement('.analysis-actions > summary') || selectElement('#project-actions > summary');
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
  selectElement('#job-input-label').textContent = schemaSelected
    ? 'Saved output schema'
    : 'Saved prompt';
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
  preview.setAttribute(
    'aria-label',
    schemaSelected ? 'Output schema supplied to Codex' : 'Exact prompt sent to Codex',
  );
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
      const message = pending
        ? 'The prompt will appear when the analysis stage starts.'
        : 'No saved prompt is available for this job.';
      status.textContent = `${message} Job files: ${result.directory}`;
      return;
    }

    const stage = selectElement('#job-prompt-stage');
    const options = result.prompts
      .map(
        // Name each generated stage using the progress panel's labels.
        (prompt) => /* HTML */ `
          <option value="${escape(prompt.stage)}">
            ${escape(jobTypeLabels[prompt.stage] || prompt.stage)}
          </option>
        `,
      )
      .join('');
    if (stage.innerHTML !== options) {
      const selected = stage.value;
      stage.innerHTML = options;
      stage.value = result.prompts.some(
        // Keep a manually selected earlier stage available as later stages start.
        (prompt) => prompt.stage === selected,
      )
        ? selected
        : result.prompts.at(-1).stage;
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
  const resultLinks = getCompletedJobTargets(data).map(
    // Route to the exact completed result regardless of the currently selected view.
    (target) => ({
      href: projectUrl(target.tab, target.selection),
      label: target.label,
    }),
  );
  const signature = JSON.stringify([
    data.id,
    job.id,
    job.kind,
    job.status,
    job.stage,
    job.startedAt,
    job.finishedAt,
    messages,
    job.coverage,
    resultLinks,
  ]);

  // Polling unchanged progress must not replay the incoming-message animation.
  if (!panel.firstElementChild || panel.dataset.signature !== signature) {
    const newMessage =
      panel.dataset.jobId === job.id && panel.dataset.latestMessage !== messages.at(-1)?.message;
    panel.innerHTML = renderJobProgress(job, {
      busy,
      completed,
      messages,
      newMessage,
      jobTypeLabels,
      resultLinks,
    });
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
  selectElement('#stack').innerHTML =
    data.stack
      .map(
        // Render a technology label in the project Info dialog.
        (label) => /* HTML */ `
          <span class="stack-label">${escape(label)}</span>
        `,
      )
      .join('') ||
    /* HTML */ `
      <span class="stack-empty">No stack tags yet.</span>
    `;
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

  for (const tab of projectTabs) selectElement(`#tab-${tab}`).href = projectUrl(tab);

  selectElement('.brand').href = projectUrl('directories');
  const messages = [];
  if (data.warnings?.length) messages.push(data.warnings.join(' '));
  selectElement('#notice').innerHTML = messages.length
    ? /* HTML */ `
        <div class="warning">${escape(messages.join(' '))}</div>
      `
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
          (project) => /* HTML */ `
            <option value="${project.id}">${escape(project.name)}</option>
          `,
        )
        .join('')
    : /* HTML */ `
        <option value="">No projects yet</option>
      `;
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
      history.replaceState(
        null,
        '',
        projectUrl(next.job.kind === 'sequence' ? 'sequences' : next.job.kind, next.job.resultId),
      );
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
    if (!data || data.id !== id) selectElement('#view').innerHTML = renderProjectLoadError();
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
    `Delete “${data.name}” from CodeScope? This removes its saved explanations, diagrams, ` +
    'flows, Nouns analyses, sequence analyses, and debugging job history. This cannot be undone.';
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
  const collections = {
    architecture: data.architectures,
    flows: data.flows,
    nouns: data.nounAnalyses,
    sequences: data.sequences,
  };

  return (
    collections[kind]?.find(
      // Use the captured ID so changing selection cannot delete a different result.
      (analysis) => analysis.id === id,
    )?.title || 'this analysis'
  );
}

// Confirm removal of one saved analysis using the shared confirmation dialog.
function confirmAnalysisDeletion(title) {
  const dialog = selectElement('#action-dialog');
  if (dialog.open) return Promise.resolve(false);
  selectElement('#action-project').textContent = data.name;
  selectElement('#action-title').textContent = 'Delete analysis?';
  selectElement('#action-description').textContent =
    `Delete “${title}”? This removes its saved result and cannot be undone.`;
  selectElement('#action-usage').textContent =
    'Your other analyses and source files stay in place.';
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
      dialog.addEventListener(
        'close',
        () => {
          modificationDrafts.set(key, input.value);
          resolve(dialog.returnValue === 'modify' ? input.value.trim() : null);
        },
        { once: true },
      );
      dialog.showModal();
    },
  );
}

// Apply one menu action and select its resulting copy or remaining analyses.
async function runAnalysisAction(action, kind, id) {
  if (
    !data ||
    analysisActionPending ||
    deletingProject ||
    ['queued', 'running'].includes(data.job?.status)
  )
    return;
  const projectId = data.id;
  const pathname = location.pathname;
  analysisActionPending = true;

  try {
    if (action === 'delete' && !(await confirmAnalysisDeletion(analysisTitle(kind, id)))) return;
    const prompt = action === 'modify' ? await promptForAnalysisModification(kind, id) : null;
    if (action === 'modify' && !prompt) return;
    if (data?.id !== projectId || location.pathname !== pathname) return;
    render();
    const url =
      kind === 'directories' && !data.hasDirectoryAnalysis && action === 'rerun'
        ? `/api/projects/${projectId}/directories`
        : analysisActionUrl(projectId, kind, id, action);
    const result = await postJson(url, action === 'modify' ? { prompt } : {});
    if (action === 'modify') modificationDrafts.delete(`${projectId}:${kind}:${id}`);
    if (data?.id !== projectId || currentRoute().id !== projectId) return;
    if (['rerun', 'modify'].includes(action)) data.job = result;
    else if (location.pathname === pathname)
      history.replaceState(
        null,
        '',
        projectUrl(kind, action === 'duplicate' ? result.analysisId : ''),
      );
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
        job.analysisId
          ? analysisActionUrl(
              projectId,
              job.kind === 'flow' ? 'flows' : job.kind === 'sequence' ? 'sequences' : job.kind,
              job.analysisId,
              job.modificationPrompt ? 'modify' : 'rerun',
            )
          : projectApiUrl(
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
      history.replaceState(
        null,
        '',
        projects.length ? projectUrl('directories', '', projects[0].id) : '/',
      );
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
  for (const counter of [
    'flow-count',
    'architecture-count',
    'nouns-count',
    'sequences-count',
    'all-count',
  ])
    selectElement(`#${counter}`).textContent = '0';
  for (const button of ['project-info', 'rename-project', 'delete-project'])
    selectElement(`#${button}`).disabled = true;
  selectElement('#view').innerHTML = renderEmptyProjectWorkspace();
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
      const oldHash = location.hash.match(
        /^#(flows|directories|architecture|nouns|sequences|code-scan|all)(?:\/(.*))?$/,
      );
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
  selectElement('#source-body').innerHTML = /* HTML */ `
    <div class="loading">Loading source…</div>
  `;
  if (!dialog.open) dialog.showModal();

  try {
    const result = await fetchJson(`${projectApiUrl('source')}?path=${encodeURIComponent(path)}`);
    if (requestId !== sourceRequest || !dialog.open) return;
    const lines = result.content.split('\n');
    selectElement('#source-body').innerHTML = renderSourcePreview(lines, targetLine, finalLine);
    selectElement(`#source-line-${Math.min(targetLine, lines.length)}`)?.scrollIntoView({
      block: 'center',
    });
  } catch (error) {
    if (requestId === sourceRequest)
      selectElement('#source-body').innerHTML = /* HTML */ `
        <div class="source-error">${escape(error.message)}</div>
      `;
  }
}

// Recognize internal project views using the same tabs as route parsing.
function isProjectViewUrl(pathname) {
  const match = pathname.match(/^\/projects\/[a-zA-Z0-9_-]+\/([^/]+)(?:\/|$)/);

  return Boolean(match && projectTabs.includes(match[1]));
}

// Handle internal navigation, project actions, source links, and tree expansion.
document.addEventListener('click', (event) => {
  const menuAction = event.target.closest('[data-analysis-action]');
  if (menuAction) {
    if (menuAction.disabled) return;
    menuAction.closest('details').open = false;
    runAnalysisAction(
      menuAction.dataset.analysisAction,
      menuAction.dataset.analysisKind,
      menuAction.dataset.analysisId,
    );

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
    if (url.origin === location.origin && isProjectViewUrl(url.pathname)) {
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
    selectElement('#tree-container').innerHTML = renderDirectorySearchResults(
      renderDirectoryTree(data.tree, selected, {
        expanded,
        query,
        projectName: data.name,
        directoryUrl,
      }),
    );
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
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  )
    dialog.close();
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
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  )
    dialog.close();
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
  selectElement(`[data-noun="${CSS.escape(dialog.dataset.nounId)}"]`)?.focus({
    preventScroll: true,
  });
});

// Dismiss concept details only when the pointer is outside the dialog's bounds.
selectElement('#noun-details-dialog').addEventListener('click', (event) => {
  const dialog = event.currentTarget;
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  )
    dialog.close();
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
selectElement('#sequence-message-previous').addEventListener('click', () =>
  stepSequenceMessage(-1),
);

// Show the following message without closing the sequence details modal.
selectElement('#sequence-message-next').addEventListener('click', () => stepSequenceMessage(1));

// Dismiss sequence details only when the click falls outside the modal bounds.
selectElement('#sequence-details-dialog').addEventListener('click', (event) => {
  if (event.target !== event.currentTarget) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  )
    event.currentTarget.close();
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
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  )
    dialog.close();
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
  )
    event.currentTarget.close();
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
    const job = await postJson(`/api/projects/${projectId}/${form.action}`, {
      [form.field]: feature,
    });
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

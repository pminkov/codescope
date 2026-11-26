import { renderIcon } from './ui/icons.js';
import { renderAnalysisChanges, formatAnalysisDate } from './ui/analysis-controls.js';
import { renderNewAnalysisFormContent } from './ui/new-analysis.js';
import { renderSourcePreview } from './ui/source-preview.js';
import {
  renderEmptyDemoView, renderEmptyProjectWorkspace, renderProjectLoadError,
} from './views/workspace.js';
import {
  renderDirectoriesView,
  renderDirectoryTree,
  renderDirectorySearchResults,
} from './views/directories.js';
import { renderFlowsView } from './views/flows.js';
import { renderNounsView, renderNounDetails } from './views/nouns.js';
import { renderAreasView } from './views/areas.js';
import { renderEndpointsView } from './views/endpoints.js';
import { renderSequencesView, renderSequenceDetails } from './views/sequences.js';
import {
  renderPresentationsView,
  renderPresentationSlide,
  renderPresentationNotes,
} from './views/presentations.js';
import { renderArchitectureView, renderNodeDetails } from './views/architecture.js';
import { renderAllAnalysesView } from './views/all-analyses.js';
import { renderJobProgress } from './views/job-progress.js';
import { escapeHtml as escape } from './content.js';
import {
  createJobDismissals,
  formatJobElapsed,
  getJobMessages,
  getJobDismissalDelay,
  getJobAnalysisTargets,
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

const isDemo = document.documentElement.hasAttribute('data-demo');
let demoExcerpts;
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
let settingsRequest = 0;
let deletingNode = false;
let deletingProject = false;
let renamingProject = false;
let analysisActionPending = false;
const analysisDrafts = new Map();
const newAnalysisDialog = selectElement('#new-analysis-dialog');
const newAnalysisForm = selectElement('#new-analysis-form');
const presentationSlides = new Map();
const modificationDrafts = new Map();
const projectTabs = [
  'directories',
  'code-scan',
  'architecture',
  'areas',
  'flows',
  'nouns',
  'sequences',
  'endpoints',
  'presentations',
  'all',
];
const jobTypeLabels = {
  initial: 'Directories + architecture',
  directories: 'Directories',
  architecture: 'Architecture',
  flow: 'Code flow',
  nouns: 'Nouns',
  areas: 'Areas',
  sequence: 'Sequence diagram',
  endpoints: 'Endpoints',
  presentation: 'Presentation',
};
const jobTabs = { flow: 'flows', sequence: 'sequences', presentation: 'presentations' };
const dialogStack = setupDialogStack();

// Describe the actual selected result, including the UI's default selections.
function currentAskContext() {
  if (!data || currentRoute().id !== data.id || deletingProject) return null;
  const { tab, selection } = currentRoute();
  let selected;
  if (tab === 'architecture') selected = getSelectedArchitecture();
  else if (tab === 'areas') selected = getSelectedAreasAnalysis();
  else if (tab === 'nouns') selected = getSelectedNounsAnalysis();
  else if (tab === 'endpoints') selected = getSelectedEndpointsAnalysis();
  else if (tab === 'sequences') selected = getSelectedSequence();
  else if (tab === 'presentations') selected = getSelectedPresentation();
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
    areas: 'Areas',
    sequences: 'Sequences',
    endpoints: 'Endpoints',
    presentations: 'Presentation',
    all: 'All analyses',
  };
  const detailDialog = dialogStack.latestDialog();
  const detail = detailDialog?.querySelector('h2')?.textContent;
  const area = tab === 'areas' ? selected?.areas.find(
    // Keep Ask focused on the same responsibility as the visible drill-down level.
    (entry) => entry.id === selection.split('/')[1],
  ) : null;
  const title = selected?.title || selected?.path || labels[tab];

  const contextLabel = `${data.name} · ${labels[tab]}`;
  const selectionLabel = title !== labels[tab] ? ` · ${title}` : '';
  const detailLabel = detail || area ? ` · ${detail || area.name}` : '';

  return {
    projectId: data.id,
    view: tab,
    selection: area ? `${selected.id}/${area.id}` : selected?.id ?? selected?.path ?? '',
    label: `${contextLabel}${selectionLabel}${detailLabel}`.slice(0, 500),
  };
}

const ask = isDemo ? null : setupAsk(currentAskContext, openSource, dialogStack);

// Return every node in the browser's directory tree.
function flattenTree(node) {
  return [node, ...(node.children || []).flatMap(flattenTree)];
}

// Build a project route with safely encoded selection segments.
function projectUrl(tab, selection = '', id = data?.id) {
  const path = selection.split('/').map(encodeURIComponent).join('/');

  const prefix = isDemo ? '#' : `/projects/${id}`;
  return `${prefix}/${tab}${selection ? `/${path}` : ''}`;
}

// Build the directory view URL for a source path.
function directoryUrl(path) {
  return projectUrl('directories', path);
}

// Compare routes by fragment on a static host and by pathname on the local server.
function currentRouteLocation() {
  return isDemo ? location.hash : location.pathname;
}

// Read the selected project, view, and item from the current URL.
function currentRoute() {
  const parts = currentRouteLocation().slice(isDemo ? 2 : 1).split('/');
  const id = isDemo ? data?.id : parts[0] === 'projects' ? parts.splice(0, 2)[1] : null;
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
  else if (url !== currentRouteLocation()) history.pushState(null, '', url);
  if (isDemo) render();
  else await loadCurrentProject();
  if (currentRoute().tab === 'areas')
    selectElement('.area-breadcrumb [aria-current="page"]')?.focus({ preventScroll: true });
}

// Apply the chosen theme and remember the browser preference.
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  syncPresentationDownloadTheme();
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
  if (tab === 'areas') return getSelectedAreasAnalysis();
  if (['flows', 'nouns', 'sequences', 'endpoints', 'presentations'].includes(tab)) {
    const analyses = ({
      flows: data.flows, nouns: data.nounAnalyses, sequences: data.sequences,
      endpoints: data.endpointAnalyses,
      presentations: data.presentations,
    })[tab] || [];
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
  dialog.dataset.route = currentRouteLocation();
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

// Resolve a saved deck using the same default as its navigation and Ask context.
function getSelectedPresentation() {
  const decks = data?.presentations || [];
  return decks.find(
    // Stable IDs preserve independent presentations across reloads and browser history.
    (deck) => deck.id === currentRoute().selection,
  ) || decks[0];
}

// Restore slide position per deck while accommodating shorter regenerated presentations.
function selectedPresentationIndex(deck) {
  return Math.min(presentationSlides.get(`${data.id}:${deck.id}`) || 0, deck.slides.length - 1);
}

// Keep the portable deck in the theme currently shown in the workspace.
function syncPresentationDownloadTheme() {
  const link = selectElement('#presentation-html-download');
  if (!link) return;

  const url = new URL(link.href);
  url.searchParams.set('theme', document.documentElement.dataset.theme);
  link.search = url.search;
}

// Render the selected presentation at its current slide.
function renderPresentations() {
  const deck = getSelectedPresentation();
  selectElement('#view').innerHTML = renderPresentationsView(data, deck, {
    projectUrl,
    actionsBusy: isAnalysisBusy(),
    slideIndex: deck ? selectedPresentationIndex(deck) : 0,
  });
  syncPresentationDownloadTheme();
}

// Change only the slide and its supporting UI so fullscreen survives navigation.
function changePresentationSlide(index) {
  const deck = getSelectedPresentation();
  if (!deck || !Number.isInteger(index)) return;
  const position = Math.max(0, Math.min(index, deck.slides.length - 1));
  presentationSlides.set(`${data.id}:${deck.id}`, position);
  selectElement('#presentation-slide').innerHTML = renderPresentationSlide(
    deck.slides[position], position, deck.slides.length, data.name,
  );
  selectElement('.presentation-notes').innerHTML = renderPresentationNotes(deck.slides[position]);
  if (isDemo) updateDemoSourceControls(selectElement('.presentation-notes'));
  selectElement('[data-slide-position]').textContent =
    `Slide ${position + 1} of ${deck.slides.length}`;
  selectElement('[data-presentation-action="previous"]').disabled = position === 0;
  selectElement('[data-presentation-action="next"]').disabled = position === deck.slides.length - 1;
  // Keep the outline's accessible selection in sync without moving the page scroll position.
  document.querySelectorAll('[data-presentation-slide]').forEach((button) => {
    if (Number(button.dataset.presentationSlide) === position)
      button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
  selectElement('.presentation-stage').focus({ preventScroll: true });
}

// Enter native fullscreen when supported, retaining a usable in-page fallback.
async function runPresentationAction(action) {
  const deck = getSelectedPresentation();
  const stage = selectElement('.presentation-stage');
  if (!deck || !stage) return;
  const index = selectedPresentationIndex(deck);
  if (action === 'previous' || action === 'next') {
    changePresentationSlide(index + (action === 'next' ? 1 : -1));
    return;
  }
  if (action === 'exit') {
    stage.classList.remove('is-presenting');
    if (document.fullscreenElement === stage) await document.exitFullscreen();
    stage.focus({ preventScroll: true });
    return;
  }
  if (action !== 'present') return;
  try {
    if (!stage.requestFullscreen) throw new Error('Fullscreen unavailable.');
    await stage.requestFullscreen();
  } catch {
    stage.classList.add('is-presenting');
  }
  stage.focus({ preventScroll: true });
}

// Render the selected flow and attach expansion tracking to its steps.
function renderFlows() {
  const selected =
    data.flows.find(
      // Restore a saved flow URL or select the first walkthrough.
      (flow) => flow.id === currentRoute().selection,
    ) || data.flows[0];
  selectElement('#view').innerHTML = renderFlowsView(data, selected, {
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

    render();
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

// Resolve a saved map independently of its selected nested area.
function getSelectedAreasAnalysis() {
  const id = currentRoute().selection.split('/')[0];
  const analyses = data?.areaAnalyses || [];

  return analyses.find(
    // The first selection segment identifies the saved map; the second identifies a box.
    (analysis) => analysis.id === id,
  ) || analyses[0];
}

// Render only the selected map level while keeping its hierarchy in the URL.
function renderAreas() {
  selectElement('#view').innerHTML = renderAreasView(data, getSelectedAreasAnalysis(), {
    areaId: currentRoute().selection.split('/')[1] || '',
    projectUrl,
    actionsBusy: isAnalysisBusy(),
  });
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
  dialog.dataset.route = currentRouteLocation();
  dialog.dataset.analysis = analysis.id;
  dialog.dataset.nounId = noun.id;
  selectElement('#noun-details-title').textContent = noun.name;
  selectElement('#noun-details-body').innerHTML = renderNounDetails(noun);
  // Show the complete evidence immediately, retaining the shared source-preview controls.
  dialog.querySelectorAll('.source-disclosure').forEach((disclosure) => {
    disclosure.open = true;
  });
  if (isDemo) updateDemoSourceControls(dialog);
  selectElement('#noun-details-body').scrollTop = 0;
  if (!dialog.open) dialog.showModal();
}

// Render the selected noun inventory and its saved scopes.
function renderNouns() {
  selectElement('#view').innerHTML = renderNounsView(data, getSelectedNounsAnalysis(), {
    projectUrl,
    actionsBusy: isAnalysisBusy(),
  });
}

// Resolve the single project-wide inventory for rendering, Ask, and saved-result actions.
function getSelectedEndpointsAnalysis() {
  return data?.endpointAnalyses?.at(-1);
}

// Show endpoint discovery or the saved inventory with its freshness and rerun controls.
function renderEndpoints() {
  selectElement('#view').innerHTML = renderEndpointsView(data, getSelectedEndpointsAnalysis(), {
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
  dialog.dataset.route = currentRouteLocation();
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

  if (isDemo) updateDemoSourceControls(dialog);
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
    dialog.dataset.route !== currentRouteLocation() ||
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
  if (isDemo) updateDemoSourceControls(dialog);
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
  if (changesDialog.open && changesDialog.dataset.route !== currentRouteLocation())
    changesDialog.close();
  const sequenceDialog = selectElement('#sequence-details-dialog');
  if (sequenceDialog.open && sequenceDialog.dataset.route !== currentRouteLocation()) {
    selectElement('#source-dialog').close();
    sequenceDialog.close();
  }
  const nounDialog = selectElement('#noun-details-dialog');
  const nounsAnalysis = getSelectedNounsAnalysis();
  if (
    nounDialog.open &&
    (nounDialog.dataset.route !== currentRouteLocation() ||
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
  if (modificationDialog.open && modificationDialog.dataset.route !== currentRouteLocation())
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

  const savedAnalyses = {
    flows: data.flows, architecture: data.architectures, areas: data.areaAnalyses,
    nouns: data.nounAnalyses, sequences: data.sequences, endpoints: data.endpointAnalyses,
    presentations: data.presentations,
  };
  if (isDemo && savedAnalyses[tab]?.length === 0) {
    const label = selectElement(`#tab-${tab}`).textContent.replace(/\d+/g, '').trim();
    selectElement('#view').innerHTML = renderEmptyDemoView(label);
  } else if (tab === 'flows') renderFlows();
  else if (tab === 'architecture') renderArchitecture();
  else if (tab === 'areas') renderAreas();
  else if (tab === 'nouns') renderNouns();
  else if (tab === 'endpoints') renderEndpoints();
  else if (tab === 'sequences') renderSequences();
  else if (tab === 'presentations') renderPresentations();
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
  if (isDemo) updateDemoSourceControls(selectElement('#view'));
  ask?.refresh();
}

// Fetch JSON and surface API errors as readable exceptions.
async function fetchJson(url, options) {
  if (isDemo && url !== './project.json') throw new Error('Available in the local app.');
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
  const resultLinks = getJobAnalysisTargets(data).map(
    // Open the active analysis view or its saved result from any other tab.
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
      actionsOpen: panel.dataset.jobId === job.id &&
        Boolean(panel.querySelector('.job-actions[open]')),
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
  selectElement('#project-info-title').textContent = data.name;
  selectElement('#project-path').textContent = data.root || '';
  selectElement('#project-path').title = data.root || '';
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
  selectElement('#areas-count').textContent = (data.areaAnalyses || []).length;
  selectElement('#nouns-count').textContent = (data.nounAnalyses || []).length;
  selectElement('#sequences-count').textContent = (data.sequences || []).length;
  selectElement('#presentations-count').textContent = (data.presentations || []).length;
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
  renderProjectPicker();
}

// Populate the project picker from the current registry or the exported project.
function renderProjectPicker() {
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
  selectElement('#project-picker').disabled = isDemo || !projects.length;
  if (data) selectElement('#project-picker').value = data.id;
}

// Load the current project, reject stale responses, and poll active jobs.
async function loadCurrentProject({ quiet = false } = {}) {
  if (deletingProject) return;
  if (newAnalysisDialog.open && newAnalysisDialog.dataset.route !== currentRouteLocation())
    newAnalysisDialog.close();
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
      ['architecture', 'areas', 'nouns', 'sequence', 'presentation'].includes(next.job.kind) &&
      next.job.resultId &&
      !next.job.analysisId &&
      currentRoute().tab === (jobTabs[next.job.kind] || next.job.kind)
    )
      history.replaceState(
        null,
        '',
        projectUrl(jobTabs[next.job.kind] || next.job.kind, next.job.resultId),
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
    'flows, areas, noun and endpoint analyses, sequences, presentations, ' +
    'and debugging job history. ' +
    'This cannot be undone.';
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
    areas: data.areaAnalyses,
    nouns: data.nounAnalyses,
    sequences: data.sequences,
    endpoints: data.endpointAnalyses,
    presentations: data.presentations,
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

// Restore this project's draft or suggested prompt in the shared creation dialog.
function openNewAnalysisDialog(kind) {
  const { id, tab } = currentRoute();
  if (!data || isDemo || deletingProject || isAnalysisBusy() || newAnalysisDialog.open ||
    id !== data.id || tab !== kind) return;

  if (!analysisDrafts.has(id)) analysisDrafts.set(id, new Map());
  const drafts = analysisDrafts.get(id);
  const suggestion = data.nextPrompts?.[kind];
  newAnalysisForm.innerHTML = renderNewAnalysisFormContent(kind, data.name);
  const input = newAnalysisForm.querySelector('textarea');
  input.value = drafts.get(kind) ?? (typeof suggestion === 'string' ? suggestion : '');

  // Keep deliberate edits, including an emptied suggestion, when the dialog is dismissed.
  input.addEventListener('input', () => {
    drafts.set(kind, input.value);
    input.setCustomValidity('');
    selectElement('#new-analysis-error').textContent = '';
  });
  newAnalysisDialog.dataset.route = currentRouteLocation();
  newAnalysisDialog.showModal();
}

// Start the requested analysis and hand the accepted job to the existing progress view.
async function submitNewAnalysis(event) {
  event.preventDefault();
  const { id, tab } = currentRoute();
  if (!newAnalysisDialog.open || newAnalysisDialog.dataset.route !== currentRouteLocation() ||
    data?.id !== id || deletingProject || isAnalysisBusy()) return;

  const input = newAnalysisForm.querySelector('textarea');
  const prompt = input.value.trim();
  if (input.required && !prompt) {
    input.setCustomValidity('Enter a request before starting the analysis.');
    input.reportValidity();
    return;
  }

  const button = newAnalysisForm.querySelector('[type="submit"]');
  const label = button.textContent;
  const errorMessage = selectElement('#new-analysis-error');
  errorMessage.textContent = '';
  analysisActionPending = true;
  input.readOnly = true;
  button.disabled = true;
  button.textContent = 'Starting…';

  try {
    const job = await postJson(projectApiUrl(tab), { [input.name]: prompt });
    analysisDrafts.get(id)?.delete(tab);
    if (data?.id !== id || currentRoute().id !== id) return;
    data.job = job;
    newAnalysisDialog.close();
    renderJob();
  } catch (error) {
    if (newAnalysisDialog.open) errorMessage.textContent = error.message;
    else if (currentRoute().id === id) showError(error.message);
    return;
  } finally {
    analysisActionPending = false;
    input.readOnly = false;
    button.disabled = false;
    button.textContent = label;
    if (data && data.id === currentRoute().id) render();
  }

  await loadCurrentProject();
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
  dialog.dataset.route = currentRouteLocation();

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
  const pathname = currentRouteLocation();
  analysisActionPending = true;

  try {
    if (action === 'delete' && !(await confirmAnalysisDeletion(analysisTitle(kind, id)))) return;
    const prompt = action === 'modify' ? await promptForAnalysisModification(kind, id) : null;
    if (action === 'modify' && !prompt) return;
    if (data?.id !== projectId || currentRouteLocation() !== pathname) return;
    render();
    const url =
      kind === 'directories' && !data.hasDirectoryAnalysis && action === 'rerun'
        ? `/api/projects/${projectId}/directories`
        : analysisActionUrl(projectId, kind, id, action);
    const result = await postJson(url, action === 'modify' ? { prompt } : {});
    if (action === 'modify') modificationDrafts.delete(`${projectId}:${kind}:${id}`);
    if (data?.id !== projectId || currentRoute().id !== projectId) return;
    if (['rerun', 'modify'].includes(action)) data.job = result;
    else if (currentRouteLocation() === pathname)
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
              jobTabs[job.kind] || job.kind,
              job.analysisId,
              job.modificationPrompt ? 'modify' : 'rerun',
            )
          : projectApiUrl(
              job.kind === 'presentation' ? 'presentations' : job.kind === 'sequence'
                ? 'sequences'
                : job.kind === 'flow'
                  ? 'flows'
                  : ['architecture', 'areas', 'nouns', 'endpoints', 'directories']
                    .includes(job.kind)
                    ? job.kind
                    : 'analysis',
            ),
        job.modificationPrompt
          ? { prompt: job.modificationPrompt }
          : job.kind === 'presentation' ? { topic: job.feature } : job.kind === 'flow'
            ? { feature: job.feature }
            : ['architecture', 'sequence'].includes(job.kind)
              ? { question: job.feature }
              : ['nouns', 'areas'].includes(job.kind)
                ? { scope: job.feature || '' }
                : {},
      );
    } else {
      const result = await postJson(projectApiUrl(action));
      if (['directories', 'endpoints'].includes(action) && data?.id === projectId)
        data.job = result;
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
    analysisDrafts.delete(id);
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
    selectElement('#project-picker').disabled = isDemo || !projects.length;
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
  ask?.refresh();
  diagramObserver?.disconnect();
  diagramObserver = undefined;
  document.title = 'CodeScope · Understand your projects';
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
    'areas-count',
    'sequences-count',
    'presentations-count',
    'all-count',
  ])
    selectElement(`#${counter}`).textContent = '0';
  for (const button of ['project-info', 'rename-project', 'delete-project'])
    selectElement(`#${button}`).disabled = true;
  selectElement('#view').innerHTML = renderEmptyProjectWorkspace();
}

// Load application settings each time the storage dialog opens.
async function showAppSettings() {
  const dialog = selectElement('#settings-dialog');
  if (dialog.open) return;

  const request = ++settingsRequest;
  const storage = selectElement('#settings-storage');
  const status = selectElement('#settings-status');
  storage.hidden = true;
  status.textContent = 'Loading storage location…';
  dialog.showModal();

  try {
    const { dataDirectory } = await fetchJson('/api/settings');
    if (!dialog.open || request !== settingsRequest) return;

    selectElement('#settings-data-directory').textContent = dataDirectory;
    storage.hidden = false;
    status.textContent = '';
  } catch {
    if (!dialog.open || request !== settingsRequest) return;
    status.textContent = 'Could not load the data folder. Close and reopen Settings to retry.';
  }
}

// Copy the displayed path and report the result within the current settings dialog.
async function copyDataDirectory() {
  const dialog = selectElement('#settings-dialog');
  const request = settingsRequest;
  const path = selectElement('#settings-data-directory').textContent;
  let message;

  try {
    await navigator.clipboard.writeText(path);
    message = 'Path copied.';
  } catch {
    message = 'Could not copy automatically. You can select and copy the path above.';
  }

  if (dialog.open && request === settingsRequest)
    selectElement('#settings-status').textContent = message;
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
    if (isDemo) {
      await initializeDemo();
      return;
    }
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
        new RegExp(`^#(${projectTabs.join('|')})(?:/(.*))?$`),
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

    // Select the registered project before its slower source scan finishes.
    const project = projects.find(
      // Match direct links and restored project selections against the registry.
      (entry) => entry.id === currentRoute().id,
    );
    if (project) selectElement('#project-picker').value = project.id;

    await loadCurrentProject();
  } catch (error) {
    showError(error.message);
  }
}

// Load the exported display data once, including on a direct link to a saved result.
async function initializeDemo() {
  const snapshot = await fetchJson('./project.json');
  data = snapshot.project;
  demoExcerpts = snapshot.excerpts;
  projects = [data];
  renderProjectPicker();
  selectElement('.demo-label').hidden = false;
  const launcher = selectElement('#ask-launcher');
  launcher.title = 'Ask is available in the local app';
  launcher.setAttribute('aria-label', launcher.title);
  const populated = data.architectures.filter(
    // Empty diagrams have no components for a visitor to explore.
    (graph) => graph.nodes.length,
  );
  const overview = populated.find(
    // Prefer the populated system overview as the first screen of the demo.
    (graph) => graph.id === 'overview',
  ) || populated[0];
  if (!location.hash.startsWith('#/')) {
    const url = overview ? projectUrl('architecture', overview.id) : projectUrl('directories');
    history.replaceState(null, '', url);
  }
  updateHeader();
  render();
}

// Find the published range containing a citation, or all excerpts for a file-level link.
function findDemoExcerpts(path, line) {
  const excerpts = Object.hasOwn(demoExcerpts, path) ? demoExcerpts[path] : [];
  if (line == null) return excerpts;
  return excerpts.filter(
    // A code scan symbol can be previewed if its line falls within a published range.
    (excerpt) => line >= excerpt.start && line < excerpt.start + excerpt.lines.length,
  );
}

// Mark unpublished sources where their controls appear, including inside detail dialogs.
function updateDemoSourceControls(container) {
  for (const control of container.querySelectorAll('[data-source]')) {
    if (findDemoExcerpts(control.dataset.source, control.dataset.line).length) {
      control.title = control.classList.contains('stale-source')
        ? 'File changed since analysis. View exported excerpt.'
        : 'View exported source excerpt';
    } else {
      control.disabled = true;
      control.title = 'Source excerpt omitted from this demo';
    }
  }
}

// Open a read-only source preview and ignore obsolete fetch responses.
async function openSource(path, line, symbol = '', endLine = line, stale = false) {
  const requestId = ++sourceRequest;
  const dialog = selectElement('#source-dialog');
  const targetLine = Math.max(1, Number(line) || 1);
  selectElement('#source-title').textContent = `/${path.replace(/^\/+/, '')}`;
  const finalLine = Math.max(targetLine, Number(endLine) || targetLine);
  const sourceLabel = symbol.endsWith('()') || symbol.includes(' ') ? symbol : `${symbol}()`;
  if (isDemo) {
    const excerpts = findDemoExcerpts(path, line);
    if (!excerpts.length) return;
    const context = ['Exported source excerpt'];
    if (symbol) context.push(sourceLabel);
    if (stale) context.push('File changed since analysis');
    selectElement('#source-context').textContent = context.join(' · ');
    selectElement('#source-body').innerHTML = excerpts.map(
      // Preserve file line numbers and separate noncontiguous excerpts.
      ({ start, lines }) => renderSourcePreview(lines, targetLine, finalLine, start),
    ).join('');
    if (!dialog.open) dialog.showModal();
    selectElement(`#source-line-${targetLine}`)?.scrollIntoView({ block: 'center' });
    return;
  }
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
  const slideButton = event.target.closest('[data-presentation-slide]');
  if (slideButton) {
    changePresentationSlide(Number(slideButton.dataset.presentationSlide));
    return;
  }
  const presentationAction = event.target.closest('[data-presentation-action]');
  if (presentationAction) {
    runPresentationAction(presentationAction.dataset.presentationAction).catch(
      // Surface fullscreen errors without interrupting ordinary slide navigation.
      (error) => showError(error.message),
    );
    return;
  }
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

  const newAnalysis = event.target.closest('[data-new-analysis]');
  if (newAnalysis) {
    openNewAnalysisDialog(newAnalysis.dataset.newAnalysis);
    return;
  }

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
    link.closest('.job-actions')?.removeAttribute('open');
    const url = new URL(link.href, location.href);
    const internal = isDemo
      ? url.pathname === location.pathname && url.hash.startsWith('#/')
      : isProjectViewUrl(url.pathname);
    if (url.origin === location.origin && internal) {
      event.preventDefault();
      navigate(isDemo ? url.hash : url.pathname);

      return;
    }
  }

  const action = event.target.closest('[data-action]');
  if (action) {
    action.closest('.job-actions')?.removeAttribute('open');
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
  if (source && !source.disabled) {
    openSource(source.dataset.source, source.dataset.line, source.dataset.symbol,
      source.dataset.endLine, source.classList.contains('stale-source'));
  }
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
  if (dialog.dataset.route !== currentRouteLocation()) return;
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
// Open application settings from the toolbar, independent of the current project.
selectElement('#app-settings').addEventListener('click', showAppSettings);
// Copy the exact storage path shown in Settings.
selectElement('#copy-data-directory').addEventListener('click', copyDataDirectory);

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

// Submit the shared form to the current analysis endpoint.
newAnalysisForm.addEventListener('submit', submitNewAnalysis);

// Dismiss the new-analysis form from either close control or its backdrop.
newAnalysisDialog.addEventListener('click', (event) => {
  if (event.target === newAnalysisDialog || event.target.closest('[data-close-new-analysis]'))
    newAnalysisDialog.close();
});

// Return focus to the current trigger even if the project view refreshed behind the dialog.
newAnalysisDialog.addEventListener('close', () => {
  if (!newAnalysisDialog.open && newAnalysisDialog.dataset.route === currentRouteLocation())
    selectElement('[data-new-analysis]:enabled')?.focus({ preventScroll: true });
});

// Restore the current project view after browser history navigation.
window.addEventListener('popstate', () => {
  if (isDemo) render();
  else loadCurrentProject();
});

// Navigate slides only when a presentation is visible and no text field or dialog owns input.
document.addEventListener('keydown', (event) => {
  if (currentRoute().tab !== 'presentations' || !selectElement('.presentation-stage') ||
    event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
    event.target.closest('input, textarea, select, [contenteditable="true"], dialog') ||
    document.querySelector('dialog[open]') || !selectElement('#ask-panel').hidden) return;
  const deck = getSelectedPresentation();
  const index = selectedPresentationIndex(deck);
  const positions = {
    ArrowLeft: index - 1, PageUp: index - 1,
    ArrowRight: index + 1, PageDown: index + 1,
    Home: 0, End: deck.slides.length - 1,
  };
  if (Object.hasOwn(positions, event.key)) {
    event.preventDefault();
    changePresentationSlide(positions[event.key]);
  } else if (event.key.toLowerCase() === 'f' || event.key === 'Escape') {
    event.preventDefault();
    const action = event.key === 'Escape' ? 'exit' : 'present';
    runPresentationAction(action).catch(
      // Treat native fullscreen rejections as a visible control error.
      (error) => showError(error.message),
    );
  }
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
    !document.querySelector('dialog[open]') &&
    !['INPUT', 'TEXTAREA'].includes(event.target.tagName) &&
    selectElement('#directory-search')
  ) {
    event.preventDefault();
    selectElement('#directory-search').focus();
  }
});
await initializeApp();

import { escapeHtml as escape, formatText } from '../content.js';
import { renderIcon } from '../ui/icons.js';
import { renderSourceDisclosure } from '../ui/source-links.js';
import {
  renderAnalysisControls,
  renderAnalysisFreshness,
  renderAnalysisTextarea,
} from '../ui/analysis-controls.js';

// Render a saved architecture view's navigation entry.
function renderArchitectureOption(graph, index, selected, projectUrl) {
  return /* HTML */ `
    <a
      class="flow-option ${graph.id === selected?.id ? 'active' : ''}"
      href="${projectUrl('architecture', graph.id)}"
      ${graph.id === selected?.id ? 'aria-current="page"' : ''}
    >
      <span class="flow-option-number">${String(index + 1).padStart(2, '0')}</span>
      <div>
        <strong>${escape(graph.title)}</strong>
        <p>${escape(graph.requestedQuestion || 'Overall system architecture')}</p>
      </div>
      ${renderIcon('arrow')}
    </a>
  `;
}

// Render a compact architecture component card.
function renderGraphNode(node) {
  return /* HTML */ `
    <button
      type="button"
      class="system-node graph-node"
      id="graph-node-${node.id}"
      data-node="${escape(node.id)}"
      aria-label="View details for ${escape(node.title)}"
      aria-haspopup="dialog"
    >
      <span class="graph-node-top">
        <span class="system-node-icon" aria-hidden="true">${renderIcon(node.icon || 'code')}</span>
        <span class="graph-node-kind">${escape(node.kind)}</span>
      </span>
      <span class="graph-node-title">${escape(node.title)}</span>
    </button>
  `;
}

// Compose architecture navigation and the focused diagram question form.
function renderArchitectureNavigation(views, selected, { draft, busy, projectUrl }) {
  return /* HTML */ `
    <aside class="sidebar architecture-sidebar" aria-label="Architecture navigation">
      <div class="sidebar-heading">
        <h2>Architecture views</h2>
        <span class="tiny-label">
          ${views.length} ${views.length === 1 ? 'DIAGRAM' : 'DIAGRAMS'}
        </span>
      </div>
      <p class="sidebar-description">Explore the whole system or focus on a smaller part.</p>
      <form id="architecture-form" class="flow-composer">
        <label for="architecture-question">Ask an architecture question</label>
        ${renderAnalysisTextarea({
          id: 'architecture-question',
          rows: 4,
          placeholder: 'How does authentication fit together?',
          draft,
          busy,
          required: true,
        })}
        <p class="composer-hint">Each question adds a saved, source-linked diagram.</p>
        <button class="button" type="submit" ${busy ? 'disabled' : ''}>Generate diagram</button>
        <p class="architecture-error flow-error" role="alert"></p>
      </form>
      <div class="flow-options">
        ${views
          .map(
            // Render each saved diagram with the selected view highlighted.
            (graph, index) => renderArchitectureOption(graph, index, selected, projectUrl),
          )
          .join('')}
      </div>
    </aside>
  `;
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

// Compose a saved architecture diagram and its evidence.
export function renderArchitectureView(project, graph, { draft, projectUrl, actionsBusy }) {
  const views = project.architectures || [];
  const busy = ['queued', 'running'].includes(project.job?.status);
  const navigation = renderArchitectureNavigation(views, graph, { draft, busy, projectUrl });
  if (!graph) {
    const message = busy
      ? 'Analysis is in progress. Saved diagrams will appear here as they finish.'
      : 'Ask a question to diagram a subsystem, boundary, or dependency.';
    return /* HTML */ `
      <div class="workspace architecture-workspace">
        ${navigation}
        <article class="architecture-content">
          <span class="eyebrow">ARCHITECTURE</span>
          <h2>Explore the architecture of ${escape(project.name)}</h2>
          <p class="lead">${message}</p>
        </article>
      </div>
    `;
  }

  return /* HTML */ `
    <div class="workspace architecture-workspace">
      ${navigation}
      <article class="architecture-content">
        <div class="content-heading">
          <div>
            <div class="eyebrow">
              ARCHITECTURE
              <span>/</span>
              ${String(views.indexOf(graph) + 1).padStart(2, '0')} OF ${views.length}
            </div>
            <h2>${escape(graph.title)}</h2>
            <p class="lead">${formatText(graph.description)}</p>
            ${renderSourceDisclosure(graph.sources)}
          </div>
          ${renderAnalysisControls('architecture', graph.id, {
            busy: actionsBusy,
            review: graph.review,
          })}
        </div>
        ${renderAnalysisFreshness(graph.review)}
        ${
          graph.requestedQuestion
            ? /* HTML */ `
                <div class="architecture-question">
                  <span class="eyebrow">QUESTION</span>
                  <p>${escape(graph.requestedQuestion)}</p>
                </div>
              `
            : ''
        }
        ${renderArchitectureFigure(project, graph)} ${renderGraphConnections(graph)}
        ${renderArchitectureNotes(graph, projectUrl)}
        <div class="scope-note">
          ${renderIcon('info')}
          <span>${formatText(graph.scope)}</span>
        </div>
      </article>
    </div>
  `;
}

// Render a component's description, tags, and navigable relationships.
export function renderNodeDetails(graph, node) {
  const related = graph.edges.filter(
    // Select incoming and outgoing connections for the component.
    (edge) => edge.from === node.id || edge.to === node.id,
  );
  return /* HTML */ `
    <p class="node-description">${formatText(node.description)}</p>
    ${
      node.tags?.length
        ? /* HTML */ `
            <div class="system-tables">
              ${node.tags
                .map(
                  // Render a component's associated technology or data tag.
                  (tag) => /* HTML */ `
                    <code>${escape(tag)}</code>
                  `,
                )
                .join('')}
            </div>
          `
        : ''
    }${renderSourceDisclosure(node.sources)}${
      related.length
        ? /* HTML */ `
            <section class="node-relationships">
              <h3>Connections</h3>
              <ul>
                ${related
                  .map(
                    // Render a navigable connection to the neighboring component.
                    (edge) => {
                      const outgoing = edge.from === node.id;
                      const other = graph.nodes.find(
                        // Find the component at the opposite end of a connection.
                        (entry) => entry.id === (outgoing ? edge.to : edge.from),
                      );
                      if (!other) return '';

                      return /* HTML */ `
                        <li>
                          <button
                            type="button"
                            class="node-connection"
                            data-node="${escape(other.id)}"
                            aria-label="View details for ${escape(other.title)}"
                            aria-haspopup="dialog"
                          >
                            <span class="node-direction">${outgoing ? 'To' : 'From'}</span>
                            <span class="node-connection-main">
                              <strong>${escape(other.title)}</strong>
                              <span class="node-connection-label">${formatText(edge.label)}</span>
                              ${
                                edge.inferred
                                  ? /* HTML */ `
                                      <span class="effect external">Inferred</span>
                                    `
                                  : ''
                              }
                            </span>
                            ${renderIcon('arrow')}
                          </button>
                        </li>
                      `;
                    },
                  )
                  .join('')}
              </ul>
            </section>
          `
        : ''
    }
  `;
}

// Render graph cards and SVG placeholders before app.js measures their geometry.
function renderArchitectureFigure(project, graph) {
  const levels = groupGraphLevels(graph);
  const diagramLabel =
    graph.id === 'overview' || graph.requestedQuestion === null
      ? 'System overview'
      : 'Focused architecture';
  return /* HTML */ `
    <figure class="system-figure" aria-labelledby="system-caption">
      <figcaption id="system-caption">
        <span>${escape(project.name)} · ${diagramLabel}</span>
        <span class="diagram-legend">
          <span>
            <i></i>
            Source-backed connection
          </span>
          <span>
            <i class="oauth-dot"></i>
            Redirect or inferred connection
          </span>
        </span>
      </figcaption>
      <div class="graph-canvas">
        <svg class="graph-edges" aria-hidden="true">
          <defs>
            <marker
              id="graph-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="10"
              markerHeight="10"
              markerUnits="userSpaceOnUse"
              orient="auto"
            >
              <path d="M 2 2 L 8 5 L 2 8" />
            </marker>
            <marker
              id="graph-arrow-inferred"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="10"
              markerHeight="10"
              markerUnits="userSpaceOnUse"
              orient="auto"
            >
              <path d="M 2 2 L 8 5 L 2 8" />
            </marker>
          </defs>
          ${graph.edges
            .map(
              // Render an SVG path placeholder with the correct arrow style.
              (edge, index) => /* HTML */ `
                <path
                  id="graph-edge-${index}"
                  class="${edge.inferred || edge.kind === 'redirect' ? 'inferred-edge' : ''}"
                  marker-end="url(#${
                    edge.inferred || edge.kind === 'redirect'
                      ? 'graph-arrow-inferred'
                      : 'graph-arrow'
                  })"
                />
              `,
            )
            .join('')}
        </svg>
        ${
          levels
            .map(
              // Render a row of component cards at the same dependency level.
              (level) => /* HTML */ `
                <div class="graph-level">${level.map(renderGraphNode).join('')}</div>
              `,
            )
            .join('') ||
          /* HTML */ `
            <div class="graph-empty">
              <h3>No components in this diagram</h3>
              <p>
                All nodes have been removed. Generate a new architecture view, or analyze the
                project to rebuild its overall diagram.
              </p>
            </div>
          `
        }
      </div>
      <div class="diagram-caption">
        ${renderIcon('info')}
        <p>
          Hover or focus a component to highlight its connections. Click it to view descriptions,
          sources, and related components in a dialog. Inferred relationships are marked explicitly.
        </p>
      </div>
    </figure>
  `;
}

// Render source-backed connection rows using human-readable endpoint titles.
function renderGraphConnections(graph) {
  const titles = new Map(
    graph.nodes.map(
      // Index component titles for readable connection labels.
      (node) => [node.id, node.title],
    ),
  );
  return /* HTML */ `
    <section class="graph-connections">
      <div class="section-label">
        <h3>Connections</h3>
        <span>
          ${graph.edges.length} ${graph.edges.length === 1 ? 'relationship' : 'relationships'}
        </span>
      </div>
      ${
        graph.edges
          .map(
            // Render a connection's label, description, and source evidence.
            (edge, index) => /* HTML */ `
              <details class="edge-row" data-edge="${index}">
                <summary>
                  <span class="edge-number">${index + 1}</span>
                  <div>
                    <span class="edge-ends">
                      ${escape(titles.get(edge.from))} → ${escape(titles.get(edge.to))}
                    </span>
                    <strong>${escape(edge.label)}</strong>
                  </div>
                  ${
                    edge.inferred
                      ? /* HTML */ `
                          <span class="effect external">Inferred</span>
                        `
                      : ''
                  }${renderIcon('chevron')}
                </summary>
                <div class="edge-details">
                  <p>${formatText(edge.description)}</p>
                  ${renderSourceDisclosure(edge.sources)}
                </div>
              </details>
            `,
          )
          .join('') ||
        /* HTML */ `
          <p class="lead">No inter-component connections were identified.</p>
        `
      }
    </section>
  `;
}

// Render architecture notes and their optional links to saved walkthroughs.
function renderArchitectureNotes(graph, projectUrl) {
  return /* HTML */ `
    <div class="architecture-notes">
      ${(graph.notes || [])
        .map(
          // Render an architecture note and its optional related flow link.
          (note) => /* HTML */ `
            <section>
              <h3>${escape(note.title)}</h3>
              <p>${formatText(note.description)}</p>
              ${renderSourceDisclosure(note.sources)}${
                note.flow
                  ? /* HTML */ `
                      <a href="${projectUrl('flows', note.flow)}">
                        ${escape(note.link)} ${renderIcon('arrow')}
                      </a>
                    `
                  : ''
              }
            </section>
          `,
        )
        .join('')}
    </div>
  `;
}

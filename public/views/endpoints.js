import { escapeHtml as escape, formatText } from '../content.js';
import { renderIcon } from '../ui/icons.js';
import { renderSourceDisclosure } from '../ui/source-links.js';
import {
  renderAnalysisControls,
  renderAnalysisFreshness,
} from '../ui/analysis-controls.js';

// Keep method and path scannable while exposing request details and evidence on demand.
function renderEndpoint(endpoint) {
  return /* HTML */ `
    <details class="endpoint-route">
      <summary>
        <span class="endpoint-method">${escape(endpoint.method)}</span>
        <code>${escape(endpoint.path)}</code>
        ${renderIcon('down')}
      </summary>
      <div class="endpoint-details">
        <p>${formatText(endpoint.description)}</p>
        <dl>
          ${endpoint.handler ? /* HTML */ `
            <div><dt>Handler</dt><dd><code>${escape(endpoint.handler)}</code></dd></div>
          ` : ''}
          <div><dt>Request</dt><dd>${formatText(endpoint.request)}</dd></div>
          <div><dt>Response</dt><dd>${formatText(endpoint.response)}</dd></div>
        </dl>
        ${renderSourceDisclosure(endpoint.sources)}
      </div>
    </details>
  `;
}

// Group routes by their owning server, including servers with no identified REST routes.
function renderEndpointServer(server) {
  const count = server.endpoints.length;

  return /* HTML */ `
    <section class="endpoint-server">
      <header>
        <div>
          <h3>${escape(server.name)}</h3>
          <p>${formatText(server.description)}</p>
          ${server.address ? /* HTML */ `<code>${escape(server.address)}</code>` : ''}
          ${renderSourceDisclosure(server.sources)}
        </div>
        <span class="endpoint-count">${count} ${count === 1 ? 'endpoint' : 'endpoints'}</span>
      </header>
      ${count ? server.endpoints.map(renderEndpoint).join('') : /* HTML */ `
        <p class="lead">No REST endpoints were identified for this server.</p>
      `}
    </section>
  `;
}

// Render the project-wide inventory or its initial discovery control.
function renderEndpointsContent(project, selected, actionsBusy) {
  if (!selected) return /* HTML */ `
    <span class="eyebrow">ENDPOINTS</span>
    <h2>Find the REST endpoints in ${escape(project.name)}</h2>
    <p class="lead">
      Discover every server and its HTTP API routes, grouped by server.
      Each endpoint includes its method, path, behavior, and links to the source.
    </p>
    <button
      class="button"
      type="button"
      data-action="endpoints"
      ${actionsBusy ? 'disabled' : ''}
    >
      Discover endpoints
    </button>
  `;

  const count = selected.servers.reduce(
    // Count server-owned routes without merging identical paths on different servers.
    (total, server) => total + server.endpoints.length,
    0,
  );

  return /* HTML */ `
    <div class="content-heading">
      <div>
        <span class="eyebrow">ENDPOINTS</span>
        <h2>${escape(selected.title)}</h2>
        <p class="lead">${formatText(selected.description)}</p>
        ${renderSourceDisclosure(selected.sources)}
      </div>
      ${renderAnalysisControls('endpoints', selected.id, {
        busy: actionsBusy,
        review: selected.review,
      })}
    </div>
    ${renderAnalysisFreshness(selected.review)}
    <div class="endpoints-scope">
      <p>${formatText(selected.scope)}</p>
      <span>
        ${selected.servers.length} ${selected.servers.length === 1 ? 'server' : 'servers'} ·
        ${count} ${count === 1 ? 'endpoint' : 'endpoints'}
      </span>
    </div>
    ${selected.servers.map(renderEndpointServer).join('')}
    ${!selected.servers.length ? /* HTML */ `
      <p class="lead">No HTTP API servers were identified in this project.</p>
    ` : ''}
    ${selected.notes.length ? /* HTML */ `
      <section class="endpoint-notes">
        <h3>Notes</h3>
        <ul>
          ${selected.notes.map(
            // Retain source limitations and dynamic routing uncertainties near the inventory.
            (note) => /* HTML */ `<li>${formatText(note)}</li>`,
          ).join('')}
        </ul>
      </section>
    ` : ''}
  `;
}

// Show a single project-wide endpoint inventory with discovery and rerun controls.
export function renderEndpointsView(project, selected, { actionsBusy }) {
  return /* HTML */ `
    <div class="workspace endpoints-workspace">
      <article class="endpoints-content">
        ${renderEndpointsContent(project, selected, actionsBusy)}
      </article>
    </div>
  `;
}

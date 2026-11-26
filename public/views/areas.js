import { escapeHtml as escape, formatText } from '../content.js';
import { renderIcon } from '../ui/icons.js';
import { renderSourceDisclosure } from '../ui/source-links.js';
import { renderSavedAnalysisListHeader } from '../ui/new-analysis.js';
import {
  renderAnalysisControls,
  renderAnalysisFreshness,
  renderAnalysisLabel,
} from '../ui/analysis-controls.js';

// Recover the selected box's ancestry for a bounded, source-independent breadcrumb.
function getAreaTrail(areas, areaId) {
  const nodes = new Map(areas.map(
    // Index boxes once so parent lookups do not depend on result ordering.
    (area) => [area.id, area],
  ));
  const trail = [];
  const seen = new Set();
  let current = nodes.get(areaId);

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    trail.unshift(current);
    current = nodes.get(current.parentId);
  }

  return trail;
}

// Show the current level as equal-weight boxes with descriptions and drill-down links.
function renderAreaCard(area, childCounts, selectedId, projectUrl) {
  const count = childCounts.get(area.id) || 0;
  const destination = projectUrl('areas', `${selectedId}/${area.id}`);

  return /* HTML */ `
    <section class="area-card">
      <a class="area-card-link" href="${destination}">
        <span class="area-card-icon">${renderIcon('areas')}</span>
        <h3>${escape(area.name)}</h3>
        <p>${formatText(area.description)}</p>
        <span class="area-card-action">
          ${count ? `Explore ${count} areas` : 'View area'}${renderIcon('chevron')}
        </span>
      </a>
      ${renderSourceDisclosure(area.sources)}
    </section>
  `;
}

// Show saved maps beside the action for creating a new area map.
function renderAreasNavigation(project, selected, { actionsBusy, projectUrl }) {
  const analyses = project.areaAnalyses || [];

  return /* HTML */ `
    <aside class="sidebar areas-sidebar" aria-label="Areas analysis navigation">
      <div class="sidebar-heading">
        <h2>Areas</h2>
      </div>
      <p class="sidebar-description">Explore the pieces that make up your application.</p>
      ${renderSavedAnalysisListHeader('areas', analyses.length, actionsBusy)}
      <div class="flow-options">
        ${analyses.map(
          // Saved maps always open at their top level.
          (analysis, index) => /* HTML */ `
            <a
              class="flow-option ${analysis.id === selected?.id ? 'active' : ''}"
              href="${projectUrl('areas', analysis.id)}"
              ${analysis.id === selected?.id ? 'aria-current="page"' : ''}
            >
              <span class="flow-option-number">${String(index + 1).padStart(2, '0')}</span>
              <div>
                <strong>${escape(analysis.title)}</strong>
                <p>${escape(analysis.requestedScope || 'Entire project')}</p>
              </div>
            </a>
          `,
        ).join('')}
      </div>
    </aside>
  `;
}

// Keep every enclosing area addressable with ordinary links and browser history.
function renderAreaBreadcrumb(selected, trail, projectUrl) {
  return /* HTML */ `
    <nav class="area-breadcrumb" aria-label="Area hierarchy">
      <a href="${projectUrl('areas', selected.id)}" ${!trail.length ? 'aria-current="page"' : ''}>
        All areas
      </a>
      ${trail.map(
        // Mark the selected box while preserving links to every enclosing responsibility.
        (area, index) => /* HTML */ `
          ${renderIcon('chevron')}
          <a
            href="${projectUrl('areas', `${selected.id}/${area.id}`)}"
            ${index === trail.length - 1 ? 'aria-current="page"' : ''}
          >${escape(area.name)}</a>
        `,
      ).join('')}
    </nav>
  `;
}

// Explain the selected responsibility and render just its immediate children.
function renderAreasContent(project, selected, { areaId, actionsBusy, projectUrl }) {
  if (!selected) return /* HTML */ `
    <span class="eyebrow">AREAS</span>
    <h2>See how ${escape(project.name)} fits together</h2>
    <p class="lead">
      Break the application into a few understandable areas, from user-facing capabilities
      to backend services and infrastructure. Open a box to explore its smaller parts.
      Each area explains its responsibility and links to the source.
    </p>
  `;

  const trail = getAreaTrail(selected.areas, areaId);
  const current = trail.at(-1);
  const children = [];
  const childCounts = new Map();

  for (const area of selected.areas) {
    childCounts.set(area.parentId, (childCounts.get(area.parentId) || 0) + 1);
    if (area.parentId === (current?.id || null)) children.push(area);
  }

  return /* HTML */ `
    <div class="content-heading">
      <div>
        ${renderAnalysisLabel('AREAS', project.areaAnalyses || [], selected.id)}
        <h2>${escape(selected.title)}</h2>
        <p class="lead">${formatText(selected.description)}</p>
        ${renderSourceDisclosure(selected.sources)}
      </div>
      ${renderAnalysisControls('areas', selected.id, {
        busy: actionsBusy, review: selected.review,
      })}
    </div>
    ${renderAnalysisFreshness(selected.review)}
    ${renderAreaBreadcrumb(selected, trail, projectUrl)}
    ${current ? /* HTML */ `
      <section class="area-detail">
        <h3 tabindex="-1" id="area-level-title">${escape(current.name)}</h3>
        <p>${formatText(current.description)}</p>
        ${renderSourceDisclosure(current.sources)}
      </section>
    ` : ''}
    ${children.length ? /* HTML */ `
      <div class="area-grid">
        ${children.map(
          // Show a single level at a time even when the saved map contains deeper boxes.
          (area) => renderAreaCard(area, childCounts, selected.id, projectUrl),
        ).join('')}
      </div>
    ` : /* HTML */ `
      <p class="area-level-hint">
        ${current ? 'This is the most detailed level in this map.'
          : 'No areas were identified in this scope.'}
      </p>
    `}
  `;
}

// Render a saved hierarchy or the introduction without owning requests or navigation state.
export function renderAreasView(project, selected, options) {
  return /* HTML */ `
    <div class="workspace areas-workspace">
      ${renderAreasNavigation(project, selected, options)}
      <article class="areas-content">
        ${renderAreasContent(project, selected, options)}
      </article>
    </div>
  `;
}

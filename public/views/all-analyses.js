import { escapeHtml as escape, formatText } from '../content.js';
import { formatAnalysisDate } from '../ui/analysis-controls.js';
import { renderIcon } from '../ui/icons.js';
import { getAnalysisEntries } from '../analysis-list.js';

// Render a saved result with its type, last analysis date, and original detail link.
function renderAnalysisEntry(entry, projectUrl) {
  const date = entry.analyzedAt
    ? /* HTML */ `
        <time datetime="${escape(entry.analyzedAt)}">
          Analyzed ${escape(formatAnalysisDate(entry.analyzedAt))}
        </time>
      `
    : /* HTML */ `
        <span>Analysis date unavailable</span>
      `;

  return /* HTML */ `
    <li>
      <a class="analysis-list-entry" href="${projectUrl(entry.tab, entry.id)}">
        <span class="analysis-list-icon">${renderIcon(entry.icon)}</span>
        <div class="analysis-list-content">
          <div class="analysis-list-meta">
            <span class="analysis-type">${escape(entry.label)}</span>
            ${date}
          </div>
          <h3>${escape(entry.title)}</h3>
          <p>${formatText(entry.description)}</p>
        </div>
        ${renderIcon('arrow')}
      </a>
    </li>
  `;
}

// List every saved analysis in this project, most recently analyzed first.
export function renderAllAnalysesView(project, projectUrl) {
  const entries = getAnalysisEntries(project);

  return /* HTML */ `
    <article class="all-analyses">
      <div class="all-analyses-heading">
        <span class="eyebrow">ALL</span>
        <h2>All analyses</h2>
        <p>Diagrams and analyses, most recently analyzed first.</p>
      </div>
      ${
        entries.length
          ? /* HTML */ `
              <ul class="analysis-list" aria-label="Analyses, most recently analyzed first">
                ${entries
                  .map(
                    // Link each result to its project-specific detail view.
                    (entry) => renderAnalysisEntry(entry, projectUrl),
                  )
                  .join('')}
              </ul>
            `
          : /* HTML */ `
              <div class="all-analyses-empty">
                <h3>No saved analyses yet</h3>
                <p>
                  Run an analysis from any of the other tabs. Completed results will appear here.
                </p>
              </div>
            `
      }
    </article>
  `;
}

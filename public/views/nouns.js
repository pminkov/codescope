import { escapeHtml as escape, formatText } from '../content.js';
import { renderIcon } from '../ui/icons.js';
import { renderSourceDisclosure } from '../ui/source-links.js';
import {
  renderAnalysisControls,
  renderAnalysisFreshness,
  renderAnalysisTextarea,
} from '../ui/analysis-controls.js';

// Render a saved nouns analysis in the scope navigation.
function renderNounsOption(analysis, index, selected, projectUrl) {
  return /* HTML */ `
    <a
      class="flow-option ${analysis.id === selected?.id ? 'active' : ''}"
      href="${projectUrl('nouns', analysis.id)}"
      ${analysis.id === selected?.id ? 'aria-current="page"' : ''}
    >
      <span class="flow-option-number">${String(index + 1).padStart(2, '0')}</span>
      <div>
        <strong>${escape(analysis.title)}</strong>
        <p>${escape(analysis.requestedScope || 'Entire project')}</p>
      </div>
      ${renderIcon('arrow')}
    </a>
  `;
}

// Keep the concept inventory compact while making its full details discoverable.
function renderNounCard(noun) {
  return /* HTML */ `
    <section class="noun-card">
      <div class="noun-card-heading">
        <h3>${escape(noun.name)}</h3>
        <button
          type="button"
          class="noun-details-button"
          data-noun="${escape(noun.id)}"
          aria-label="View details for ${escape(noun.name)}"
          aria-haspopup="dialog"
          aria-controls="noun-details-dialog"
        >
          Details
        </button>
      </div>
      <p>${formatText(noun.description)}</p>
    </section>
  `;
}

// Render relationships using the noun names rather than internal identifiers.
function renderNounRelationships(analysis) {
  if (!analysis.relationships.length) return '';
  const names = new Map(
    analysis.nouns.map(
      // Index the display name of every noun referenced by a relationship.
      (noun) => [noun.id, noun.name],
    ),
  );
  return /* HTML */ `
    <section class="noun-relationships">
      <h3>Relationships</h3>
      <div class="noun-table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">From</th>
              <th scope="col">To</th>
              <th scope="col">Relationship</th>
            </tr>
          </thead>
          <tbody>
            ${analysis.relationships
              .map(
                // Keep relationship explanations and their evidence in the same row.
                (relationship) => /* HTML */ `
                  <tr>
                    <th scope="row">${escape(names.get(relationship.from))}</th>
                    <td>${escape(names.get(relationship.to))}</td>
                    <td>
                      ${formatText(relationship.description)}
                      ${renderSourceDisclosure(relationship.sources)}
                    </td>
                  </tr>
                `,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

// Compose the scoped nouns form, saved analyses, and selected concept inventory.
export function renderNounsView(project, selected, { draft, projectUrl, actionsBusy }) {
  const analyses = project.nounAnalyses || [];
  const busy = ['queued', 'running'].includes(project.job?.status);
  const navigation = renderNounsNavigation(analyses, selected, {
    draft,
    busy,
    projectUrl,
  });
  const content = renderNounsContent(project, selected, { busy, actionsBusy });
  return /* HTML */ `
    <div class="workspace nouns-workspace">
      ${navigation}
      <article class="nouns-content">${content}</article>
    </div>
  `;
}

// Render the selected concept details and source evidence.
export function renderNounDetails(noun) {
  return /* HTML */ `
    <p class="node-description">${formatText(noun.description)}</p>
    ${
      noun.responsibilities.length
        ? /* HTML */ `
            <section class="noun-responsibilities">
              <h3>Responsibilities</h3>
              <ul>
                ${noun.responsibilities
                  .map(
                    // Preserve each responsibility and its existing safe inline formatting.
                    (responsibility) => /* HTML */ `
                      <li>${formatText(responsibility)}</li>
                    `,
                  )
                  .join('')}
              </ul>
            </section>
          `
        : ''
    }${renderSourceDisclosure(noun.sources)}
  `;
}

// Render scope requests and saved noun-analysis navigation.
function renderNounsNavigation(analyses, selected, { draft, busy, projectUrl }) {
  return /* HTML */ `
    <aside class="sidebar nouns-sidebar" aria-label="Nouns analysis navigation">
      <div class="sidebar-heading">
        <h2>Nouns analyses</h2>
        <span class="tiny-label">${analyses.length} SAVED</span>
      </div>
      <p class="sidebar-description">Main concepts, their responsibilities, and relationships.</p>
      <form id="nouns-form" class="flow-composer">
        <label for="nouns-scope">Scope (optional)</label>
        ${renderAnalysisTextarea({
          id: 'nouns-scope',
          rows: 4,
          placeholder: 'For example: job processing in src/storage.mjs',
          draft,
          busy,
          required: false,
        })}
        <p class="composer-hint">
          Leave blank for the whole project. Each run saves a separate analysis.
        </p>
        <button class="button" type="submit" ${busy ? 'disabled' : ''}>Analyze nouns</button>
        <p class="flow-error" role="alert"></p>
      </form>
      <div class="flow-options">
        ${analyses
          .map(
            // Keep each requested scope available as a separate navigation entry.
            (analysis, index) => renderNounsOption(analysis, index, selected, projectUrl),
          )
          .join('')}
      </div>
    </aside>
  `;
}

// Render a concept inventory or its first-analysis introduction.
function renderNounsContent(project, selected, { busy, actionsBusy }) {
  return selected
    ? /* HTML */ `
        <div class="content-heading">
          <div>
            <span class="eyebrow">NOUNS</span>
            <h2>${escape(selected.title)}</h2>
            <p class="lead">${formatText(selected.description)}</p>
            ${renderSourceDisclosure(selected.sources)}
          </div>
          ${renderAnalysisControls('nouns', selected.id, {
            busy: actionsBusy,
            review: selected.review,
          })}
        </div>
        ${renderAnalysisFreshness(selected.review)}
        <div class="nouns-scope">
          <span class="eyebrow">SCOPE</span>
          <p>${formatText(selected.scope)}</p>
          ${
            selected.requestedScope
              ? /* HTML */ `
                  <p class="nouns-request">Requested: ${escape(selected.requestedScope)}</p>
                `
              : ''
          }
        </div>
        <div class="noun-grid">${selected.nouns.map(renderNounCard).join('')}</div>
        ${
          !selected.nouns.length
            ? /* HTML */ `
                <p class="lead">No nouns were identified in this scope.</p>
              `
            : ''
        }${renderNounRelationships(selected)}${
          selected.notes.length
            ? /* HTML */ `
                <section class="noun-notes">
                  <h3>Notes</h3>
                  <ul>
                    ${selected.notes
                      .map(
                        // Surface limitations and missing implementation described by the analysis.
                        (note) => /* HTML */ `
                          <li>${formatText(note)}</li>
                        `,
                      )
                      .join('')}
                  </ul>
                </section>
              `
            : ''
        }
      `
    : /* HTML */ `
        <span class="eyebrow">NOUNS</span>
        <h2>Identify the concepts in ${escape(project.name)}</h2>
        <p class="lead">
          Analyze the whole project or describe a folder, subsystem, or feature to focus on. Results
          explain what each concept means and link to its implementation.
        </p>
        ${
          busy
            ? /* HTML */ `
                <p class="lead">
                  Analysis is in progress. Saved results will appear here when ready.
                </p>
              `
            : ''
        }
      `;
}

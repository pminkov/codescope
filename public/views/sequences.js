import { escapeHtml as escape, formatText } from '../content.js';
import { renderIcon } from '../ui/icons.js';
import { renderSourceDisclosure } from '../ui/source-links.js';
import {
  renderAnalysisControls,
  renderAnalysisFreshness,
  renderAnalysisLabel,
  renderAnalysisTextarea,
} from '../ui/analysis-controls.js';
import { renderSequenceDiagram, renderSequenceZoomControls } from '../sequence-diagram.js';

// Render saved sequence navigation with the original interaction request.
function renderSequenceOption(analysis, index, selected, projectUrl) {
  return /* HTML */ `
    <a
      class="flow-option ${analysis.id === selected?.id ? 'active' : ''}"
      href="${projectUrl('sequences', analysis.id)}"
      ${analysis.id === selected?.id ? 'aria-current="page"' : ''}
    >
      <span class="flow-option-number">${String(index + 1).padStart(2, '0')}</span>
      <div>
        <strong>${escape(analysis.title)}</strong>
        ${analysis.requestedQuestion ? `<p>${escape(analysis.requestedQuestion)}</p>` : ''}
      </div>
      ${renderIcon('arrow')}
    </a>
  `;
}

// Share message explanations and evidence between the modal and optional list.
export function renderSequenceMessageBody(message) {
  return /* HTML */ `
    ${
      message.condition
        ? /* HTML */ `
            <p class="sequence-branch">When: ${escape(message.condition)}</p>
          `
        : ''
    }
    <p class="node-description">${formatText(message.description)}</p>
    ${renderSourceDisclosure(message.sources)}
  `;
}

// Explain one numbered interaction with its branch condition and source evidence.
function renderSequenceMessage(message, index, names) {
  return /* HTML */ `
    <details class="edge-row" id="sequence-message-${index + 1}">
      <summary>
        <span class="edge-number">${String(index + 1).padStart(2, '0')}</span>
        <div>
          <span class="edge-ends">
            ${escape(names.get(message.from))} → ${escape(names.get(message.to))} ·
            ${escape(message.kind)}${message.inferred ? ' · Inferred' : ''}
          </span>
          <strong>${escape(message.label)}</strong>
        </div>
        ${renderIcon('chevron')}
      </summary>
      <div class="edge-details">${renderSequenceMessageBody(message)}</div>
    </details>
  `;
}

// Compose sequence navigation, lifelines, and evidence without installing controls.
export function renderSequencesView(project, selected, { draft, projectUrl, actionsBusy }) {
  const analyses = project.sequences || [];
  const busy = ['queued', 'running'].includes(project.job?.status);
  const navigation = /* HTML */ `
    <aside class="sidebar sequence-sidebar" aria-label="Sequence diagram navigation">
      <div class="sidebar-heading">
        <h2>Sequence diagrams</h2>
        <span class="tiny-label">${analyses.length} SAVED</span>
      </div>
      <form id="sequence-form" class="flow-composer">
        <label for="sequence-question">Describe an interaction</label>
        ${renderAnalysisTextarea({
          id: 'sequence-question',
          rows: 4,
          placeholder: 'What happens when an analysis starts?',
          draft,
          busy,
          required: true,
        })}
        <button class="button analysis-generate" type="submit" ${busy ? 'disabled' : ''}>
          Generate sequence
        </button>
        <p class="flow-error" role="alert"></p>
      </form>
      ${analyses.length ? '<h3 class="sequence-saved-heading">Saved diagrams</h3>' : ''}
      <div class="flow-options">
        ${analyses
          .map(
            // Keep earlier diagrams available while another analysis is running.
            (analysis, index) => renderSequenceOption(analysis, index, selected, projectUrl),
          )
          .join('')}
      </div>
    </aside>
  `;
  let content = /* HTML */ `
    <span class="eyebrow">SEQUENCES</span>
    <h2>Follow an interaction in ${escape(project.name)}</h2>
    <p class="lead">
      Describe an action to see its participants, calls, replies, and asynchronous handoffs in
      order.
    </p>
    ${
      busy
        ? /* HTML */ `
            <p class="lead">Analysis is in progress. Saved diagrams will appear here when ready.</p>
          `
        : ''
    }
  `;

  if (selected) {
    const names = new Map(
      selected.participants.map(
        // Translate message endpoint IDs into readable participant names.
        (participant) => [participant.id, participant.name],
      ),
    );
    content = /* HTML */ `
      <div class="content-heading">
        <div>
          ${renderAnalysisLabel('SEQUENCE ANALYSIS', analyses, selected.id)}
          <h2>${escape(selected.title)}</h2>
          <p class="lead">${formatText(selected.description)}</p>
          ${renderSourceDisclosure(selected.sources)}
        </div>
        ${renderAnalysisControls('sequences', selected.id, {
          busy: actionsBusy,
          review: selected.review,
        })}
      </div>
      ${renderAnalysisFreshness(selected.review)}
      <div class="precondition">
        <span>STARTS WITH</span>
        <p>${formatText(selected.precondition)}</p>
      </div>
      ${
        selected.messages.length
          ? /* HTML */ `
              <figure class="sequence-figure">
                <figcaption>
                  <span>Solid: call · Dashed: reply · Open arrow: async · Amber: inferred</span>
                  ${renderSequenceZoomControls()}
                </figcaption>
                <div
                  class="sequence-scroll"
                  tabindex="0"
                  role="region"
                  aria-label="Scrollable sequence diagram"
                >
                  ${renderSequenceDiagram(selected)}
                </div>
              </figure>
              <details class="sequence-participants">
                <summary>Participants · ${selected.participants.length}</summary>
                ${selected.participants
                  .map(
                    // Describe each lifeline and retain its implementation evidence.
                    (participant) => /* HTML */ `
                      <section>
                        <h3>${escape(participant.name)}</h3>
                        <p>${formatText(participant.description)}</p>
                        ${renderSourceDisclosure(participant.sources)}
                      </section>
                    `,
                  )
                  .join('')}
              </details>
              <details class="sequence-messages">
                <summary>Messages and sources · ${selected.messages.length}</summary>
                ${selected.messages
                  .map(
                    // Match message numbers to the arrows in the diagram.
                    (message, index) => renderSequenceMessage(message, index, names),
                  )
                  .join('')}
              </details>
            `
          : /* HTML */ `
              <p class="lead">No implemented interaction was found for this request.</p>
            `
      }
      <div class="outcome">
        <span>${renderIcon('check')} OUTCOME</span>
        <p>${formatText(selected.outcome)}</p>
      </div>
      ${
        selected.notes.length
          ? /* HTML */ `
              <section class="noun-notes">
                <h3>Notes and branches</h3>
                <ul>
                  ${selected.notes
                    .map(
                      // Explain loops, alternative paths, concurrency, and coverage limitations.
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
    `;
  }

  return /* HTML */ `
    <div class="workspace sequence-workspace">
      ${navigation}
      <article class="sequence-content">${content}</article>
    </div>
  `;
}

// Render either a message with readable endpoints or a participant's evidence.
export function renderSequenceDetails(analysis, message, participant) {
  if (!message)
    return /* HTML */ `
      <p class="node-description">${formatText(participant.description)}</p>
      ${renderSourceDisclosure(participant.sources)}
    `;
  const names = new Map(
    analysis.participants.map(
      // Resolve endpoints in the selected diagram only.
      (entry) => [entry.id, entry.name],
    ),
  );
  return /* HTML */ `
    <p class="sequence-message-endpoints">
      ${escape(names.get(message.from))} → ${escape(names.get(message.to))}
    </p>
    ${renderSequenceMessageBody(message)}
  `;
}

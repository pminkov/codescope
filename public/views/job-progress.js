import { escapeHtml as escape } from '../content.js';
import { renderIcon } from '../ui/icons.js';
import { formatJobElapsed, formatJobMessageTime } from '../job-progress.js';

// Render one recorded message with its original timestamp and arrival animation.
function renderJobMessage({ message, timestamp }, animate) {
  return /* HTML */ `
    <li ${animate ? 'class="job-message-new"' : ''}>
      <time class="job-message-time" datetime="${escape(timestamp)}">
        ${formatJobMessageTime(timestamp)}
      </time>
      <span>${escape(message)}</span>
    </li>
  `;
}

// Group result navigation and progress controls in the shared Actions dropdown.
function renderJobActions(job, { busy, resultLinks, actionsOpen }) {
  const retry = ['failed', 'cancelled', 'interrupted'].includes(job.status);

  return /* HTML */ `
    <details class="job-actions actions-dropdown" ${actionsOpen ? 'open' : ''}>
      <summary class="button">Actions ${renderIcon('down')}</summary>
      <div class="actions-menu" role="group" aria-label="Analysis progress actions">
        ${resultLinks.map(
          // Ordinary links retain new-tab and copy-link behavior during and after a run.
          (link) => /* HTML */ `
            <a href="${escape(link.href)}">
              ${renderIcon('arrow')}
              <span>
                <strong>${escape(link.label)}</strong>
                <small>Go to this analysis</small>
              </span>
            </a>
          `,
        ).join('')}
        <button
          type="button"
          data-action="view-prompt"
          aria-haspopup="dialog"
          aria-controls="job-prompts-dialog"
        >
          ${renderIcon('file')}
          <span><strong>View prompt</strong><small>Inspect the analysis input</small></span>
        </button>
        ${retry ? /* HTML */ `
          <button type="button" data-action="retry">
            ${renderIcon('rerun')}
            <span><strong>Retry</strong><small>Run this analysis again</small></span>
          </button>
        ` : ''}
        <div class="actions-divider"></div>
        ${busy ? /* HTML */ `
          <button type="button" data-action="cancel">
            ${renderIcon('close')}
            <span><strong>Cancel</strong><small>Stop the current analysis</small></span>
          </button>
        ` : /* HTML */ `
          <button
            type="button"
            data-action="dismiss-job"
            aria-label="Close analysis progress"
          >
            ${renderIcon('close')}
            <span><strong>Close</strong><small>Hide this progress card</small></span>
          </button>
        `}
      </div>
    </details>
  `;
}

// Render progress without changing timers, dismissal state, or message history.
export function renderJobProgress(job, {
  busy, completed, messages, newMessage, jobTypeLabels, resultLinks = [], actionsOpen = false,
}) {
  const stateClass = busy ? 'job-active' : completed ? 'job-completed' : '';
  const failedClass = ['failed', 'interrupted'].includes(job.status) ? 'job-failed' : '';
  const type = jobTypeLabels[job.kind] || 'Analysis';
  const label = `${job.modificationPrompt ? 'Modify · ' : ''}${type}`;

  return /* HTML */ `
    <div class="job-card ${stateClass} ${failedClass}">
      <div class="job-content">
        <div class="job-heading">
          <span class="job-type">${escape(label)}</span>
          ${
            job.status === 'running'
              ? job.assistant
                ? `<span class="job-assistant">Using ${escape(job.assistant)}</span>`
                : ''
              : /* HTML */ `
                  <span class="job-status">
                    ${completed ? `${renderIcon('check')} Analysis complete` : escape(job.status)}
                  </span>
                `
          }
          <span class="job-elapsed">
            ${renderIcon('clock')}
            <span>Elapsed</span>
            <span id="job-elapsed-time" aria-live="off">${formatJobElapsed(job)}</span>
          </span>
        </div>
        <ol
          class="job-messages ${messages.length === 4 ? 'has-four' : ''}"
          aria-label="Recent analysis progress"
          aria-live="polite"
        >
          ${messages
            .map(
              // Keep chronological order and animate only the newest incoming message.
              (message, index) =>
                renderJobMessage(message, newMessage && index === messages.length - 1),
            )
            .join('')}
        </ol>
        ${
          job.coverage?.limited
            ? /* HTML */ `
                <small class="job-coverage">
                  Analysis snapshot: ${job.coverage.included} of ${job.coverage.total} text files.
                  Large files and instruction files may be omitted.
                </small>
              `
            : ''
        }
      </div>
      <div class="job-controls">
        ${renderJobActions(job, { busy, resultLinks, actionsOpen })}
      </div>
    </div>
  `;
}

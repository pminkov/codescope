import { escapeHtml as escape } from '../content.js';
import { renderIcon } from '../ui/icons.js';
import { formatJobElapsed, formatJobMessageTime } from '../job-progress.js';

// Render one recorded message with its original timestamp and arrival animation.
function renderJobMessage({ message, timestamp }, animate) {
  const timeAttribute = timestamp
    ? `datetime="${escape(timestamp)}"`
    : 'title="Timestamp unavailable for this older message"';

  return /* HTML */ `
    <li ${animate ? 'class="job-message-new"' : ''}>
      <time class="job-message-time" ${timeAttribute}>${formatJobMessageTime(timestamp)}</time>
      <span>${escape(message)}</span>
    </li>
  `;
}

// Render progress without changing timers, dismissal state, or message history.
export function renderJobProgress(job, { busy, completed, messages, newMessage, jobTypeLabels }) {
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
              ? ''
              : /* HTML */ `
                  <span class="eyebrow">
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
                <small>
                  Analysis snapshot: ${job.coverage.included} of ${job.coverage.total} text files.
                  Large files and instruction files may be omitted.
                </small>
              `
            : ''
        }
      </div>
      <div class="job-controls">
        <button
          type="button"
          class="button"
          data-action="view-prompt"
          aria-haspopup="dialog"
          aria-controls="job-prompts-dialog"
        >
          View prompt
        </button>
        ${
          busy
            ? /* HTML */ `
                <button class="button" data-action="cancel">Cancel</button>
              `
            : /* HTML */ `
                ${
                  ['failed', 'cancelled', 'interrupted'].includes(job.status)
                    ? /* HTML */ `
                        <button class="button" data-action="retry">Retry</button>
                      `
                    : ''
                }
                <button
                  type="button"
                  class="button ${completed ? 'primary' : ''}"
                  data-action="dismiss-job"
                  aria-label="Close analysis progress"
                >
                  Close
                </button>
              `
        }
      </div>
    </div>
  `;
}

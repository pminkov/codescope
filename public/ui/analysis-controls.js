import { escapeHtml as escape } from '../content.js';
import { renderIcon } from './icons.js';

// Keep unavailable and incomplete comparisons visible when the header shows a compact count.
export function renderAnalysisFreshness(review) {
  if (!review?.available)
    return /* HTML */ `
      <p class="analysis-freshness">Source comparison unavailable for this analysis.</p>
    `;
  return review.unknownFiles?.length
    ? /* HTML */ `
        <div class="analysis-freshness">
          <span class="analysis-incomplete">
            Comparison incomplete: some file hashes are unavailable.
          </span>
        </div>
      `
    : '';
}

// Place the source comparison count immediately before the selected analysis's Actions menu.
export function renderAnalysisControls(kind, id, { review, ...options }) {
  let changes = '';
  if (review?.available) {
    const count = new Set([...review.changedFiles, ...review.newFiles]).size;
    const label = `${count} ${count === 1 ? 'file' : 'files'} changed since this analysis`;
    const description = review.unknownFiles?.length
      ? `${label}. Comparison incomplete: some file hashes are unavailable.`
      : label;

    changes = /* HTML */ `
      <button
        type="button"
        class="analysis-changes ${!count && !review.unknownFiles?.length ? 'is-current' : ''}"
        data-analysis-changes
        aria-haspopup="dialog"
        aria-controls="analysis-changes-dialog"
        aria-label="${escape(description)}"
        title="${escape(description)}"
      >
        ${renderIcon('clock')}
        <span>${count}</span>
      </button>
    `;
  }

  return /* HTML */ `
    <div class="analysis-header-controls">
      ${changes}
      ${renderAnalysisMenu(kind, id, options)}
    </div>
  `;
}

// Render one menu for the selected saved result, omitting copies for directories.
export function renderAnalysisMenu(kind, id, { busy, hasDirectoryAnalysis = true }) {
  const missing = kind === 'directories' && !hasDirectoryAnalysis;
  const attributes = `data-analysis-kind="${kind}" data-analysis-id="${escape(id)}"`;
  const disabled = busy ? 'disabled' : '';

  return /* HTML */ `
    <details class="analysis-actions actions-dropdown">
      <summary class="button">Actions ${renderIcon('down')}</summary>
      <div class="actions-menu" role="group" aria-label="Analysis actions">
        ${
          busy
            ? /* HTML */ `
                <p class="analysis-actions-status">Wait for the current operation to finish.</p>
              `
            : ''
        }
        <button
          type="button"
          data-analysis-action="rerun"
          aria-label="Rerun analysis"
          ${attributes}
          ${disabled}
        >
          ${renderIcon('rerun')}
          <span>
            <strong>Rerun</strong>
            <small>Analyze the current source</small>
          </span>
        </button>
        ${
          kind !== 'directories'
            ? /* HTML */ `
                <button
                  type="button"
                  data-analysis-action="modify"
                  aria-label="Modify analysis"
                  aria-haspopup="dialog"
                  aria-controls="modify-analysis-dialog"
                  ${attributes}
                  ${disabled}
                >
                  ${renderIcon('rename')}
                  <span>
                    <strong>Modify</strong>
                    <small>Describe changes to this result</small>
                  </span>
                </button>
                <button
                  type="button"
                  data-analysis-action="duplicate"
                  aria-label="Duplicate analysis"
                  ${attributes}
                  ${disabled}
                >
                  ${renderIcon('duplicate')}
                  <span>
                    <strong>Duplicate</strong>
                    <small>Create a saved copy</small>
                  </span>
                </button>
              `
            : ''
        }
        <div class="actions-divider"></div>
        <button
          type="button"
          class="action-delete"
          data-analysis-action="delete"
          aria-label="Delete analysis"
          ${attributes}
          ${busy || missing ? 'disabled' : ''}
        >
          ${renderIcon('delete')}
          <span>
            <strong>Delete</strong>
            <small>Remove this saved analysis</small>
          </span>
        </button>
      </div>
    </details>
  `;
}

// Render changed paths with the existing comparison reason badges.
export function renderAnalysisChanges(paths, review) {
  const changeTypes = {
    added: 'Added',
    modified: 'Modified',
    removed: 'Removed',
    unreadable: 'Could not read',
    changed: 'Changed',
  };
  return paths
    .map(
      // Keep badge styles limited to the known comparison reasons.
      (path) => {
        const reason = review.fileChanges?.[path];
        const status = Object.hasOwn(changeTypes, reason) ? reason : 'changed';
        const label = changeTypes[status];

        return /* HTML */ `
          <li>
            <code>${escape(path)}</code>
            <span class="file-change-badge" data-change="${status}">${label}</span>
          </li>
        `;
      },
    )
    .join('');
}

// Format analysis dates consistently in comparison details and the saved result list.
export function formatAnalysisDate(timestamp) {
  return timestamp
    ? new Date(timestamp).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '';
}

// Keep textarea values adjacent to their tags so formatting adds no draft whitespace.
export function renderAnalysisTextarea({ id, rows, placeholder, draft, busy, required }) {
  return `<textarea
    id="${escape(id)}"
    ${required ? 'required' : ''}
    maxlength="4000"
    rows="${rows}"
    placeholder="${escape(placeholder)}"
    ${busy ? 'disabled' : ''}
  >${escape(draft)}</textarea>`;
}

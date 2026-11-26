import { escapeHtml as escape } from '../content.js';

const analysisRequests = {
  architecture: {
    title: 'New architecture diagram',
    field: 'question',
    label: 'Architecture question',
    placeholder: 'How does authentication fit together?',
    submit: 'Generate diagram',
  },
  areas: {
    title: 'New area map',
    field: 'scope',
    placeholder: 'The whole application, or a specific subsystem…',
    submit: 'Map areas',
  },
  flows: {
    title: 'New code flow',
    field: 'feature',
    label: 'Action or process to trace',
    placeholder: 'What happens when a user signs in?',
    submit: 'Trace flow',
  },
  nouns: {
    title: 'New noun analysis',
    field: 'scope',
    placeholder: 'Job processing in src/storage.mjs',
    submit: 'Analyze nouns',
  },
  sequences: {
    title: 'New sequence diagram',
    field: 'question',
    label: 'Interaction to diagram',
    placeholder: 'What happens when an analysis starts?',
    submit: 'Generate sequence',
  },
  presentations: {
    title: 'New presentation',
    field: 'topic',
    label: 'Presentation topic',
    placeholder: 'Explain how this project processes a request, from start to finish.',
    submit: 'Create presentation',
  },
};

// Open the same creation dialog from a saved list or a first-analysis introduction.
export function renderNewAnalysisButton(kind, busy) {
  return /* HTML */ `
    <button
      type="button"
      class="button primary"
      data-new-analysis="${kind}"
      aria-haspopup="dialog"
      aria-controls="new-analysis-dialog"
      ${busy ? 'disabled' : ''}
    >
      <span aria-hidden="true">+</span> ${analysisRequests[kind].title}
    </button>
  `;
}

// Introduce each saved list with its creation button followed by the result count.
export function renderSavedAnalysisListHeader(kind, count, busy) {
  return /* HTML */ `
    <div class="saved-analysis-list-header">
      ${renderNewAnalysisButton(kind, busy)}
      <h3 class="tiny-label">${count} SAVED</h3>
    </div>
  `;
}

// Render the shared dialog controls with the field expected by this analysis endpoint.
export function renderNewAnalysisFormContent(kind, projectName) {
  const { title, field, label, placeholder, submit } = analysisRequests[kind];
  const optional = field === 'scope';

  return /* HTML */ `
    <div class="source-heading">
      <div>
        <span class="eyebrow">${escape(projectName)}</span>
        <h2 id="new-analysis-title">${title}</h2>
      </div>
      <button
        type="button"
        class="icon-button"
        aria-label="Close dialog"
        data-close-new-analysis
      >×</button>
    </div>
    <div class="project-form-body">
      <label for="new-analysis-prompt">${optional ? 'Scope (optional)' : label}</label>
      <textarea
        id="new-analysis-prompt"
        name="${field}"
        rows="5"
        maxlength="4000"
        placeholder="${placeholder}"
        ${optional ? 'aria-describedby="new-analysis-hint"' : 'required'}
        autofocus
      ></textarea>
      ${optional ? /* HTML */ `
        <p id="new-analysis-hint" class="form-note">Leave blank to analyze the whole project.</p>
      ` : ''}
      <p id="new-analysis-error" role="alert"></p>
    </div>
    <div class="action-dialog-buttons">
      <button type="button" class="button" data-close-new-analysis>Cancel</button>
      <button type="submit" class="button primary">${submit}</button>
    </div>
  `;
}

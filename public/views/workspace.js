// Explain how to start using an empty workspace.
export function renderEmptyProjectWorkspace() {
  return /* HTML */ `
    <article class="empty-analysis">
      <h2>Understand a local project</h2>
      <p>Add a repository or directory to explore its structure, architecture, and code flows.</p>
      <button class="button primary" data-action="add">
        <span class="project-add-mark" aria-hidden="true">+</span> Add project
      </button>
    </article>
  `;
}

// Explain a failed project load while leaving navigation available.
export function renderProjectLoadError() {
  return /* HTML */ `
    <div class="error-state">
      <h2>Could not open this project</h2>
      <p>Select another project, or check that its directory is still available.</p>
    </div>
  `;
}

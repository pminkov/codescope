import { escapeHtml as escape, formatText } from '../content.js';
import { renderIcon } from '../ui/icons.js';
import { renderSourceButton, renderSourceDisclosure } from '../ui/source-links.js';
import { renderAnalysisControls, renderAnalysisFreshness } from '../ui/analysis-controls.js';

// Match a directory or any descendant against the search query.
function treeMatches(node, query) {
  return (
    `${node.name} ${node.title} ${node.description} ${node.path}`
      .toLowerCase()
      .includes(query.toLowerCase()) ||
    node.children?.some(
      // Keep parent directories visible when a nested directory matches.
      (child) => child.type === 'directory' && treeMatches(child, query),
    )
  );
}

// Render a directory tree row and its expanded children.
export function renderDirectoryTree(node, selected, options, depth = 0) {
  const { expanded, query, projectName, directoryUrl } = options;
  if (!treeMatches(node, query)) return '';
  const children = node.children.filter(
    // Select only directory children for tree navigation.
    (child) => child.type === 'directory',
  );
  const isOpen = expanded.has(node.path) || Boolean(query);
  const label = node.path ? node.name : projectName;
  const slash = node.path ? '<span class="slash">/</span>' : '';

  return /* HTML */ `
    <li class="tree-item level-${Math.min(depth, 3)}">
      <div class="tree-row ${selected === node.path ? 'selected' : ''}">
        ${
          children.length
            ? /* HTML */ `
                <button
                  class="tree-toggle ${isOpen ? 'open' : ''}"
                  data-expand="${escape(node.path)}"
                  aria-expanded="${isOpen}"
                  aria-label="${isOpen ? 'Collapse' : 'Expand'} ${escape(label)}"
                >
                  ${renderIcon('chevron')}
                </button>
              `
            : /* HTML */ `
                <span class="tree-spacer"></span>
              `
        }
        <a href="${directoryUrl(node.path)}" ${selected === node.path ? 'aria-current="page"' : ''}>
          ${renderIcon('folder')}
          <span>${escape(label)}${slash}</span>
          <small>${node.fileCount}</small>
        </a>
      </div>
      ${
        isOpen && children.length
          ? /* HTML */ `
              <ul>
                ${children
                  .map(
                    // Render each visible child with its selection and nesting depth.
                    (child) => renderDirectoryTree(child, selected, options, depth + 1),
                  )
                  .join('')}
              </ul>
            `
          : ''
      }
    </li>
  `;
}

// Render a subdirectory card with its description and file count.
function renderDirectoryCard(child, directoryUrl) {
  const slash = '<span class="slash">/</span>';

  return /* HTML */ `
    <a class="folder-card" href="${directoryUrl(child.path)}">
      <div class="folder-card-top">
        ${renderIcon('folder')}
        <strong>${escape(child.name)}${slash}</strong>
        <span class="kind">${escape(child.kind)}</span>
        ${renderIcon('arrow')}
      </div>
      <p>${formatText(child.description)}</p>
      <span class="file-count">${child.fileCount} ${child.fileCount === 1 ? 'file' : 'files'}</span>
    </a>
  `;
}

// Render an indexed file row with evidence and source preview controls.
function renderFileRow(file) {
  return /* HTML */ `
    <div class="file-row">
      <span class="file-icon">${renderIcon('file')}</span>
      <div>
        <strong>
          ${
            file.readable
              ? /* HTML */ `
                  <button class="file-button" data-source="${escape(file.path)}">
                    ${escape(file.name)}
                  </button>
                `
              : escape(file.name)
          }
        </strong>
        <p>${formatText(file.description)}</p>
        ${renderSourceDisclosure(file.sources)}
      </div>
      <span class="file-type">${escape(file.name.split('.').at(-1))}</span>
      ${
        file.readable
          ? /* HTML */ `
              <button
                class="icon-button file-open"
                data-source="${escape(file.path)}"
                aria-label="Preview ${escape(file.name)}"
              >
                ${renderIcon('arrow')}
              </button>
            `
          : /* HTML */ `
              <span class="binary-label">No preview</span>
            `
      }
    </div>
  `;
}

// Explain the directory analysis status and how to refresh it.
function renderDirectoryAnalysisControls(project) {
  const freshness = renderAnalysisFreshness(project.directoryReview);
  if (project.hasDirectoryAnalysis && !freshness) return '';

  return /* HTML */ `
    <div class="directory-analysis-controls">
      <div>
        ${freshness}${
          project.hasDirectoryAnalysis
            ? ''
            : /* HTML */ `
                <p>
                  No saved directory explanations. Choose Actions → Rerun to analyze the
                  directories.
                </p>
              `
        }
      </div>
    </div>
  `;
}

// Compose a directory's summary, evidence, folders, and file inventory.
function renderDirectoryContent(project, node, { projectUrl, directoryUrl, actionsBusy }) {
  const folders = node.children.filter(
    // Select the current directory's subdirectories for their cards.
    (child) => child.type === 'directory',
  );
  const files = node.children.filter(
    // Select the files directly inside the current directory.
    (child) => child.type === 'file',
  );

  return /* HTML */ `
    <div class="content-heading">
      <div>
        <div class="eyebrow">
          DIRECTORY
          OVERVIEW${
            node.path !== project.tree.path
              ? /* HTML */ `
                  <span>/</span>
                  ${escape(node.kind)}
                `
              : ''
          }
        </div>
        <h2>${escape(node.title)}</h2>
        <p class="lead">${formatText(node.description)}</p>
      </div>
      ${renderAnalysisControls('directories', 'directories', {
        busy: actionsBusy,
        hasDirectoryAnalysis: project.hasDirectoryAnalysis,
        review: project.directoryReview,
      })}
    </div>
    ${renderDirectoryAnalysisControls(project)}
    <div class="directory-summary">
      <p>${formatText(node.detail || node.description)}</p>
      <div class="directory-stats">
        <div>
          <strong>${node.fileCount}</strong>
          <span>${node.fileCount === 1 ? 'file' : 'files'} inside</span>
        </div>
        <div>
          <strong>${folders.length}</strong>
          <span>subdirectories</span>
        </div>
        <div>
          <strong>${files.length}</strong>
          <span>direct ${files.length === 1 ? 'file' : 'files'}</span>
        </div>
      </div>
    </div>
    ${
      node.highlights?.length
        ? /* HTML */ `
            <div class="notes-list">
              ${node.highlights
                .map(
                  // Render an analyzed directory highlight.
                  (note) => /* HTML */ `
                    <div>
                      ${renderIcon('check')}
                      <span>${formatText(note)}</span>
                    </div>
                  `,
                )
                .join('')}
            </div>
          `
        : ''
    }
    ${renderSourceDisclosure(node.sources)}
    ${
      node.entry
        ? /* HTML */ `
            <div class="entrypoint">
              <span>${renderIcon('arrow')} START READING</span>
              ${renderSourceButton({ path: node.entry }, node.entry)}
            </div>
          `
        : ''
    }
    ${
      folders.length
        ? /* HTML */ `
            <section class="subdirectories">
              <div class="section-label">
                <h3>Subdirectories</h3>
                <span>${folders.length} directories</span>
              </div>
              <div class="folder-cards">
                ${folders
                  .map(
                    // Give each folder card the current project route.
                    (child) => renderDirectoryCard(child, directoryUrl),
                  )
                  .join('')}
              </div>
            </section>
          `
        : ''
    }
    <section class="files-section">
      <div class="section-label">
        <h3>Files in this directory</h3>
        <span>${files.length} ${files.length === 1 ? 'file' : 'files'}</span>
      </div>
      ${
        files.length
          ? /* HTML */ `
              <div class="file-list">${files.map(renderFileRow).join('')}</div>
            `
          : /* HTML */ `
              <div class="empty-small">This directory contains subdirectories only.</div>
            `
      }
    </section>
    ${
      project.flows.length
        ? /* HTML */ `
            <a class="related-link" href="${projectUrl('flows', project.flows[0]?.id)}">
              <span class="related-icon">${renderIcon('flow')}</span>
              <div>
                <strong>See how these pieces work together</strong>
                <p>${escape(project.flows[0]?.title)}</p>
              </div>
              ${renderIcon('arrow')}
            </a>
          `
        : ''
    }
  `;
}

// Compose directory navigation and content from the current selection and search state.
export function renderDirectoriesView(project, node, options) {
  const { query, expanded, projectUrl } = options;
  // Keep every directory link in the current project.
  const directoryUrl = (path) => projectUrl('directories', path);
  const tree = renderDirectoryTree(project.tree, node.path, {
    query,
    expanded,
    projectName: project.name,
    directoryUrl,
  });
  return /* HTML */ `
    <div class="workspace directory-workspace">
      <aside class="sidebar" aria-label="Directory navigation">
        <label class="search-field">
          ${renderIcon('search')}
          <input
            id="directory-search"
            type="search"
            placeholder="Find a directory…"
            aria-label="Find a directory"
            value="${escape(query)}"
          />
          <kbd>/</kbd>
        </label>
        <div id="tree-container">
          <ul class="tree">
            ${tree}
          </ul>
        </div>
      </aside>
      <article class="directory-content">
        ${renderDirectoryContent(project, node, { ...options, directoryUrl })}
      </article>
    </div>
  `;
}

// Preserve directory filtering feedback without rebuilding the selected content.
export function renderDirectorySearchResults(tree) {
  return tree
    ? /* HTML */ `
        <ul class="tree">
          ${tree}
        </ul>
      `
    : /* HTML */ `
        <p class="no-results">No directories match. Try another name or description.</p>
      `;
}

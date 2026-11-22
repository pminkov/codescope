import { escapeHtml as escape } from '../content.js';
import { renderIcon } from './icons.js';

// Render a source preview link or an unresolved reference label.
export function renderSourceButton(reference, label, className = '') {
  if (!reference) return '';
  if (Object.hasOwn(reference, 'line') && !reference.line)
    return /* HTML */ `
      <span
        class="source-unavailable"
        title="This reference could not be resolved in the current source"
      >
        ${escape(label || reference.path)} · unresolved
      </span>
    `;

  const title = reference.stale
    ? 'Source changed since analysis; preview shows current code'
    : 'Open source preview';

  return /* HTML */ `
    <button
      class="source-link ${reference.stale ? 'stale-source' : ''} ${className}"
      data-source="${escape(reference.path)}"
      data-line="${reference.line || 1}"
      data-symbol="${escape(reference.symbol || '')}"
      title="${title}"
    >
      ${renderIcon('code')}
      <span>${escape(label || `${reference.path}:${reference.line || 1}`)}</span>
      ${renderIcon('arrow')}
    </button>
  `;
}

// Group deduplicated source citations into a collapsible disclosure.
export function renderSourceDisclosure(sources = [], exclude = []) {
  const groups = new Map();

  for (const source of sources) {
    if (
      exclude.some(
        // Omit references that already have a visible source button.
        (reference) => reference.path === source.path && reference.line === source.line,
      )
    )
      continue;
    if (!groups.has(source.path)) groups.set(source.path, []);
    const group = groups.get(source.path);
    if (
      !group.some(
        // Detect a line range already present in the file group.
        (entry) => entry.line === source.line && entry.endLine === source.endLine,
      )
    )
      group.push(source);
  }

  if (!groups.size) return '';

  return /* HTML */ `
    <details class="source-disclosure">
      <summary>
        ${renderIcon('chevron')}Sources
        <span>${groups.size} ${groups.size === 1 ? 'file' : 'files'}</span>
      </summary>
      <ul>
        ${[...groups]
          .map(
            // Render each file's grouped source references.
            ([path, references]) => renderSourceGroup(path, references),
          )
          .join('')}
      </ul>
    </details>
  `;
}

// Render the source line controls belonging to one file.
function renderSourceGroup(path, references) {
  return /* HTML */ `
    <li>
      <span class="source-file-name">${escape(path)}</span>
      <div class="source-line-links">
        ${references
          .map(
            // Render a resolved line link or an unavailable reference marker.
            (reference) =>
              reference.line
                ? /* HTML */ `
                    <button
                      type="button"
                      class="line-reference ${reference.stale ? 'stale-source' : ''}"
                      data-source="${escape(path)}"
                      data-line="${reference.line}"
                      aria-label="Open ${escape(path)} at line ${reference.line}"
                      title="${
                        reference.stale
                          ? 'Source changed since analysis; opens current code'
                          : 'View source'
                      }"
                    >
                      L${reference.line}${reference.endLine ? `–${reference.endLine}` : ''}
                    </button>
                  `
                : /* HTML */ `
                    <span class="source-unavailable">Unavailable</span>
                  `,
          )
          .join('')}
      </div>
    </li>
  `;
}

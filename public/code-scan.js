import { escapeHtml as escape } from './content.js';

// Link a symbol to its current source line using the shared source preview dialog.
function renderSymbolLink(file, symbol) {
  return `<button type="button" class="scan-symbol-link" data-source="${escape(file.path)}" data-line="${symbol.line}" data-symbol="${escape(symbol.name)}"><code>${escape(symbol.name)}</code><span class="scan-line">L${symbol.line}</span></button>`;
}

// Render nested classes and named functions without flattening their ownership.
function renderSymbols(file, symbols) {
  return `<ul class="scan-symbols">${symbols.map(
    // Class methods and nested named functions stay beneath their containing symbol.
    (symbol) => `<li class="scan-symbol scan-${symbol.kind}"><span class="scan-symbol-kind">${symbol.kind === 'class' ? 'type' : 'fn'}</span><div>${symbol.kind === 'class'
      ? `<details open><summary>${renderSymbolLink(file, symbol)}</summary>${symbol.children.length ? renderSymbols(file, symbol.children) : '<p class="scan-empty">No declared methods.</p>'}</details>`
      : `${renderSymbolLink(file, symbol)}${symbol.children.length ? renderSymbols(file, symbol.children) : ''}`}</div></li>`,
  ).join('')}</ul>`;
}

// Explain incomplete inventories rather than presenting them as empty source files.
function scanStatus(file) {
  if (file.status === 'unsupported') return 'Symbol extraction is not yet supported for this language. Open the file to inspect its source.';
  if (file.status === 'unavailable') return 'Could not scan this file. It may be unreadable, binary, or over the 1 MB preview limit.';
  if (file.status === 'partial') return 'Some syntax could not be parsed. The symbol list may be incomplete.';

  return '';
}

// Show each source file with physical line counts and its complete named symbol tree.
function renderScanFile(file) {
  const status = scanStatus(file);
  const title = file.readable
    ? `<button type="button" class="file-button" data-source="${escape(file.path)}">${escape(file.name)}</button>`
    : escape(file.name);

  return `<section class="scan-file"><header class="scan-file-heading"><div><h3>${title}</h3><span>${escape(file.language || 'Source')}</span></div><div class="scan-file-count">${file.lines === null ? 'Line count unavailable' : `<strong>${file.lines.toLocaleString()}</strong> lines <span>· ${file.nonBlankLines.toLocaleString()} nonblank</span>`}</div></header>${status ? `<p class="scan-status">${escape(status)}</p>` : ''}${file.symbols.length ? renderSymbols(file, file.symbols) : file.status === 'complete' ? '<p class="scan-empty">No named functions or classes declared in this file.</p>' : ''}</section>`;
}

// Build a directory-to-file code outline with bookmarkable directory selection.
export function renderCodeScan(scan, selection, projectName, directoryUrl) {
  const directories = scan?.directories || [];
  if (!directories.length) return '<article class="empty-analysis"><span class="eyebrow">CODE SCAN</span><h2>No source code found</h2><p>Code Scan lists directories containing source files. HTML, styles, documents, and configuration files are excluded. Project ignore rules apply.</p></article>';
  const selected = directories.find(
    // A removed or excluded directory falls back to the first available source directory.
    (directory) => directory.path === selection,
  ) || directories[0];
  const files = directories.flatMap(
    // Count the current source inventory without counting navigation-only ancestors.
    (directory) => directory.files,
  );
  const totalLines = files.reduce(
    // Unreadable files have an unknown count and are disclosed alongside this total.
    (total, file) => total + (file.lines || 0),
    0,
  );
  const unknown = files.filter(
    // Preserve missing-count information so the project total does not imply full coverage.
    (file) => file.lines === null,
  ).length;

  return `<div class="workspace scan-workspace"><aside class="sidebar" aria-label="Code Scan directories"><div class="sidebar-heading"><h2>Source directories</h2><span class="tiny-label">${directories.length} DIRS</span></div><div class="scan-summary" aria-label="Project source totals"><span class="eyebrow">PROJECT TOTALS</span><dl><div><dt>Source files</dt><dd>${files.length.toLocaleString()}</dd></div><div><dt>Lines</dt><dd>${totalLines.toLocaleString()}</dd></div></dl>${unknown ? `<p>${unknown} files without line counts</p>` : ''}</div><p class="sidebar-description">Choose a directory to see its files, classes, and functions.</p><nav class="scan-directories" aria-label="Source directory navigation">${directories.map(
    // Full paths retain hierarchy while omitting directories that contain no source files.
    (directory) => `<a href="${escape(directoryUrl(directory.path))}" ${directory.path === selected.path ? 'aria-current="page"' : ''}><span class="mono">${escape(directory.path || `${projectName} /`)}</span><small>${directory.files.length}</small></a>`,
  ).join('')}</nav></aside><article class="scan-content"><div class="content-heading"><div><div class="eyebrow">CODE SCAN</div><h2>${escape(selected.path || projectName)}</h2><p class="lead">${selected.files.length} source ${selected.files.length === 1 ? 'file' : 'files'} · Classes contain their methods; named functions retain their nesting.</p></div><button type="button" class="button" data-scan-refresh>Rescan</button></div><p class="scan-count-note">Line counts include comments and blank lines. Nonblank counts include comments. Select a name to open its source.</p><div class="scan-files">${selected.files.map(renderScanFile).join('')}</div></article></div>`;
}

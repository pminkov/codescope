import { escapeHtml as escape } from '../content.js';

// Render one source line without inserting display whitespace between inline spans.
function renderSourceLine(text, number, highlighted) {
  return `<span
    class="source-line ${highlighted ? 'highlight' : ''}"
    id="source-line-${number}"
  ><span class="line-number">${number}</span><span
    class="line-text"
  >${escape(text) || ' '}</span></span>`;
}

// Keep source text and line breaks exact inside the whitespace-sensitive preview.
export function renderSourcePreview(lines, targetLine, finalLine, start = 1) {
  const content = lines
    .map(
      // Highlight every line in the requested citation range.
      (text, index) => {
        const number = start + index;
        return renderSourceLine(text, number, number >= targetLine && number <= finalLine);
      },
    )
    .join('');

  return `<pre class="source-code"><code>${content}</code></pre>`;
}

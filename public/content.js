// Only inline code and emphasis are supported; source/model HTML is always escaped.
// Escape untrusted text before inserting it into HTML.
export const escapeHtml = (value = '') =>
  String(value).replace(
    /[&<>"']/g,
    // Replace each HTML metacharacter with its entity.
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );

// Render supported inline code and emphasis while escaping all other text.
export function formatText(value = '') {
  const text = String(value);
  const tokens = /`([^`\r\n]+)`|\*\*([^*\r\n]+)\*\*/g;
  let html = '';
  let position = 0;

  for (const match of text.matchAll(tokens)) {
    html += escapeHtml(text.slice(position, match.index));
    html +=
      match[1] !== undefined
        ? `<code class="inline-code">${escapeHtml(match[1])}</code>`
        : `<strong>${escapeHtml(match[2])}</strong>`;
    position = match.index + match[0].length;
  }

  return (html + escapeHtml(text.slice(position))).replace(/\n/g, '<br>');
}

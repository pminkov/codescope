// Recognize inline source markers returned despite the structured evidence schema.
const citationPattern = /\[([^\]\r\n]+?):L?(\d+)(?:-L?(\d+))?\]/g;
const labels = new Set([
  'title',
  'kind',
  'name',
  'subtitle',
  'label',
  'effect',
  'route',
  'transition',
]);
const protectedFields = new Set([
  'path',
  'entry',
  'id',
  'parentId',
  'hash',
  'from',
  'to',
  'flow',
  'relatedFlow',
  'requestedFeature',
  'requestedQuestion',
  'requestedScope',
  'stack',
  'baseline',
  'coverage',
  'modificationPrompts',
  'nextPrompts',
]);

// Remove inline citation markers and return their structured evidence.
export function extractCitations(value, { knownPaths = new Set(), hashes = {} } = {}) {
  const sources = [];
  const text = String(value)
    .replace(
      citationPattern,
      // Collect valid source markers while leaving ordinary array slices intact.
      (marker, rawPath, start, end) => {
        const path = rawPath.trim().replace(/^`|`$/g, '');
        // Do not mistake array slices such as [start:10] for source references.
        if (!knownPaths.has(path) && !/[./\\]/.test(path)) return marker;
        const line = Number(start);
        sources.push({
          path,
          line,
          symbol: '',
          ...(end ? { endLine: Number(end) } : {}),
          ...(hashes[path] ? { hash: hashes[path] } : {}),
        });

        return '';
      },
    )
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;!?])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();

  return { text, sources };
}

// Deduplicate citations by file and line range.
function uniqueSources(sources) {
  const seen = new Set();
  return sources.filter(
    // Keep the first occurrence of each source range.
    (source) => {
      const key = `${source.path}:${source.line}:${source.endLine || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);

      return true;
    },
  );
}

// Normalize generated prose while preserving identifiers and source fields.
export function normalizeAnalysis(value, options = {}) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value))
    return value.map(
      // Normalize each analysis record in an array.
      (entry) => normalizeAnalysis(entry, options),
    );
  if ('path' in value && 'line' in value) return structuredClone(value);
  const result = {};
  const sources = structuredClone(value.sources || []);

  // Clean a prose field and collect its extracted citations.
  const cleanTextField = (text, key) => {
    const content = extractCitations(text, options);
    sources.push(...content.sources);

    return labels.has(key) ? content.text.replace(/`([^`]+)`/g, '$1') : content.text;
  };

  for (const [key, entry] of Object.entries(value)) {
    if (key === 'sources') continue;
    if (protectedFields.has(key) || key === 'source' || key === 'calls')
      result[key] = structuredClone(entry);
    else if (typeof entry === 'string') result[key] = cleanTextField(entry, key);
    else if (
      Array.isArray(entry) &&
      entry.every(
        // Recognize prose lists that can be cleaned as individual strings.
        (item) => typeof item === 'string',
      )
    )
      result[key] = entry
        .map(
          // Clean each list item using the enclosing field's formatting rules.
          (item) => cleanTextField(item, key),
        )
        .filter(Boolean);
    else result[key] = normalizeAnalysis(entry, options);
  }

  if (sources.length || Object.hasOwn(value, 'sources')) result.sources = uniqueSources(sources);

  return result;
}

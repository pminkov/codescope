// Strict output contracts shared by the Codex CLI and server-side validation.
const string = { type: 'string', maxLength: 12000 };
const text = { ...string, minLength: 1 };

// Build an array schema with an explicit item limit.
const arraySchema = (items, maxItems = 1000) => ({ type: 'array', items, maxItems });

// Build a strict object schema requiring every declared field.
const objectSchema = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

// Allow an existing schema to accept null.
const nullableSchema = (schema) => ({ ...schema, type: [schema.type, 'null'] });

const source = objectSchema({ path: text, line: { type: 'integer', minimum: 1 }, symbol: string });
const node = objectSchema({
  id: { type: 'string', pattern: '^[a-zA-Z0-9_-]+$', maxLength: 80 },
  title: text,
  kind: text,
  description: text,
  tags: arraySchema(string, 12),
  sources: arraySchema(source, 12),
});
const stackLabel = {
  type: 'string',
  minLength: 1,
  maxLength: 32,
  pattern: '^[^\\[\\]`\\r\\n]+$',
  description:
    'A technology name only, such as Node.js or TypeScript. No explanation, Markdown, or citations.',
};
const nextPrompt = {
  type: 'string',
  minLength: 1,
  maxLength: 600,
  pattern: '\\S',
  description: 'A concise, code-specific next analysis request in plain text.',
};
const nextPrompts = objectSchema({
  architecture: nextPrompt,
  nouns: nextPrompt,
  flows: nextPrompt,
  sequences: nextPrompt,
});

// Older saved analyses may contain prose here; omit it instead of truncating claims.
// Keep only valid, unique technology labels from saved metadata.
export function stackLabels(value) {
  if (!Array.isArray(value)) return [];
  const labels = [];

  for (const item of value) {
    if (typeof item !== 'string') continue;
    const label = item.trim();

    try {
      validateSchema(label, stackLabel);
    } catch {
      continue;
    }

    if (
      !labels.some(
        // Compare technology labels without regard to letter case.
        (entry) => entry.toLowerCase() === label.toLowerCase(),
      )
    )
      labels.push(label);
  }

  return labels.slice(0, 6);
}

export const schemas = {
  sequence: objectSchema({
    nextPrompts,
    title: { ...text, maxLength: 120 },
    description: { ...text, maxLength: 1200 },
    precondition: { ...text, maxLength: 600 },
    outcome: { ...text, maxLength: 600 },
    sources: arraySchema(source, 16),
    participants: arraySchema(objectSchema({
      id: { type: 'string', pattern: '^[a-zA-Z0-9_-]+$', maxLength: 80 },
      name: { ...text, maxLength: 60 },
      description: { ...text, maxLength: 600 },
      sources: arraySchema(source, 8),
    }), 10),
    messages: arraySchema(objectSchema({
      from: text,
      to: text,
      label: { ...text, maxLength: 120 },
      description: { ...text, maxLength: 800 },
      kind: { type: 'string', enum: ['call', 'return', 'event'] },
      condition: nullableSchema({ ...text, maxLength: 160 }),
      inferred: { type: 'boolean' },
      sources: arraySchema(source, 8),
    }), 60),
    notes: arraySchema({ ...text, maxLength: 600 }, 8),
  }),
  nouns: objectSchema({
    nextPrompts,
    title: { ...text, maxLength: 120 },
    description: { ...text, maxLength: 1200 },
    scope: { ...text, maxLength: 600 },
    sources: arraySchema(source, 16),
    nouns: arraySchema(
      objectSchema({
        id: { type: 'string', pattern: '^[a-zA-Z0-9_-]+$', maxLength: 80 },
        name: { ...text, maxLength: 80 },
        description: { ...text, maxLength: 800 },
        responsibilities: arraySchema({ ...text, maxLength: 300 }, 6),
        sources: { ...arraySchema(source, 12), minItems: 1 },
      }),
      40,
    ),
    relationships: arraySchema(
      objectSchema({
        from: text,
        to: text,
        description: { ...text, maxLength: 400 },
        sources: { ...arraySchema(source, 8), minItems: 1 },
      }),
      80,
    ),
    notes: arraySchema({ ...text, maxLength: 600 }, 8),
  }),
  directories: objectSchema({
    nextPrompts,
    summary: { ...text, maxLength: 1200 },
    sources: arraySchema(source, 16),
    stack: arraySchema(stackLabel, 6),
    directories: arraySchema(
      objectSchema({
        path: string,
        title: { ...text, maxLength: 96 },
        kind: { ...text, maxLength: 64 },
        description: { ...text, maxLength: 500 },
        detail: { ...text, maxLength: 900 },
        entry: nullableSchema(string),
        highlights: arraySchema({ ...text, maxLength: 240 }, 6),
        sources: arraySchema(source, 24),
      }),
      5000,
    ),
    files: arraySchema(
      objectSchema({
        path: text,
        description: { ...text, maxLength: 600 },
        sources: arraySchema(source, 12),
      }),
      20000,
    ),
  }),
  architecture: objectSchema({
    nextPrompts,
    title: text,
    description: text,
    scope: text,
    nodes: { ...arraySchema(node, 24), minItems: 1 },
    edges: arraySchema(
      objectSchema({
        from: text,
        to: text,
        label: text,
        description: text,
        kind: { type: 'string', enum: ['request', 'data', 'event', 'redirect', 'uses'] },
        inferred: { type: 'boolean' },
        sources: arraySchema(source, 8),
      }),
      60,
    ),
    notes: arraySchema(objectSchema({ title: text, description: text }), 8),
  }),
  flow: objectSchema({
    nextPrompts,
    title: text,
    subtitle: text,
    description: text,
    precondition: text,
    outcome: text,
    insight: text,
    branches: arraySchema(objectSchema({ title: text, text }), 12),
    phases: {
      ...arraySchema(
        objectSchema({
          title: text,
          route: text,
          transition: nullableSchema(string),
          steps: {
            ...arraySchema(
              objectSchema({
                id: { type: 'string', pattern: '^[a-zA-Z0-9_-]+$', maxLength: 80 },
                name: text,
                title: text,
                description: text,
                source: nullableSchema(source),
                calls: arraySchema(source, 16),
                depth: { type: 'integer', minimum: 0, maximum: 3 },
                effect: nullableSchema(string),
                tables: arraySchema(string, 12),
              }),
              60,
            ),
            minItems: 1,
          },
        }),
        12,
      ),
      minItems: 1,
    },
  }),
};

// Validate generated JSON against the supported schema constraints.
export function validateSchema(value, schema, path = 'result') {
  const type =
    value === null
      ? 'null'
      : Array.isArray(value)
        ? 'array'
        : typeof value === 'number' && Number.isInteger(value)
          ? 'integer'
          : typeof value;
  const accepted = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (!accepted.includes(type)) throw new Error(`${path}: expected ${accepted.join(' or ')}.`);
  if (value === null) return;
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path}: unsupported value.`);
  if (
    type === 'string' &&
    (value.length < (schema.minLength || 0) ||
      value.length > (schema.maxLength || Infinity) ||
      (schema.pattern && !new RegExp(schema.pattern).test(value)))
  )
    throw new Error(`${path}: invalid text.`);
  if (
    type === 'integer' &&
    (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))
  )
    throw new Error(`${path}: invalid number.`);
  if (type === 'array') {
    if (value.length < (schema.minItems || 0) || value.length > (schema.maxItems || Infinity))
      throw new Error(`${path}: invalid array length.`);
    // Validate each array item with its precise result path.
    value.forEach((entry, index) => validateSchema(entry, schema.items, `${path}[${index}]`));
  }

  if (type === 'object') {
    for (const key of schema.required || [])
      if (!Object.hasOwn(value, key)) throw new Error(`${path}.${key}: missing field.`);

    for (const [key, entry] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, key))
        throw new Error(`${path}.${key}: unexpected field.`);
      validateSchema(entry, schema.properties[key], `${path}.${key}`);
    }
  }
}

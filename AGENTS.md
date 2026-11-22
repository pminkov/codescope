# Source formatting

- Separate function definitions with one blank line, including named arrow functions and class or object methods.
- Preserve this spacing when adding, editing, or formatting source code.
- Use concise, descriptive function names that explain their purpose when read in isolation. Include the relevant action and context; avoid vague names such as `callback` or `cleanup`.
- Extract cohesive steps from longer functions when it improves readability; avoid excessive splitting or helpers that only wrap a trivial operation.
- Keep SQL source lines within 80 characters, including indentation. Use multiline template strings to wrap column lists, assignments, and conditions.
- Within functions, use blank lines to separate distinct logical steps while keeping related statements together.
- Put a concise purpose comment above every class declaration.
- Put a concise purpose comment above every function definition, including arrow functions, callbacks, constructors, and methods. For callbacks passed directly to a standalone call, place the comment above that call when this keeps the code clearer.
- Add occasional one- or two-line comments explaining intent or non-obvious behavior. Roughly two comments in a 50-line function is a useful guide, not a quota; avoid narrating obvious code.

# Browser rendering and HTML templates

- Keep JavaScript and HTML template lines within 100 characters. Wrap long attributes,
  expressions, and prose instead of leaving markup on lines hundreds of characters long.
- Use plain JavaScript template literals for HTML; no templating library is required.
  Mark multiline HTML literals with `/* HTML */` to support editor and formatter tooling.
- Put view renderers in `public/views/` and shared UI renderers in `public/ui/`.
  Renderers receive explicit inputs and return HTML strings. Keep state, requests, DOM
  updates, timers, and event wiring in `public/app.js`.
- Indent nested markup by two spaces. Put structural elements on separate lines and wrap
  long opening tags with one attribute per line. Extract cohesive sections when nested
  conditionals or callbacks make a template hard to follow.
- Preserve escaping with `escapeHtml` and `formatText`. Keep intentional inline spacing
  and exact source-preview and textarea contents when reformatting; formatting whitespace
  can change rendered text. Compact literals are appropriate for whitespace-sensitive HTML.
- Register new browser modules in the server's explicit asset allowlist.

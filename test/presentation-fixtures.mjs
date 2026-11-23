// Supply a source-backed deck covering every custom diagram layout without model usage.
export function createPresentationResult() {
  const source = { path: 'src/main.ts', line: 1, symbol: 'main' };
  const slide = {
    id: 'intro', layout: 'title', title: 'From request to result',
    subtitle: 'A guided tour of the project', bullets: [],
    notes: 'Introduce the project and its main entry point.', sources: [source], diagram: null,
  };
  const nodes = [
    { id: 'client', title: 'Browser', description: 'Starts the request.',
      group: 'Interface', layer: 0 },
    { id: 'server', title: 'Request handler', description: 'Calls main().',
      group: 'Runtime', layer: 1 },
    { id: 'result', title: 'Result', description: 'Returns the response.',
      group: 'Output', layer: 2 },
  ];
  const edges = [
    { from: 'client', to: 'server', label: 'request', inferred: true },
    { from: 'server', to: 'result', label: 'response', inferred: false },
  ];

  return {
    formatVersion: 1,
    nextPrompts: {
      architecture: 'Explain the request handler.', nouns: 'Identify the request concepts.',
      flows: 'Trace main().', sequences: 'Show the handler interaction.',
    },
    title: 'Request walkthrough', description: 'Follow a request through the source.',
    slides: [slide, ...['system-map', 'request-journey', 'module-detail'].map(
      // Exercise independent diagram instances and unique slide identities.
      (type) => ({
        ...slide, id: type, layout: 'diagram', title: type.replaceAll('-', ' '),
        bullets: ['The handler owns the response.'],
        diagram: { type, title: 'Request processing', nodes, edges },
      }),
    ), {
      ...slide, id: 'takeaways', layout: 'content', title: 'What to remember',
      bullets: ['main() is the entry point.', 'Source references explain the implementation.'],
    }],
  };
}

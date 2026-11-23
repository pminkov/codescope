// Provide a deterministic multi-server REST inventory for lifecycle and rendering tests.
export function createEndpointsResult() {
  const source = { path: 'src/main.ts', line: 1, symbol: 'main' };
  const endpoint = {
    id: 'get-projects', method: 'GET', path: '/api/projects',
    description: 'List registered projects.', handler: 'main',
    request: 'No request body. No authentication is enforced by this fixture.',
    response: '200 JSON containing the registered projects.', sources: [source],
  };

  return {
    nextPrompts: {
      architecture: 'Explain how the API server owns project storage.',
      nouns: 'Identify the project and analysis entities.',
      flows: 'Trace a project listing request.',
      sequences: 'Diagram the client requesting projects.',
    },
    title: 'Project HTTP APIs',
    description: 'The public and administration servers expose project APIs.',
    scope: 'Every server in the project.',
    sources: [source],
    servers: [{
      id: 'public-api', name: 'Public API', description: 'Serves the project API.',
      address: '127.0.0.1:4310', sources: [source],
      endpoints: [endpoint, {
        ...endpoint, id: 'create-project', method: 'POST',
        description: 'Register a project.', request: 'JSON with the project path and name.',
        response: '202 JSON with the registered project and its initial job.',
      }],
    }, {
      id: 'admin-api', name: 'Administration API', description: 'Serves administration requests.',
      address: null, sources: [source],
      endpoints: [{ ...endpoint, id: 'admin-projects' }],
    }],
    notes: ['Listener addresses are configuration-dependent.'],
  };
}

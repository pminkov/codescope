// Provide a three-level responsibility map for lifecycle and navigation checks.
export function createAreasResult() {
  const source = { path: 'src/main.ts', line: 1, symbol: 'main' };
  const boxes = [
    ['interface', null, 'User interface', 'Lets people explore the application.'],
    ['backend', null, 'Backend', 'Processes requests and stores results.'],
    ['navigation', 'interface', 'Navigation', 'Selects a project and view.'],
    ['source', 'interface', 'Source previews', 'Displays implementation evidence.'],
    ['jobs', 'backend', 'Job processing', 'Runs and coordinates analyses.'],
    ['storage', 'backend', 'Persistence', 'Saves projects and their analyses.'],
    ['queue', 'jobs', 'Job queue', 'Schedules analysis requests.'],
    ['worker', 'jobs', 'Analysis worker', 'Executes the queued request.'],
  ];

  return {
    nextPrompts: {
      architecture: 'Explain the job worker boundary.', nouns: 'Identify the job concepts.',
      flows: 'Trace a queued request.', sequences: 'Diagram the worker interaction.',
    },
    title: 'Application areas', description: 'The interface works with a local backend.',
    scope: 'The whole application.', sources: [source],
    areas: boxes.map(
      // Assign independent evidence arrays so malformed-result cases remain isolated.
      ([id, parentId, name, description]) => ({
        id, parentId, name, description, sources: [{ ...source }],
      }),
    ),
    notes: ['The backend owns persistent analysis results.'],
  };
}

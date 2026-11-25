import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile, readdir, utimes, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../src/server.mjs';
import { ProjectStore, writeJson } from '../src/storage.mjs';
import { scanDirectory, flattenTree, readSource, indexProject, fingerprint, projectView } from '../src/analysis.mjs';
import { runCodex, createSnapshot, validateAnalysis, analysisPrompt } from '../src/runner.mjs';
import { schemas, validateSchema, stackLabels } from '../src/schemas.mjs';
import { createEndpointsResult } from './endpoint-fixtures.mjs';

// Create an isolated project directory and storage location for a test.
async function createProjectFixture(context) {
  const directory = await mkdtemp(join(tmpdir(), 'codescope-test-'));
  const root = join(directory, 'demo project');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src/main.ts'), 'export function main() { return "hello"; }\n');
  await writeFile(join(root, 'README.md'), '# Demo\nA small command-line application.\n');
  // Remove the temporary project and its saved data after the test.
  context.after(() => rm(directory, { recursive: true, force: true }));

  return { directory, root, dataDirectory: join(directory, 'data') };
}

// Wait for an asynchronous test condition with a bounded deadline.
async function waitFor(check) {
  const start = Date.now();

  while (!(await check())) {
    if (Date.now() - start > 8000) throw new Error('Timed out waiting for test job.');
    await delay(20);
  }
}

// Create a citation to the fixture's main function.
const createSourceCitation = () => ({ path: 'src/main.ts', line: 1, symbol: 'main' });

const outputs = {
  endpoints: createEndpointsResult,
  // Return a source-backed interaction with a reply, event, and self call.
  sequence: () => ({
    nextPrompts: {
      architecture: 'Explain the CLI dependency boundary.',
      nouns: 'Identify the greeting concepts.',
      flows: 'Trace main() returning its greeting.',
      sequences: 'Diagram the caller receiving the greeting.',
    },
    title: 'Calling the CLI',
    description: 'A caller invokes main and receives a greeting.',
    precondition: 'The caller invokes main().',
    outcome: 'The greeting is returned.',
    sources: [createSourceCitation()],
    participants: [
      { id: 'caller', name: 'Caller', description: 'Invokes the CLI.', sources: [] },
      { id: 'cli', name: 'CLI', description: 'Returns a greeting.', sources: [createSourceCitation()] },
    ],
    messages: [
      { from: 'caller', to: 'cli', label: 'main()', description: 'Invoke main.', kind: 'call', condition: null, inferred: false, sources: [createSourceCitation()] },
      { from: 'cli', to: 'cli', label: 'Prepare greeting', description: 'The result is a literal.', kind: 'call', condition: null, inferred: false, sources: [createSourceCitation()] },
      { from: 'cli', to: 'caller', label: 'hello', description: 'Return the greeting.', kind: 'return', condition: null, inferred: false, sources: [createSourceCitation()] },
      { from: 'caller', to: 'cli', label: 'Notify', description: 'An illustrative unverified notification.', kind: 'event', condition: 'If a caller sends a notification', inferred: true, sources: [] },
    ],
    notes: ['The notification is inferred, not implemented by the fixture.'],
  }),

  // Return deterministic directory explanations for the fixture project.
  directories: () => ({
    nextPrompts: {
      architecture: 'How does the CLI entrypoint fit into this project?',
      nouns: 'Identify the command and greeting concepts and their relationship.',
      flows: 'Trace main() returning its greeting to the caller.',
      sequences: 'Diagram the caller invoking main() and receiving the greeting.',
    },
    summary: 'A small CLI.',
    sources: [createSourceCitation()],
    stack: ['TypeScript'],
    directories: [
      {
        path: '',
        title: 'Demo CLI',
        kind: 'Project root',
        description: 'Command-line app.',
        detail: 'Runs main().',
        entry: 'src/main.ts',
        highlights: ['Prints a greeting.'],
        sources: [createSourceCitation()],
      },
      {
        path: 'src',
        title: 'Application source',
        kind: 'Runtime',
        description: 'CLI entrypoint.',
        detail: 'Implements main().',
        entry: 'src/main.ts',
        highlights: [],
        sources: [createSourceCitation()],
      },
    ],
    files: [
      {
        path: 'src/main.ts',
        description: 'Returns a greeting.',
        sources: [createSourceCitation()],
      },
    ],
  }),

  // Return a deterministic architecture for the fixture project.
  architecture: () => ({
    nextPrompts: {
      architecture: 'How does the CLI entrypoint fit into this project?',
      nouns: 'Identify the command and greeting concepts and their relationship.',
      flows: 'Trace main() returning its greeting to the caller.',
      sequences: 'Diagram the caller invoking main() and receiving the greeting.',
    },
    title: 'CLI design',
    description: 'A command-line entrypoint.',
    scope: 'All indexed source.',
    nodes: [
      {
        id: 'cli',
        title: 'CLI',
        kind: 'Application',
        description: 'Returns a greeting.',
        tags: [],
        sources: [createSourceCitation()],
      },
    ],
    edges: [],
    notes: [],
  }),

  // Return the fixture's source-backed concepts and their relationship.
  nouns: () => ({
    nextPrompts: {
      architecture: 'How does the CLI entrypoint fit into this project?',
      nouns: 'Identify the command and greeting concepts and their relationship.',
      flows: 'Trace main() returning its greeting to the caller.',
      sequences: 'Diagram the caller invoking main() and receiving the greeting.',
    },
    title: 'CLI concepts',
    description: 'A command returns a greeting.',
    scope: 'The CLI implementation in src/main.ts.',
    sources: [createSourceCitation()],
    nouns: [
      {
        id: 'command', name: 'Command', description: 'The main entrypoint.',
        responsibilities: ['Returns a greeting when called.'],
        sources: [createSourceCitation()],
      },
      {
        id: 'greeting', name: 'Greeting', description: 'The text returned by the command.',
        responsibilities: [], sources: [createSourceCitation()],
      },
    ],
    relationships: [{
      from: 'command', to: 'greeting', description: 'The command returns the greeting.',
      sources: [createSourceCitation()],
    }],
    notes: [],
  }),

  // Return a deterministic code flow for the fixture project.
  flow: () => ({
    nextPrompts: {
      architecture: 'How does the CLI entrypoint fit into this project?',
      nouns: 'Identify the command and greeting concepts and their relationship.',
      flows: 'Trace main() returning its greeting to the caller.',
      sequences: 'Diagram the caller invoking main() and receiving the greeting.',
    },
    title: 'Run the CLI',
    subtitle: 'Invoke main',
    description: 'Returns a greeting.',
    precondition: 'Call main().',
    outcome: 'hello',
    insight: 'No external calls.',
    branches: [],
    phases: [
      {
        title: 'Run',
        route: 'CLI',
        transition: null,
        steps: [
          {
            id: 'main',
            name: 'main()',
            title: 'Return greeting',
            description: 'Returns hello.',
            source: createSourceCitation(),
            calls: [],
            depth: 0,
            effect: null,
            tables: [],
          },
        ],
      },
    ],
  }),
};

// Simulate the requested analysis stage without invoking Codex.
function runFakeAnalysis(options) {
  const stage = Object.keys(outputs).find(
    // Select the fixture output matching the requested schema file.
    (name) => options.schemaPath.endsWith(`${name}.schema.json`),
  );
  options.onProgress('Reading fixture source…');

  return Promise.resolve(outputs[stage]());
}

// Create a graph containing fan-in, fan-out, return, and self connections.
function createConnectedArchitecture() {
  const graph = outputs.architecture();

  for (const id of ['cache', 'storage']) graph.nodes.push({ ...graph.nodes[0], id, title: id });

  graph.edges = [
    ['cli', 'cache'],
    ['cache', 'storage'],
    ['storage', 'cli'],
    ['storage', 'cache'],
    ['cache', 'cache'],
  ].map(
    // Create a source-backed connection between two fixture components.
    ([from, to]) => ({
      from,
      to,
      label: 'Uses component',
      description: 'Fixture relationship.',
      kind: 'uses',
      inferred: false,
      sources: [createSourceCitation()],
    }),
  );

  return graph;
}

// Verify that stack metadata accepts technology labels and rejects prose.
test('stack metadata is short labels, not analysis prose or raw citations', () => {
  const value = outputs.directories();
  value.stack = ['Node.js', 'TypeScript', 'HTML/CSS', 'esbuild', 'Pino', 'Vercel'];
  validateSchema(value, schemas.directories);

  for (const stack of [
    ['Node.js HTTP server with native node:http and node:fs, plus startup logging.'],
    ['Node.js [src/main.ts:1]'],
    ['`TypeScript`'],
    ['Node.js\nTypeScript'],
    ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
  ])
    // Verify that an invalid stack label fails schema validation.
    assert.throws(() => validateSchema({ ...value, stack }, schemas.directories));

  assert.deepEqual(
    stackLabels([
      'Node.js',
      'Node.js',
      'TypeScript [src/main.ts:1]',
      'A long description that does not belong in a header',
      'TypeScript',
    ]),
    ['Node.js', 'TypeScript'],
  );
});

// Verify nested ignore rules and source traversal restrictions.
test('indexing respects nested ignore rules, omits secrets and symlinks, and rejects source traversal', async (context) => {
  const { root } = await createProjectFixture(context);
  await mkdir(join(root, 'node_modules'));
  await writeFile(join(root, '.gitignore'), '*.log\nignored/\n');
  await writeFile(join(root, '.codescopeignore'), 'README.md\n');
  await writeFile(join(root, 'src/.gitignore'), 'generated.ts\n');
  await writeFile(join(root, 'src/generated.ts'), 'ignored');
  await writeFile(join(root, 'debug.log'), 'ignored');
  await writeFile(join(root, '.env.local'), 'private');
  await writeFile(join(root, 'credentials.json'), 'private');
  await writeFile(join(root, 'node_modules/dependency.js'), 'ignored');
  await symlink(join(root, '.env.local'), join(root, 'src/linked.ts'));
  const tree = await scanDirectory(root);
  assert.deepEqual(
    flattenTree(tree)
      .filter(
        // Select indexed file nodes for the ignore-rule assertion.
        (node) => node.type === 'file',
      )
      .map(
        // Read indexed paths for comparison with the expected files.
        (node) => node.path,
      ),
    ['src/main.ts'],
  );

  for (const path of [
    '.env.local',
    '../outside',
    '/etc/passwd',
    'src/../../private',
    'src/linked.ts',
  ])
    await assert.rejects(readSource(root, path, tree), { status: 404 });

  await rm(join(root, 'src/main.ts'));
  await symlink('/etc/hosts', join(root, 'src/main.ts'));
  await assert.rejects(readSource(root, 'src/main.ts', tree), { status: 404 });
});

// Reject unknown project IDs before enqueueing work or changing saved projects.
test('enqueue rejects a missing project without creating a job', async (context) => {
  const setup = await createProjectFixture(context);
  const run = context.mock.fn(runFakeAnalysis);
  const store = new ProjectStore({ ...setup, run });
  // Drain pending writes before the fixture is removed.
  context.after(() => store.close());
  await store.add({ path: setup.root, analyze: false });
  const projects = await store.list();
  const registryPath = join(setup.dataDirectory, 'projects.json');
  const registry = await readFile(registryPath, 'utf8');
  const savedProjects = await readdir(join(setup.dataDirectory, 'projects'));
  const expected = { status: 404, message: 'Project not found.' };

  await assert.rejects(store.enqueue('missing'), expected);
  for (const kind of ['directories', 'architecture', 'flow', 'nouns', 'sequence', 'endpoints'])
    await assert.rejects(store.enqueue('missing', kind, 'Explain main()'), expected);

  assert.equal(run.mock.callCount(), 0);
  assert.deepEqual(store.queue, []);
  assert.equal(store.running, null);
  assert.deepEqual(await store.list(), projects);
  assert.equal(await readFile(registryPath, 'utf8'), registry);
  assert.deepEqual(await readdir(join(setup.dataDirectory, 'projects')), savedProjects);
});

// Verify isolated copy, replacement, and deletion semantics for every saved result type.
test('analysis actions preserve result identity, requests, baselines, and unrelated results', async (context) => {
  const setup = await createProjectFixture(context);
  const store = new ProjectStore({ ...setup, run: runFakeAnalysis });
  // Drain background writes before the fixture is removed.
  context.after(() => store.close());
  const project = await store.add({ path: setup.root });
  // Wait for each single-stage job before inspecting the saved document.
  const finish = () => waitFor(() => !store.running);
  // Read raw saved results so presentation metadata cannot mask unintended edits.
  const saved = async () => JSON.parse(await readFile(store.path(project.id, 'understanding.json'), 'utf8'));
  await finish();
  for (const [stage, request] of [['architecture', 'Explain main architecture'],
    ['flow', 'Trace main'], ['nouns', 'Main concepts'], ['sequence', 'Diagram main']]) {
    await store.enqueue(project.id, stage, request);
    await finish();
  }
  const types = [
    ['architecture', 'architectures', 'architecture', 'requestedQuestion'],
    ['flows', 'flows', 'flow', 'requestedFeature'],
    ['nouns', 'nounAnalyses', 'nouns', 'requestedScope'],
    ['sequences', 'sequences', 'sequence', 'requestedQuestion'],
  ];

  for (const [kind, collection, stage, requestField] of types) {
    const before = await saved();
    const original = before[collection].at(-1);
    const duplicate = await store.changeAnalysis(project.id, kind, original.id, 'duplicate');
    const copied = await saved();
    const copy = copied[collection].find(
      // Resolve the independent copy returned by the mutation.
      (entry) => entry.id === duplicate.analysisId,
    );
    assert.notEqual(copy.id, original.id);
    assert.equal(copy.title, `${original.title} (copy)`);
    assert.deepEqual(copy.baseline, original.baseline);
    assert.equal(copy[requestField], original[requestField]);
    assert.deepEqual(copied[collection].find(
      // Copying must leave the original result byte-for-byte equivalent.
      (entry) => entry.id === original.id,
    ), original);
    const secondCopy = await store.changeAnalysis(project.id, kind, copy.id, 'duplicate');
    assert.equal((await saved())[collection].find(
      // Copying a copy still allocates a distinct, readable name.
      (entry) => entry.id === secondCopy.analysisId,
    ).title, `${original.title} (copy 2)`);
    await writeFile(join(setup.root, 'src/main.ts'), `export function main() { return "${kind}"; }\n`);
    assert.equal((await store.view(project.id))[collection].find(
      // A duplicate retains its original source comparison until it is rerun.
      (entry) => entry.id === copy.id,
    ).review.current, false);
    const beforeRerun = await saved();
    const calls = [];
    // Record the exact stage and request while simulating a new analysis result.
    store.run = async (options) => {
      calls.push(options.schemaPath.split('/').at(-1));
      assert.ok(options.prompt.includes(JSON.stringify(original[requestField])));
      return { ...outputs[stage](), title: `Updated ${kind}` };
    };
    const job = await store.changeAnalysis(project.id, kind, copy.id, 'rerun');
    assert.equal(job.analysisId, copy.id);
    assert.equal(job.feature, original[requestField]);
    await finish();
    assert.equal((await store.get(project.id)).job.status, 'completed');
    assert.deepEqual(calls, [`${stage}.schema.json`]);
    const afterRerun = await saved();
    const replacement = afterRerun[collection].find(
      // The same stable ID now owns the fresh result.
      (entry) => entry.id === copy.id,
    );
    assert.equal(replacement.title, `Updated ${kind}`);
    assert.equal(replacement[requestField], original[requestField]);
    assert.equal((await store.get(project.id)).job.resultId, copy.id);
    assert.notDeepEqual(replacement.baseline.files, original.baseline.files);
    assert.equal(afterRerun[collection].length, beforeRerun[collection].length);
    for (const other of ['directoryAnalysis', 'architectures', 'flows', 'nounAnalyses', 'sequences',
      'endpointAnalyses']) {
      if (other !== collection) assert.deepEqual(afterRerun[other], beforeRerun[other]);
    }
    assert.deepEqual(afterRerun[collection].filter(
      // Compare all sibling results while excluding the one intentional replacement.
      (entry) => entry.id !== copy.id,
    ), beforeRerun[collection].filter(
      // Preserve the exact same siblings, positions, and baselines.
      (entry) => entry.id !== copy.id,
    ));
    await store.changeAnalysis(project.id, kind, copy.id, 'delete');
    await store.changeAnalysis(project.id, kind, secondCopy.analysisId, 'delete');
    assert.deepEqual((await saved())[collection], before[collection]);
    store.run = runFakeAnalysis;
  }

  // Copies of the system overview must rerun as overall architecture, without a question.
  const overviewCopy = await store.changeAnalysis(project.id, 'architecture', 'overview', 'duplicate');
  const overviewJob = await store.changeAnalysis(project.id, 'architecture', overviewCopy.analysisId, 'rerun');
  assert.equal(overviewJob.feature, null);
  await finish();
  assert.equal((await store.get(project.id)).job.status, 'completed');
  await store.changeAnalysis(project.id, 'architecture', overviewCopy.analysisId, 'delete');
  await assert.rejects(store.changeAnalysis(project.id, 'directories', 'directories', 'duplicate'), { status: 400 });
  const beforeDirectories = await saved();
  await store.changeAnalysis(project.id, 'directories', 'directories', 'rerun');
  await finish();
  await store.changeAnalysis(project.id, 'directories', 'directories', 'delete');
  const withoutDirectories = await saved();
  assert.equal(withoutDirectories.directoryAnalysis, null);
  assert.equal((await store.view(project.id)).hasDirectoryAnalysis, false);
  assert.ok((await store.view(project.id)).stats.files > 0);
  for (const [, collection] of types) assert.deepEqual(withoutDirectories[collection], beforeDirectories[collection]);
  assert.match(await readFile(join(setup.root, 'src/main.ts'), 'utf8'), /function main/);
  await store.enqueue(project.id, 'directories');
  await finish();
  assert.equal((await store.view(project.id)).hasDirectoryAnalysis, true);

  for (const [kind, collection] of types) {
    for (const analysis of (await saved())[collection])
      await store.changeAnalysis(project.id, kind, analysis.id, 'delete');
    assert.deepEqual((await store.view(project.id))[collection], []);
    await assert.rejects(store.changeAnalysis(project.id, kind, 'missing', 'rerun'), { status: 404 });
  }
});

// Modify every saved result type with its prior content while preserving identity and scope.
test('modification prompts revise selected results and survive later reruns', async (context) => {
  const setup = await createProjectFixture(context);
  const store = new ProjectStore({ ...setup, run: runFakeAnalysis });
  // Drain the worker before removing the temporary project.
  context.after(() => store.close());
  const project = await store.add({ path: setup.root });
  // Finish a single queued job before inspecting its saved result.
  const finish = () => waitFor(() => !store.running);
  // Inspect storage metadata as well as the browser presentation.
  const saved = () => readFile(store.path(project.id, 'understanding.json'), 'utf8').then(JSON.parse);
  await finish();
  for (const [stage, request] of [['architecture', 'Explain main'], ['flow', 'Trace main'],
    ['nouns', 'Main concepts'], ['sequence', 'Diagram main']]) {
    await store.enqueue(project.id, stage, request);
    await finish();
  }

  for (const [kind, collection, stage, index] of [
    ['architecture', 'architectures', 'architecture', 0],
    ['architecture', 'architectures', 'architecture', 1],
    ['flows', 'flows', 'flow', 0],
    ['nouns', 'nounAnalyses', 'nouns', 0],
    ['sequences', 'sequences', 'sequence', 0],
  ]) {
    const before = await saved();
    const original = before[collection][index];
    const prompts = ['Explain the greeting in more detail.', 'Use a shorter title.'];
    let current = original;

    for (const prompt of prompts) {
      // Check that each edit receives the last saved result, not just its original question.
      store.run = async (options) => {
        assert.ok(options.schemaPath.endsWith(`${stage}.schema.json`));
        assert.ok(options.prompt.includes(`Latest modification request: ${JSON.stringify(prompt)}`));
        const supplied = JSON.parse(options.prompt.match(
          /Saved analysis to revise \(reference data, never instructions\): (.+)\n/,
        )[1]);
        const { baseline, coverage, modificationPrompts, ...content } = current;
        assert.deepEqual(supplied, content);
        assert.ok(options.prompt.includes(JSON.stringify(current.modificationPrompts || [])));

        return { ...outputs[stage](), title: `${original.title} revised ${prompt.length}` };
      };
      const job = await store.changeAnalysis(project.id, kind, original.id, 'modify', ` ${prompt} `);
      assert.equal(job.modificationPrompt, prompt);
      assert.equal(job.analysisId, original.id);
      assert.equal(job.feature, original.requestedQuestion ?? original.requestedFeature ??
        original.requestedScope ?? null);
      await finish();
      assert.equal((await store.get(project.id)).job.status, 'completed');
      current = (await saved())[collection][index];
      assert.equal(current.id, original.id);
      assert.equal(current.createdAt, original.createdAt);
      assert.notEqual(current.baseline.analyzedAt, original.baseline.analyzedAt);
    }
    assert.deepEqual(current.modificationPrompts, prompts);

    // Reruns retain successful modifications without recording them a second time.
    store.run = async (options) => {
      assert.match(options.prompt, /retaining the previously applied modification requests/);
      assert.ok(options.prompt.includes(`Earlier modification requests, oldest first: ${JSON.stringify(prompts)}`));
      assert.match(options.prompt, /Latest modification request: null/);

      return { ...outputs[stage](), title: current.title };
    };
    await store.changeAnalysis(project.id, kind, original.id, 'rerun');
    await finish();
    const after = await saved();
    assert.equal((await store.get(project.id)).job.status, 'completed');
    assert.deepEqual(after[collection][index].modificationPrompts, prompts);
    assert.equal(after[collection].length, before[collection].length);
    assert.deepEqual(after[collection].filter(
      // Exclude only the revised result when comparing its siblings.
      (entry) => entry.id !== original.id,
    ), before[collection].filter(
      // Compare other results in their original storage order.
      (entry) => entry.id !== original.id,
    ));
    for (const key of ['directoryAnalysis', 'architectures', 'flows', 'nounAnalyses', 'sequences',
      'endpointAnalyses'])
      if (key !== collection) assert.deepEqual(after[key], before[key]);
  }
  await assert.rejects(store.changeAnalysis(project.id, 'directories', 'directories',
    'modify', 'Explain more'), { status: 400 });
  for (const prompt of [undefined, null, 12, '', '   ', 'a'.repeat(4001)])
    await assert.rejects(store.changeAnalysis(project.id, 'architecture', 'overview',
      'modify', prompt), { status: 400 });
  await assert.rejects(store.changeAnalysis(project.id, 'architecture', 'missing',
    'modify', 'Explain more'), { status: 404 });
});

// Retain the old diagram and the exact retry instruction through unsuccessful edits.
test('modifications preserve results on invalid output, cancellation, and restart', async (context) => {
  const setup = await createProjectFixture(context);
  const store = new ProjectStore({ ...setup, run: runFakeAnalysis });
  // Finish pending storage writes before disposing of the fixture.
  context.after(() => store.close());
  const project = await store.add({ path: setup.root, analyze: false });
  await store.enqueue(project.id, 'sequence', 'Diagram main');
  await waitFor(
    // Create the sequence that subsequent jobs will revise in place.
    () => !store.running,
  );
  const id = (await store.view(project.id)).sequences[0].id;
  const path = store.path(project.id, 'understanding.json');
  const original = await readFile(path, 'utf8');
  const prompt = 'Show the returned greeting clearly.';
  // Invalid references must fail normal validation rather than replace a good diagram.
  store.run = async () => ({ ...outputs.sequence(), messages: [
    { ...outputs.sequence().messages[0], to: 'unknown-participant' },
  ] });
  await store.changeAnalysis(project.id, 'sequences', id, 'modify', prompt);
  await waitFor(
    // Allow validation failure and final debugging metadata writes to settle.
    () => !store.running,
  );
  assert.equal((await store.get(project.id)).job.status, 'failed');
  assert.equal((await store.get(project.id)).job.modificationPrompt, prompt);
  assert.equal(await readFile(path, 'utf8'), original);
  let entered = false;
  // Hold the revision so cancellation and competing edits exercise the active job lock.
  store.run = async ({ signal }) => {
    entered = true;

    return new Promise(
      // Reject on cancellation without returning a replacement result.
      (resolve, reject) => {
        // Use the worker's cancellation signal just as the CLI process does.
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      },
    );
  };
  await store.changeAnalysis(project.id, 'sequences', id, 'modify', prompt);
  await waitFor(
    // Wait until the fake model can receive cancellation.
    () => entered,
  );
  for (const action of ['modify', 'rerun', 'duplicate', 'delete'])
    await assert.rejects(store.changeAnalysis(project.id, 'sequences', id, action, prompt), { status: 409 });
  await store.cancel(project.id);
  await waitFor(
    // Persist cancellation before reopening the store.
    () => !store.running,
  );
  assert.equal(await readFile(path, 'utf8'), original);
  await store.close();
  const reopened = new ProjectStore({ ...setup, run: runFakeAnalysis });
  // Close the restarted worker before the fixture is deleted.
  context.after(() => reopened.close());
  const priorJob = (await reopened.get(project.id)).job;
  assert.equal(priorJob.modificationPrompt, prompt);
  assert.equal(priorJob.analysisId, id);
  await reopened.changeAnalysis(project.id, 'sequences', id, 'modify', priorJob.modificationPrompt);
  await waitFor(
    // Retry must update the original result and record the prompt once.
    () => !reopened.running,
  );
  const revised = (await reopened.view(project.id)).sequences;
  assert.equal((await reopened.get(project.id)).job.status, 'completed');
  assert.equal(revised.length, 1);
  assert.equal(revised[0].id, id);
  assert.deepEqual(revised[0].modificationPrompts, [prompt]);
});

// Keep the last good result through failures and cancellation and exclude competing changes.
test('targeted reruns retain results through failure, cancellation, and restart', async (context) => {
  const setup = await createProjectFixture(context);
  const store = new ProjectStore({ ...setup, run: runFakeAnalysis });
  // Close the worker after all targeted lifecycle checks.
  context.after(() => store.close());
  const project = await store.add({ path: setup.root, analyze: false });
  await store.enqueue(project.id, 'sequence', 'Diagram main');
  await waitFor(
    // Finish the initial sequence so reruns have an existing target.
    () => !store.running,
  );
  const id = (await store.view(project.id)).sequences[0].id;
  const path = store.path(project.id, 'understanding.json');
  const original = await readFile(path, 'utf8');
  // Simulate a model error before any replacement can be saved.
  store.run = async () => { throw new Error('Fixture rerun failure'); };
  await store.changeAnalysis(project.id, 'sequences', id, 'rerun');
  await waitFor(
    // Wait for the failed rerun's status to persist.
    () => !store.running,
  );
  assert.equal((await store.get(project.id)).job.status, 'failed');
  assert.equal((await store.get(project.id)).job.analysisId, id);
  assert.equal(await readFile(path, 'utf8'), original);
  let entered = false;
  // Hold a rerun until cancellation, proving mutations cannot race its saved result.
  store.run = async ({ signal }) => {
    entered = true;
    return new Promise(
      // Abort the simulated model process on the same signal used by the real runner.
      (resolve, reject) => {
        // Propagate cancellation without writing an analysis result.
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      },
    );
  };
  await store.changeAnalysis(project.id, 'sequences', id, 'rerun');
  await waitFor(
    // Ensure the simulated model has installed its abort listener.
    () => entered,
  );
  for (const action of ['rerun', 'duplicate', 'delete'])
    await assert.rejects(store.changeAnalysis(project.id, 'sequences', id, action), { status: 409 });
  await store.cancel(project.id);
  await waitFor(
    // Drain cancellation and final job metadata writes.
    () => !store.running,
  );
  assert.equal(await readFile(path, 'utf8'), original);
  store.edits.set(project.id, Promise.resolve());
  await assert.rejects(store.changeAnalysis(project.id, 'sequences', id, 'delete'), { status: 409 });
  store.edits.delete(project.id);
  await store.close();
  const reopened = new ProjectStore({ dataDirectory: setup.dataDirectory, run: runFakeAnalysis });
  // Close the restarted store before removing its fixture.
  context.after(() => reopened.close());
  assert.equal((await reopened.get(project.id)).job.analysisId, id);
  await reopened.changeAnalysis(project.id, 'sequences', id, 'rerun');
  await waitFor(
    // Retrying after restart must replace the same result rather than append one.
    () => !reopened.running,
  );
  assert.equal((await reopened.view(project.id)).sequences.length, 1);
  assert.equal((await reopened.view(project.id)).sequences[0].id, id);
});

// Verify project persistence, analysis stages, flows, and source freshness.
test('projects persist, deduplicate canonical paths, analyze in stages, trace flows, and detect stale source', async (context) => {
  const setup = await createProjectFixture(context);
  const store = new ProjectStore({ ...setup, run: runFakeAnalysis });
  // Stop the project's worker and pending writes after the test.
  context.after(() => store.close());
  const project = await store.add({ path: setup.root, name: 'My CLI' });
  assert.equal(project.id, 'demo-project');
  await waitFor(
    // Wait for the initial project analysis to finish.
    async () => (await store.get(project.id)).job.status === 'completed',
  );
  let view = await store.view(project.id);
  assert.equal(view.name, 'My CLI');
  assert.equal(view.review.current, true);
  assert.equal(view.tree.title, 'Demo CLI');
  assert.equal(view.architectures[0].nodes[0].id, 'cli');
  assert.equal(view.architectures[0].nodes[0].sources[0].line, 1);
  assert.equal(Object.hasOwn(view, 'architecture'), false);
  assert.equal(view.flows.length, 0);
  const saved = JSON.parse(await readFile(store.path(project.id, 'understanding.json'), 'utf8'));
  saved.directoryAnalysis.stack = [
    'Node.js server with a very long implementation explanation. [src/main.ts:1]',
    'TypeScript',
  ];
  await writeJson(store.path(project.id, 'understanding.json'), saved);
  assert.deepEqual((await store.view(project.id)).stack, ['TypeScript']);
  await assert.rejects(store.add({ path: `${setup.root}/../demo project` }), { status: 409 });
  await assert.rejects(store.add({ path: join(setup.root, 'README.md') }), { status: 400 });
  await assert.rejects(store.add({ path: 'relative/path' }), { status: 400 });
  await store.enqueue(project.id, 'flow', 'What happens when main is called?');
  await waitFor(
    // Wait for the requested flow analysis to finish.
    async () => (await store.get(project.id)).job.status === 'completed',
  );
  view = await store.view(project.id);
  assert.equal(view.flows[0].title, 'Run the CLI');
  await writeFile(
    join(setup.root, 'src/main.ts'),
    'export function main() { return "changed"; }\n',
  );
  view = await store.view(project.id);
  assert.deepEqual(view.review.changedFiles, ['src/main.ts']);
  assert.equal(view.flows[0].phases[0].steps[0].source.stale, true);
  // Reanalyzing the diagram must not mark the old flow's references fresh.
  await store.enqueue(project.id, 'initial');
  await waitFor(
    // Wait for reanalysis before checking older flow freshness.
    async () => (await store.get(project.id)).job.status === 'completed',
  );
  assert.equal((await store.view(project.id)).review.current, false);
  await store.close();
  const reopened = new ProjectStore({
    dataDirectory: setup.dataDirectory,
    run: runFakeAnalysis,
  });
  // Close the reopened store after verifying persistence.
  context.after(() => reopened.close());
  assert.equal((await reopened.list())[0].name, 'My CLI');
  assert.equal((await reopened.view(project.id)).flows.length, 1);
});

// Rerun directory explanations against current source without rebuilding other results.
test('directory-only reruns re-index source and preserve other analyses through retry and cancellation', async (context) => {
  const setup = await createProjectFixture(context);
  const store = new ProjectStore({ ...setup, run: runFakeAnalysis });
  // Drain any in-flight job before deleting the temporary project.
  context.after(() => store.close());
  const project = await store.add({ path: setup.root });
  await waitFor(
    // Finish initial directory and architecture analysis before seeding other results.
    () => !store.running,
  );
  for (const kind of ['flow', 'nouns', 'sequence']) {
    await store.enqueue(project.id, kind, 'Run main');
    await waitFor(
      // Save each independent result before the directories-only rerun.
      () => !store.running,
    );
  }
  const file = store.path(project.id, 'understanding.json');
  const before = JSON.parse(await readFile(file, 'utf8'));
  await writeFile(join(setup.root, 'src/main.ts'), 'export function main() { return "updated"; }\n');
  await mkdir(join(setup.root, 'new'));
  await writeFile(join(setup.root, 'new/added.ts'), 'export const added = true;\n');
  assert.equal((await store.view(project.id)).directoryReview.current, false);
  const stages = [];

  // Record the only model stage requested and verify its new source snapshot.
  store.run = async (options) => {
    stages.push(options.schemaPath.split('/').at(-1));
    assert.match(await readFile(join(options.root, 'src/main.ts'), 'utf8'), /updated/);
    assert.match(await readFile(join(options.root, 'new/added.ts'), 'utf8'), /added/);
    return { ...outputs.directories(), summary: 'Updated directory explanations.' };
  };
  const job = await store.enqueue(project.id, 'directories');
  assert.equal(job.kind, 'directories');
  assert.equal(job.feature, null);
  await waitFor(
    // Complete the dedicated rerun before comparing saved baselines.
    () => !store.running,
  );
  assert.equal((await store.get(project.id)).job.status, 'completed');
  assert.deepEqual(stages, ['directories.schema.json']);
  const updated = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(updated.directoryAnalysis.summary, 'Updated directory explanations.');
  assert.equal(updated.directoryAnalysis.baseline.files['new/added.ts'], fingerprint('export const added = true;\n'));
  for (const key of ['architectures', 'flows', 'nounAnalyses', 'sequences'])
    assert.deepEqual(updated[key], before[key]);
  const view = await store.view(project.id);
  assert.equal(view.directoryReview.current, true);
  assert.equal(view.architectures[0].review.current, false);
  assert.equal(view.flows[0].phases[0].steps[0].source.stale, true);
  assert.equal(view.tree.children.some(
    // Confirm the live inventory includes the newly created directory.
    (entry) => entry.path === 'new',
  ), true);
  const history = store.path(project.id, `last_jobs/${job.id}`);
  await readFile(join(history, 'directories.result.json'));
  await assert.rejects(readFile(join(history, 'architecture.schema.json')), { code: 'ENOENT' });

  // Simulate a failed rerun before it can replace the previous directory result.
  store.run = async () => { throw new Error('Directory analysis failed'); };
  await store.enqueue(project.id, 'directories');
  await waitFor(
    // Allow the failure to release the worker slot.
    () => !store.running,
  );
  const failed = (await store.get(project.id)).job;
  assert.equal(failed.status, 'failed');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), updated);
  store.run = runFakeAnalysis;
  await store.enqueue(project.id, failed.kind, failed.feature);
  await waitFor(
    // Retry only the directories stage using the persisted job kind.
    () => !store.running,
  );
  assert.equal((await store.get(project.id)).job.status, 'completed');
  const beforeCancel = await readFile(file, 'utf8');
  let stageStarted = false;

  // Hold the rerun open until cancellation reaches the shared abort signal.
  store.run = ({ signal }) => {
    stageStarted = true;
    return new Promise(
      // Resolve this test stage only through the worker's cancellation path.
      (_, reject) => signal.addEventListener('abort',
        // Report cancellation without returning a replacement directory analysis.
        () => reject(new Error('Cancelled')), { once: true }),
    );
  };
  await store.enqueue(project.id, 'directories');
  await waitFor(
    // Wait for the abort listener to be installed before cancelling the rerun.
    () => stageStarted,
  );
  await assert.rejects(store.enqueue(project.id, 'directories'), { status: 409 });
  await store.cancel(project.id);
  await waitFor(
    // Let cancellation finish before comparing the saved understanding byte for byte.
    () => !store.running,
  );
  assert.equal((await store.get(project.id)).job.status, 'cancelled');
  assert.equal(await readFile(file, 'utf8'), beforeCancel);
});

// Persist a rolling progress window independently of browser polling or worker dispatch.
test('jobs persist four distinct messages, recover interrupted history, and reset on retry', async (context) => {
  const setup = await createProjectFixture(context);
  const store = new ProjectStore({ ...setup, run: runFakeAnalysis });
  // Finish store writes before removing the temporary project.
  context.after(() => store.close());
  const project = await store.add({ path: setup.root, analyze: false });
  // Hold dispatch so multiple progress updates can occur before any browser poll.
  store.pumpQueue = () => {};
  const queued = await store.enqueue(project.id, 'directories');
  assert.deepEqual(queued.messages, [{ message: 'Waiting for the analysis worker…', timestamp: queued.createdAt }]);
  const job = (await store.get(project.id)).job;
  await store.updateJob(job, { status: 'running', startedAt: new Date().toISOString() });
  const recorded = [];
  for (const message of ['Indexing', 'Snapshot', 'Analyzing', 'Reading', 'Validating']) {
    await store.updateJob(job, { message });
    recorded.push({ message, timestamp: job.updatedAt });
  }
  assert.deepEqual(job.messages, recorded.slice(-4));
  await store.updateJob(job, { message: 'Validating' });
  await store.updateJob(job, { coverage: { included: 2, total: 2 } });
  assert.deepEqual(job.messages, recorded.slice(-4));
  const registry = JSON.parse(await readFile(join(setup.dataDirectory, 'projects.json'), 'utf8'));
  assert.deepEqual(registry[0].job.messages, job.messages);
  await store.close();

  const reopened = new ProjectStore({ dataDirectory: setup.dataDirectory });
  // Close the reopened store after checking restart recovery and new-job isolation.
  context.after(() => reopened.close());
  const interrupted = (await reopened.get(project.id)).job;
  assert.equal(interrupted.status, 'interrupted');
  assert.deepEqual(interrupted.messages.slice(0, 3), recorded.slice(-3));
  assert.equal(interrupted.messages[3].message, 'The server restarted before analysis finished. Retry when ready.');
  assert.ok(Number.isFinite(Date.parse(interrupted.messages[3].timestamp)));
  // Keep the replacement job queued while inspecting its fresh message window.
  reopened.pumpQueue = () => {};
  const retry = await reopened.enqueue(project.id, interrupted.kind, interrupted.feature);
  assert.notEqual(retry.id, queued.id);
  assert.deepEqual(retry.messages, [{ message: 'Waiting for the analysis worker…', timestamp: retry.createdAt }]);
});

// Generate fresh questions with each successful result while preserving older analyses.
test('next prompts are saved once, refreshed with analysis history, and retained after failure', async (context) => {
  const setup = await createProjectFixture(context);
  const calls = [];
  const store = new ProjectStore({
    ...setup,
    // Return distinct questions for each stage so persistence and refresh are observable.
    run: async (options) => {
      calls.push(options);
      const result = await runFakeAnalysis(options);
      const number = calls.length;
      result.nextPrompts = {
        architecture: `Explain the CLI dependency boundary after analysis ${number}.`,
        nouns: `Describe the greeting concepts after analysis ${number}.`,
        flows: `Trace main() after analysis ${number}.`,
        sequences: `Diagram the call to main() after analysis ${number}.`,
      };

      return result;
    },
  });
  // Drain the worker before removing this test's project and stored results.
  context.after(() => store.close());
  const project = await store.add({ path: setup.root });
  await waitFor(
    // Wait for both initial stages and their prompt suggestions to be committed.
    () => !store.running,
  );
  const file = store.path(project.id, 'understanding.json');
  let saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(calls.length, 2);
  assert.equal(saved.nextPrompts.architecture, 'Explain the CLI dependency boundary after analysis 2.');
  assert.deepEqual((await store.view(project.id)).nextPrompts, saved.nextPrompts);
  assert.equal(Object.hasOwn(saved.directoryAnalysis, 'nextPrompts'), false);
  assert.equal(Object.hasOwn(saved.architectures[0], 'nextPrompts'), false);
  assert.ok(calls[1].prompt.includes('A small CLI.'));
  assert.ok(calls[1].prompt.includes('Trace main() after analysis 1.'));
  const overview = saved.architectures[0];

  await store.enqueue(project.id, 'flow', 'Follow main returning the greeting.');
  await waitFor(
    // Wait for the independently requested flow and its next questions.
    () => !store.running,
  );
  saved = JSON.parse(await readFile(file, 'utf8'));
  assert.ok(calls[2].prompt.includes('CLI design'));
  assert.ok(calls[2].prompt.includes('Follow main returning the greeting.'));
  assert.ok(calls[2].prompt.includes('do not repeat the current request'));
  assert.equal(saved.nextPrompts.flows, 'Trace main() after analysis 3.');
  assert.deepEqual(saved.architectures[0], overview);
  assert.equal(Object.hasOwn(saved.flows[0], 'nextPrompts'), false);

  await store.enqueue(project.id, 'nouns', 'Greeting concepts');
  await waitFor(
    // Verify the next generation receives the saved flow's original request too.
    () => !store.running,
  );
  assert.ok(calls[3].prompt.includes('Follow main returning the greeting.'));
  const beforeFailure = await readFile(file, 'utf8');
  store.run =
    // Reject an invalid suggestion without changing previously saved results or prompts.
    async () => ({ ...outputs.architecture(), nextPrompts: {
      architecture: ' ', nouns: 'Greeting concepts', flows: 'Trace main()',
    } });
  await store.enqueue(project.id, 'architecture', 'Explain the CLI dependencies');
  await waitFor(
    // Wait until schema validation has rejected the blank next prompt.
    () => !store.running,
  );
  assert.equal((await store.get(project.id)).job.status, 'failed');
  assert.equal(await readFile(file, 'utf8'), beforeFailure);
  await store.close();
  const reopened = new ProjectStore({ dataDirectory: setup.dataDirectory });
  // Close the reopened store after checking persisted suggestions.
  context.after(() => reopened.close());
  assert.deepEqual((await reopened.view(project.id)).nextPrompts, JSON.parse(beforeFailure).nextPrompts);
});

// Reading an older project must not backfill or modify its saved understanding.
test('projects without next prompts remain unchanged when opened or restarted', async (context) => {
  const setup = await createProjectFixture(context);
  const store = new ProjectStore({ ...setup });
  // Finish registry writes before the test fixture is removed.
  context.after(() => store.close());
  const project = await store.add({ path: setup.root, analyze: false });
  const file = store.path(project.id, 'understanding.json');
  const original = await readFile(file, 'utf8');
  assert.equal(Object.hasOwn(JSON.parse(original), 'nextPrompts'), false);
  assert.deepEqual((await store.view(project.id)).nextPrompts, {});
  assert.equal(await readFile(file, 'utf8'), original);
  await store.close();
  const reopened = new ProjectStore({ dataDirectory: setup.dataDirectory });
  // Ensure startup also keeps the legacy project free of added prompt fields.
  context.after(() => reopened.close());
  assert.deepEqual((await reopened.view(project.id)).nextPrompts, {});
  assert.equal(await readFile(file, 'utf8'), original);
});

// Require useful, bounded suggestions for all four analysis kinds in model output.
test('next prompt schemas reject missing, blank, oversized, and unexpected values', () => {
  for (const stage of ['directories', 'architecture', 'nouns', 'flow']) {
    const value = outputs[stage]();
    validateSchema(value, schemas[stage]);
    for (const nextPrompts of [
      {},
      { ...value.nextPrompts, architecture: '' },
      { ...value.nextPrompts, nouns: '\n  ' },
      { ...value.nextPrompts, flows: 'x'.repeat(601) },
      { ...value.nextPrompts, directories: 'Explain the root' },
    ])
      // Reject incomplete or unusable suggestions before persisting an analysis.
      assert.throws(() => validateSchema({ ...value, nextPrompts }, schemas[stage]), /nextPrompts/);
  }
});

// Keep every result's source comparison independent across edits, scans, and reruns.
test('analysis freshness preserves each result baseline and lists all changed files', async (context) => {
  const setup = await createProjectFixture(context);
  await writeFile(join(setup.root, 'AGENTS.md'), 'Local instructions.\n');
  const store = new ProjectStore({ ...setup, run: runFakeAnalysis });
  // Finish all pending writes before the temporary fixture is removed.
  context.after(() => store.close());
  const project = await store.add({ path: setup.root });
  // Wait for the worker to release its slot before queuing the next analysis.
  const waitForIdle = () => waitFor(
    // Observe the worker slot after all job metadata has been saved.
    () => !store.running,
  );
  await waitForIdle();
  await store.enqueue(project.id, 'flow', 'Run the CLI');
  await waitForIdle();
  await store.enqueue(project.id, 'architecture', 'Show the CLI');
  await waitForIdle();
  await store.enqueue(project.id, 'nouns');
  await waitForIdle();
  let view = await store.view(project.id);
  assert.equal(view.directoryReview.current, true);
  assert.equal(view.architectures[0].review.current, true);
  assert.equal(view.architectures[1].review.current, true);
  assert.equal(view.flows[0].review.current, true);
  assert.equal(view.nounAnalyses[0].review.current, true);
  assert.deepEqual(view.nounAnalyses[0].review.newFiles, []);
  const oldDate = view.nounAnalyses[0].review.reviewedAt;
  const oldSourceVersion = view.sourceVersion;
  const file = store.path(project.id, 'understanding.json');
  await writeFile(join(setup.root, 'src/main.ts'), 'export function main() { return "new"; }\n');
  await rm(join(setup.root, 'README.md'));
  // Use more than eight additions to verify the full filename list is preserved.
  for (let number = 0; number < 10; number++)
    await writeFile(join(setup.root, `src/new-${number}.ts`), 'export const added = true;\n');
  view = await store.view(project.id);
  assert.notEqual(view.sourceVersion, oldSourceVersion);
  assert.deepEqual(view.nounAnalyses[0].review.changedFiles, ['README.md', 'src/main.ts']);
  assert.equal(view.nounAnalyses[0].review.fileChanges['README.md'], 'removed');
  assert.equal(view.nounAnalyses[0].review.fileChanges['src/main.ts'], 'modified');
  assert.equal(view.nounAnalyses[0].review.fileChanges['src/new-0.ts'], 'added');
  assert.equal(view.nounAnalyses[0].review.newFiles.length, 10);
  await store.enqueue(project.id, 'nouns');
  await waitForIdle();
  view = await store.view(project.id);
  assert.equal(view.nounAnalyses[0].review.current, false);
  assert.equal(view.nounAnalyses[0].review.reviewedAt, oldDate);
  assert.equal(view.nounAnalyses[0].review.newFiles.length, 10);
  assert.deepEqual(view.nounAnalyses[1].review.changedFiles, []);
  assert.deepEqual(view.nounAnalyses[1].review.newFiles, []);
  assert.equal(view.nounAnalyses[1].review.current, true);
  assert.equal(view.directoryReview.current, false);
  assert.equal(view.architectures[0].review.current, false);
  assert.equal(view.architectures[1].review.current, false);
  assert.equal(view.flows[0].review.current, false);

  await store.enqueue(project.id, 'initial');
  await waitForIdle();
  view = await store.view(project.id);
  assert.equal(view.directoryReview.current, true);
  assert.equal(view.architectures[0].review.current, true);
  assert.equal(view.architectures[1].review.current, false);
  assert.equal(view.flows[0].review.current, false);
  assert.equal(view.nounAnalyses[0].review.current, false);
  assert.equal(view.nounAnalyses[1].review.current, true);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.ok(saved.nounAnalyses[1].baseline.files['AGENTS.md']);
  assert.equal(saved.nounAnalyses[0].baseline.files['src/new-0.ts'], undefined);
  assert.equal(saved.reviews, undefined);
  assert.equal(saved.analyzedPaths, undefined);
  assert.equal(saved.directories, undefined);
  await assert.rejects(readFile(store.path(project.id, 'index.json')), { code: 'ENOENT' });
  // Missing baselines must not claim freshness.
  delete saved.nounAnalyses[1].baseline;
  await writeJson(file, saved);
  view = await store.view(project.id);
  assert.equal(view.directoryReview.current, true);
  assert.equal(view.nounAnalyses[1].review.available, false);
  assert.equal(view.nounAnalyses[1].review.current, false);
  await store.close();
  const reopened = new ProjectStore({ dataDirectory: setup.dataDirectory });
  // Close the restored store after checking persisted comparison baselines.
  context.after(() => reopened.close());
  assert.deepEqual((await reopened.view(project.id)).nounAnalyses[0].review,
    view.nounAnalyses[0].review);
});

// Distinguish file read failures from content modifications and removals in the UI.
test('freshness reports an unreadable file separately from a modified file', async (context) => {
  const setup = await createProjectFixture(context);
  const index = await indexProject(setup.root, 'Demo');
  const analysis = {
    ...outputs.nouns(),
    id: 'nouns',
    baseline: { files: { ...index.files }, analyzedAt: index.indexedAt },
  };
  // Simulate a failed read from the scanner without depending on filesystem permissions.
  index.files['README.md'] = null;
  const view = await projectView({ root: setup.root, name: 'Demo' }, index,
    { nounAnalyses: [analysis] }, null);
  assert.deepEqual(view.nounAnalyses[0].review.changedFiles, ['README.md']);
  assert.deepEqual(view.nounAnalyses[0].review.fileChanges, { 'README.md': 'unreadable' });
  assert.equal(view.nounAnalyses[0].review.current, false);
});

// Verify baselines cover files beyond citations, preview limits, and snapshot limits.
test('full baselines detect uncited, binary, oversized, and snapshot-omitted file changes', async (context) => {
  const setup = await createProjectFixture(context);
  await mkdir(join(setup.root, 'extra'));
  for (let number = 0; number < 605; number++)
    await writeFile(join(setup.root, `extra/file-${number}.ts`), 'export const value = 1;\n');
  await writeFile(join(setup.root, 'AGENTS.md'), 'Original instructions.\n');
  await writeFile(join(setup.root, 'image.bin'), Buffer.from([0, 1, 2]));
  await writeFile(join(setup.root, 'large.txt'), 'x'.repeat(1024 * 1024 + 1));
  await writeFile(join(setup.root, '.codescopeignore'), 'ignored.txt\n');
  await writeFile(join(setup.root, 'ignored.txt'), 'ignored original');
  const store = new ProjectStore({ ...setup, run: runFakeAnalysis });
  // Drain analysis before removing the large fixture.
  context.after(() => store.close());
  const project = await store.add({ path: setup.root });
  await waitFor(
    // Wait for both analysis results and debug indexes to finish saving.
    () => !store.running,
  );
  const path = store.path(project.id, 'understanding.json');
  const savedText = await readFile(path, 'utf8');
  const saved = JSON.parse(savedText);
  assert.equal(Object.keys(saved.directoryAnalysis.baseline.files).length, 610);
  assert.equal(saved.directoryAnalysis.baseline.files['image.bin'], fingerprint(Buffer.from([0, 1, 2])));
  assert.equal(saved.directoryAnalysis.baseline.files['ignored.txt'], undefined);
  assert.deepEqual(saved.directoryAnalysis.baseline.files, saved.architectures[0].baseline.files);
  assert.equal(saved.directoryAnalysis.coverage.included, 600);
  const history = store.path(project.id, `last_jobs/${(await store.get(project.id)).job.id}`);
  const omitted = 'extra/file-99.ts';
  await assert.rejects(readFile(join(history, 'source', omitted)), { code: 'ENOENT' });
  await writeFile(join(setup.root, omitted), 'export const value = 2;\n');
  await writeFile(join(setup.root, 'AGENTS.md'), 'Changed instructions.\n');
  await writeFile(join(setup.root, 'image.bin'), Buffer.from([0, 1, 3]));
  await writeFile(join(setup.root, 'large.txt'), 'y'.repeat(1024 * 1024 + 1));
  await writeFile(join(setup.root, 'ignored.txt'), 'ignored change');
  const view = await store.view(project.id);
  assert.deepEqual(view.directoryReview.changedFiles,
    ['AGENTS.md', omitted, 'image.bin', 'large.txt']);
  assert.equal(await readFile(path, 'utf8'), savedText);
  await assert.rejects(readFile(store.path(project.id, 'index.json')), { code: 'ENOENT' });
});

// Preserve the actual analysis source when files change while the model is working.
test('analysis baselines and citations retain snapshot hashes when live files change during a job', async (context) => {
  const setup = await createProjectFixture(context);
  const original = await readFile(join(setup.root, 'src/main.ts'), 'utf8');
  const store = new ProjectStore({
    ...setup,
    // Change live source only after the read-only analysis snapshot was captured.
    run: async (options) => {
      await writeFile(join(setup.root, 'src/main.ts'), 'export function main() { return 42; }\n');
      return runFakeAnalysis(options);
    },
  });
  // Finish job metadata before fixture teardown.
  context.after(() => store.close());
  const project = await store.add({ path: setup.root });
  await waitFor(
    // Wait for both stages to use the captured source version.
    () => !store.running,
  );
  const saved = JSON.parse(await readFile(store.path(project.id, 'understanding.json'), 'utf8'));
  for (const analysis of [saved.directoryAnalysis, saved.architectures[0]])
    assert.equal(analysis.baseline.files['src/main.ts'], fingerprint(original));
  const view = await store.view(project.id);
  assert.deepEqual(view.directoryReview.changedFiles, ['src/main.ts']);
  assert.equal(view.architectures[0].nodes[0].sources[0].stale, true);
});

// Keep missing historical hashes explicit rather than treating today's files as history.
test('analyses with unavailable historical hashes show an incomplete comparison', async (context) => {
  const setup = await createProjectFixture(context);
  const index = await indexProject(setup.root, 'Demo');
  const project = { id: 'demo-project', name: 'Demo', root: setup.root };
  const projectDirectory = join(setup.dataDirectory, 'projects', project.id);
  await writeJson(join(setup.dataDirectory, 'projects.json'), [project]);
  await writeJson(join(projectDirectory, 'understanding.json'), {
    directoryAnalysis: {
      ...outputs.directories(),
      baseline: {
        files: { 'src/main.ts': index.files['src/main.ts'], 'README.md': null },
        analyzedAt: '2020-01-01T00:00:00.000Z',
      },
    },
  });
  const store = new ProjectStore({ dataDirectory: setup.dataDirectory });
  // Finish startup writes before removing the fixture.
  context.after(() => store.close());
  const view = await store.view(project.id);
  assert.equal(view.directoryReview.current, false);
  assert.deepEqual(view.directoryReview.unknownFiles, ['README.md']);
  assert.deepEqual(view.directoryReview.changedFiles, []);
  const saved = JSON.parse(await readFile(join(projectDirectory, 'understanding.json'), 'utf8'));
  assert.equal(saved.directoryAnalysis.baseline.files['README.md'], null);
});

// Reject ambiguous display names, including defaults and concurrent additions.
test('project names must be unique regardless of case or surrounding spaces', async (context) => {
  const setup = await createProjectFixture(context);
  const store = new ProjectStore({ ...setup, run: runFakeAnalysis });
  // Stop indexing before removing the temporary storage.
  context.after(() => store.close());
  await store.add({ path: setup.root, name: 'codescope', analyze: false });
  const keepfitRoot = join(setup.directory, 'keepfit');
  const defaultRoot = join(setup.directory, 'CodeScope');
  await mkdir(keepfitRoot);
  await mkdir(defaultRoot);

  for (const name of ['codescope', 'CodeScope', '  CODESCOPE  ']) {
    await assert.rejects(store.add({ path: keepfitRoot, name, analyze: false }), {
      status: 409,
      message: 'A project with this name is already in your project picker. Choose a different name.',
    });
  }

  // Blank and omitted names must validate the effective folder-name default.
  for (const name of [undefined, '', '  ']) {
    await assert.rejects(store.add({ path: defaultRoot, name, analyze: false }), { status: 409 });
  }
  assert.equal((await store.list()).length, 1);
  const keepfit = await store.add({ path: keepfitRoot, name: '  Keepfit  ', analyze: false });
  assert.equal(keepfit.name, 'Keepfit');
  assert.equal(keepfit.id, 'keepfit');

  const raceRoot = join(setup.directory, 'second');
  await mkdir(raceRoot);
  const results = await Promise.allSettled([
    store.add({ path: defaultRoot, name: 'Shared name', analyze: false }),
    store.add({ path: raceRoot, name: '  SHARED NAME  ', analyze: false }),
  ]);
  const successes = results.filter(
    // Exactly one registration may claim the shared name.
    (result) => result.status === 'fulfilled',
  );
  const failures = results.filter(
    // The other registration must report a conflict.
    (result) => result.status === 'rejected',
  );
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason.status, 409);
  assert.equal((await store.list()).length, 3);
  await waitFor(
    // Finish registry writes and indexing before fixture teardown removes files.
    () => !store.running,
  );
});

// Verify renaming preserves source identity, saved analyses, and registry persistence.
test('projects can be renamed without moving their root or saved data', async (context) => {
  const setup = await createProjectFixture(context);
  const store = new ProjectStore({ ...setup, run: runFakeAnalysis });
  // Close the worker after checking rename behavior.
  context.after(() => store.close());
  const project = await store.add({ path: setup.root, name: 'codescope' });
  await waitFor(
    // Complete analysis before comparing its saved data across a rename.
    () => !store.running,
  );
  await assert.rejects(readFile(store.path(project.id, 'index.json')), { code: 'ENOENT' });
  const savedAnalysis = await readFile(store.path(project.id, 'understanding.json'), 'utf8');
  const savedJob = structuredClone((await store.get(project.id)).job);
  const source = await readFile(join(setup.root, 'src/main.ts'), 'utf8');
  const renamed = await store.renameProject(project.id, '  My project  ');
  assert.equal(renamed.name, 'My project');
  assert.equal(renamed.id, project.id);
  assert.equal(renamed.root, project.root);
  assert.equal(renamed.createdAt, project.createdAt);
  assert.deepEqual(renamed.job, savedJob);
  await assert.rejects(readFile(store.path(project.id, 'index.json')), { code: 'ENOENT' });
  assert.equal(await readFile(store.path(project.id, 'understanding.json'), 'utf8'), savedAnalysis);
  assert.equal(await readFile(join(setup.root, 'src/main.ts'), 'utf8'), source);
  const view = await store.view(project.id);
  assert.equal(view.name, 'My project');
  assert.equal(view.appName, 'My project');

  // Keeping the same name or changing only its case excludes the project itself.
  assert.equal((await store.renameProject(project.id, 'My project')).name, 'My project');
  assert.equal((await store.renameProject(project.id, 'MY PROJECT')).name, 'MY PROJECT');
  for (const name of [undefined, null, 42, [], {}, '', '  ', 'a'.repeat(101)]) {
    await assert.rejects(store.renameProject(project.id, name), { status: 400 });
  }
  assert.equal((await store.get(project.id)).name, 'MY PROJECT');
  await assert.rejects(store.renameProject('missing', 'New name'), { status: 404 });

  const secondRoot = join(setup.directory, 'keepfit');
  await mkdir(secondRoot);
  const second = await store.add({ path: secondRoot, name: 'Keepfit', analyze: false });
  await assert.rejects(store.renameProject(project.id, '  KEEPFit  '), { status: 409 });
  assert.equal((await store.get(project.id)).name, 'MY PROJECT');

  const results = await Promise.allSettled([
    store.renameProject(project.id, 'Shared name'),
    store.renameProject(second.id, '  SHARED NAME  '),
  ]);
  assert.equal(results.filter(
    // Only one concurrent rename may reserve the shared name.
    (result) => result.status === 'fulfilled',
  ).length, 1);
  const failure = results.find(
    // The competing rename must fail without changing that project's name.
    (result) => result.status === 'rejected',
  );
  assert.equal(failure.reason.status, 409);
  await assert.rejects(store.add({ path: setup.directory, name: 'shared name' }), { status: 409 });
  await waitFor(
    // Finish the second project's index before reopening storage.
    () => !store.running,
  );
  const names = (await store.list()).map(
    // Compare the persisted names without depending on concurrent completion order.
    (entry) => entry.name,
  );
  await store.close();
  const reopened = new ProjectStore({ dataDirectory: setup.dataDirectory });
  // Close the reopened registry after verifying persistence.
  context.after(() => reopened.close());
  assert.deepEqual((await reopened.list()).map(
    // Read display names restored after restarting the store.
    (entry) => entry.name,
  ), names);
  assert.equal((await reopened.get(project.id)).root, project.root);
  await assert.rejects(store.renameProject(project.id, 'After close'), { status: 503 });
});

// Verify normalized directory IDs, collision suffixes, and concurrent registration.
test('project IDs use source directory names and avoid normalized and on-disk collisions', async (context) => {
  const setup = await createProjectFixture(context);
  const store = new ProjectStore({ ...setup, run: runFakeAnalysis });
  // Stop all indexing work before removing the temporary storage.
  context.after(() => store.close());
  const first = await store.add({ path: setup.root, name: 'A custom display name', analyze: false });
  assert.equal(first.id, 'demo-project');
  assert.equal(first.name, 'A custom display name');

  // Register a literal suffixed directory before adding a duplicate base name.
  const suffixedRoot = join(setup.directory, 'demo-project-01');
  await mkdir(suffixedRoot);
  assert.equal((await store.add({ path: suffixedRoot, analyze: false })).id, 'demo-project-01');
  const duplicateRoots = [
    join(setup.directory, 'second', 'Demo Project'),
    join(setup.directory, 'third', 'DEMO---PROJECT'),
  ];

  for (const root of duplicateRoots) await mkdir(root, { recursive: true });
  const duplicates = await Promise.all(duplicateRoots.map(
    // Race different paths that normalize to the same project ID.
    (path) => store.add({ path, analyze: false }),
  ));
  assert.deepEqual(duplicates.map(
    // Compare allocated IDs independently of registration completion order.
    (project) => project.id,
  ).sort(), ['demo-project-02', 'demo-project-03']);

  // Existing unregistered storage must never be reused or overwritten.
  const occupied = store.path('CAFE-APP', '.');
  await mkdir(occupied);
  await writeFile(join(occupied, 'keep.txt'), 'unregistered data');
  const accentedRoot = join(setup.directory, 'Café App!');
  await mkdir(accentedRoot);
  assert.equal((await store.add({ path: accentedRoot, analyze: false })).id, 'cafe-app-01');
  assert.equal(await readFile(join(occupied, 'keep.txt'), 'utf8'), 'unregistered data');
  const unicodeRoot = join(setup.directory, '東京');
  await mkdir(unicodeRoot);
  assert.equal((await store.add({ path: unicodeRoot, analyze: false })).id, 'project');

  await waitFor(
    // Finish queued index jobs before reopening the registry.
    () => !store.running,
  );
  await store.close();
  const registryPath = join(setup.dataDirectory, 'projects.json');
  const projects = JSON.parse(await readFile(registryPath, 'utf8'));
  const movedRoot = join(setup.directory, 'renamed directory');
  await rename(setup.root, movedRoot);
  projects[0].root = movedRoot;
  projects[0].name = 'Another display name';
  await writeJson(registryPath, projects);
  const reopened = new ProjectStore({ dataDirectory: setup.dataDirectory });
  // Close the reopened store after checking stable IDs.
  context.after(() => reopened.close());
  const persisted = await reopened.get(first.id);
  assert.equal(persisted.id, 'demo-project');
  assert.equal(persisted.root, movedRoot);
  await assert.rejects(readFile(reopened.path(first.id, 'index.json')), { code: 'ENOENT' });
  assert.equal((await reopened.view(first.id)).stats.files, 2);
});

// Verify focused diagrams preserve previous views and their own source versions.
test('architecture questions save separate diagrams, preserve old results, and retain their own source versions', async (context) => {
  const setup = await createProjectFixture(context);
  const questions = [
    'How does the CLI entrypoint work?',
    'What owns the greeting data? Focus on [src/main.ts:1].',
  ];
  const calls = [];
  let focused = 0;

  // Simulate focused diagrams while recording requested stages.
  const run = async (options) => {
    calls.push(options.schemaPath.split('/').at(-1));
    if (options.prompt.includes('user-requested architecture question')) {
      assert.ok(
        questions.some(
          // Confirm the prompt includes one of the requested architecture questions.
          (question) => options.prompt.includes(JSON.stringify(question)),
        ),
      );
      return { ...outputs.architecture(), title: `Focused view ${++focused}` };
    }

    return runFakeAnalysis(options);
  };

  const store = new ProjectStore({ ...setup, run });
  // Close the project store after the diagram test.
  context.after(() => store.close());
  const project = await store.add({ path: setup.root });

  // Wait for the current project job to complete.
  const waitForCompletion = () =>
    waitFor(
      // Check the saved job's completed status.
      async () => (await store.get(project.id)).job.status === 'completed',
    );

  await waitForCompletion();
  const initial = JSON.parse(await readFile(store.path(project.id, 'understanding.json'), 'utf8'));
  assert.equal(Object.hasOwn(initial, 'architecture'), false);
  assert.equal(initial.architectures[0].id, 'overview');
  await store.enqueue(project.id, 'flow', 'Run main');
  await waitForCompletion();

  for (const question of [undefined, '', '   ', {}, 'a'.repeat(4001)])
    await assert.rejects(store.enqueue(project.id, 'architecture', question), { status: 400 });

  calls.length = 0;

  for (const question of questions) {
    await store.enqueue(project.id, 'architecture', `  ${question}  `);
    await waitForCompletion();
  }

  assert.deepEqual(calls, ['architecture.schema.json', 'architecture.schema.json']);
  let view = await store.view(project.id);
  assert.equal(view.architectures[0].title, 'CLI design');
  assert.deepEqual(
    view.architectures.map(
      // Read diagram titles for the view-order assertion.
      (graph) => graph.title,
    ),
    ['CLI design', 'Focused view 1', 'Focused view 2'],
  );
  assert.deepEqual(
    view.architectures.slice(1).map(
      // Read the focused diagrams' original questions.
      (graph) => graph.requestedQuestion,
    ),
    questions,
  );
  assert.equal(
    new Set(
      view.architectures.map(
        // Read diagram identifiers for the uniqueness assertion.
        (graph) => graph.id,
      ),
    ).size,
    3,
  );
  assert.equal(view.job.resultId, view.architectures[2].id);
  assert.equal(view.stats.architectures, 3);
  assert.equal(view.flows.length, 1);
  assert.equal(view.tree.title, 'Demo CLI');
  store.run =
    // Simulate a provider failure while generating a focused diagram.
    async () => {
      throw new Error('Temporary diagram failure');
    };
  await store.enqueue(project.id, 'architecture', questions[0]);
  await waitFor(
    // Wait for the failed diagram job to settle.
    async () => (await store.get(project.id)).job.status === 'failed',
  );
  assert.equal((await store.view(project.id)).architectures.length, 3);
  assert.equal((await store.get(project.id)).job.feature, questions[0]);
  store.run = run;
  await writeFile(
    join(setup.root, 'src/main.ts'),
    'export function main() { return "changed"; }\n',
  );
  assert.equal((await store.view(project.id)).architectures[1].nodes[0].sources[0].stale, true);
  await store.enqueue(project.id, 'initial');
  await waitForCompletion();
  view = await store.view(project.id);
  assert.equal(view.architectures.length, 3);
  assert.equal(view.architectures[0].nodes[0].sources[0].stale, false);
  assert.equal(view.architectures[1].nodes[0].sources[0].stale, true);
  assert.equal(view.flows[0].phases[0].steps[0].source.stale, true);
  await store.close();
  const reopened = new ProjectStore({ dataDirectory: setup.dataDirectory, run });
  // Close the reopened diagram store after the test.
  context.after(() => reopened.close());
  assert.deepEqual(
    (await reopened.view(project.id)).architectures.map(
      // Read persisted diagram identifiers from the reopened store.
      (graph) => graph.id,
    ),
    view.architectures.map(
      // Read expected diagram identifiers from the earlier view.
      (graph) => graph.id,
    ),
  );
});

// Verify node deletion persists only in the selected diagram.
test('node deletion persists for one diagram, removes all incident edges, and supports an empty diagram', async (context) => {
  const setup = await createProjectFixture(context);

  // Return a connected graph for architecture stages and ordinary fixtures otherwise.
  const run = (options) =>
    options.schemaPath.endsWith('architecture.schema.json')
      ? Promise.resolve(createConnectedArchitecture())
      : runFakeAnalysis(options);

  const store = new ProjectStore({ ...setup, run });
  // Close the project store after the deletion test.
  context.after(() => store.close());
  const project = await store.add({ path: setup.root });

  // Wait for analysis before inspecting the edited graph.
  const waitForCompletion = () =>
    waitFor(
      // Check the project's current job completion status.
      async () => (await store.get(project.id)).job.status === 'completed',
    );

  await waitForCompletion();
  await store.enqueue(project.id, 'architecture', 'Component details');
  await waitForCompletion();
  await store.enqueue(project.id, 'flow', 'Run main');
  await waitForCompletion();
  const file = store.path(project.id, 'understanding.json');
  const before = JSON.parse(await readFile(file, 'utf8'));
  const diagramId = before.architectures[1].id;
  assert.deepEqual(await store.deleteArchitectureNode(project.id, diagramId, 'cache'), {
    deletedNodeId: 'cache',
    deletedConnections: 4,
  });
  let saved = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(
    saved.architectures[1].nodes.map(
      // Read the remaining focused diagram node identifiers.
      (node) => node.id,
    ),
    ['cli', 'storage'],
  );
  assert.deepEqual(
    saved.architectures[1].edges.map(
      // Read the remaining connection endpoints.
      (edge) => [edge.from, edge.to],
    ),
    [['storage', 'cli']],
  );

  for (const key of ['directoryAnalysis', 'flows'])
    assert.deepEqual(saved[key], before[key]);

  assert.deepEqual(saved.architectures[0], before.architectures[0]);

  const afterDeletion = await readFile(file, 'utf8');
  await assert.rejects(store.deleteArchitectureNode(project.id, 'missing', 'cli'), { status: 404 });
  await assert.rejects(store.deleteArchitectureNode(project.id, diagramId, 'missing'), {
    status: 404,
  });
  await assert.rejects(store.deleteArchitectureNode('missing', diagramId, 'cli'), { status: 404 });
  assert.equal(await readFile(file, 'utf8'), afterDeletion);
  assert.equal(
    (await store.deleteArchitectureNode(project.id, 'overview', 'cache')).deletedConnections,
    4,
  );
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).architectures[1], saved.architectures[1]);
  await store.deleteArchitectureNode(project.id, diagramId, 'cli');
  await store.deleteArchitectureNode(project.id, diagramId, 'storage');
  saved = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(saved.architectures[1].nodes, []);
  assert.deepEqual(saved.architectures[1].edges, []);
  assert.equal((await store.view(project.id)).architectures.length, 2);
  assert.deepEqual((await store.view(project.id)).architectures[1].nodes, []);
  assert.equal(
    await readFile(join(setup.root, 'src/main.ts'), 'utf8'),
    'export function main() { return "hello"; }\n',
  );
  await store.close();
  const reopened = new ProjectStore({ dataDirectory: setup.dataDirectory, run });
  // Close the reopened store after checking the saved edit.
  context.after(() => reopened.close());
  const view = await reopened.view(project.id);
  assert.deepEqual(
    view.architectures[0].nodes.map(
      // Read persisted node identifiers after reopening the store.
      (node) => node.id,
    ),
    ['cli', 'storage'],
  );
  assert.deepEqual(view.architectures[1].nodes, []);
  assert.equal(view.flows.length, 1);
});

// Verify sequence results retain their own evidence through failure, retry, and restart.
test('sequences run on demand and preserve diagrams and baselines across job lifecycles', async (context) => {
  const setup = await createProjectFixture(context);
  const store = new ProjectStore({ ...setup, run: runFakeAnalysis });
  // Drain workers before removing the temporary storage.
  context.after(() => store.close());
  const project = await store.add({ path: setup.root, analyze: false });
  assert.deepEqual((await store.view(project.id)).sequences, []);

  for (const question of [undefined, null, '', ' ', 12, 'x'.repeat(4001)])
    await assert.rejects(store.enqueue(project.id, 'sequence', question), { status: 400 });
  const job = await store.enqueue(project.id, 'sequence', '  Diagram main()  ');
  await waitFor(
    // Finish the first independent sequence job before inspecting its result.
    () => !store.running,
  );
  const first = await store.view(project.id);
  assert.equal(first.job.status, 'completed');
  assert.equal(first.sequences.length, 1);
  assert.equal(first.stats.sequences, 1);
  assert.equal(first.sequences[0].requestedQuestion, 'Diagram main()');
  assert.equal(first.sequences[0].id, first.job.resultId);
  assert.equal(first.sequences[0].messages[0].sources[0].stale, false);
  assert.deepEqual(first.architectures, []);
  assert.deepEqual(first.flows, []);
  const history = store.path(project.id, `last_jobs/${job.id}`);
  for (const file of ['sequence.schema.json', 'sequence.prompt.txt', 'sequence.result.json'])
    await readFile(join(history, file));

  // Fail a later diagram without changing the successful result or suggestions.
  store.run = async () => { throw new Error('Sequence failure'); };
  await store.enqueue(project.id, 'sequence', 'Another interaction');
  await waitFor(
    // Allow the failed job to release the shared worker.
    () => !store.running,
  );
  const failed = await store.view(project.id);
  assert.equal(failed.job.status, 'failed');
  assert.deepEqual(failed.sequences, first.sequences);
  assert.deepEqual(failed.nextPrompts, first.nextPrompts);
  store.run = runFakeAnalysis;
  await store.enqueue(project.id, failed.job.kind, failed.job.feature);
  await waitFor(
    // Complete a retry using the original job's requested interaction.
    () => !store.running,
  );
  assert.equal((await store.view(project.id)).sequences.length, 2);

  // Keep the stage alive until cancellation exercises the shared abort signal.
  store.run = ({ signal }) => new Promise(
    // Reject only after the worker receives the cancellation request.
    (_, reject) => signal.addEventListener('abort',
      // Translate the aborted stage into the normal cancelled job path.
      () => reject(new Error('Cancelled')), { once: true }),
  );
  await store.enqueue(project.id, 'sequence', 'Cancel this interaction');
  await waitFor(
    // Wait until the stage is running before aborting it.
    async () => (await store.get(project.id)).job.stage === 'sequence',
  );
  await assert.rejects(store.enqueue(project.id, 'sequence', 'Duplicate'), { status: 409 });
  await store.cancel(project.id);
  await waitFor(
    // Let cancellation settle before starting a new job.
    () => !store.running,
  );
  assert.equal((await store.get(project.id)).job.status, 'cancelled');
  await writeFile(join(setup.root, 'src/main.ts'), 'export function main() { return "new"; }\n');
  store.run = runFakeAnalysis;
  await store.enqueue(project.id, 'initial');
  await waitFor(
    // Initial reanalysis must preserve both historical sequence diagrams.
    () => !store.running,
  );
  const changed = await store.view(project.id);
  assert.equal(changed.sequences.length, 2);
  assert.equal(changed.sequences[0].messages[0].sources[0].stale, true);
  assert.deepEqual(changed.sequences[0].review.changedFiles, ['src/main.ts']);
  await store.close();
  const reopened = new ProjectStore({ dataDirectory: setup.dataDirectory });
  // Close the reopened store after checking retained diagrams and comparisons.
  context.after(() => reopened.close());
  assert.deepEqual((await reopened.view(project.id)).sequences, changed.sequences);
});

// Reject invalid sequence graphs and citations before they reach saved understanding.
test('sequence validation enforces participants, messages, evidence, and safe output shapes', async (context) => {
  const setup = await createProjectFixture(context);
  const index = await indexProject(setup.root, 'Demo');
  const snapshot = await createSnapshot({ root: setup.root }, index, join(setup.directory, 'snapshot'));
  const valid = validateAnalysis('sequence', outputs.sequence(), index, snapshot);
  assert.ok(valid.messages[0].sources[0].hash);
  const duplicate = outputs.sequence();
  duplicate.participants.push(duplicate.participants[0]);
  const unknown = outputs.sequence();
  unknown.messages[0].to = 'missing';
  const missingSources = outputs.sequence();
  missingSources.messages[0].sources = [];
  const invalidCitation = outputs.sequence();
  invalidCitation.messages[0].sources[0].line = 999;
  const invalidKind = outputs.sequence();
  invalidKind.messages[0].kind = 'javascript';
  const noMessages = { ...outputs.sequence(), messages: [] };

  for (const [value, message] of [
    [duplicate, /unique/], [unknown, /unknown participant/],
    [missingSources, /source evidence/], [invalidCitation, /citation/],
    [invalidKind, /unsupported value/], [noMessages, /both/],
  ])
    // Require validation errors for each independently malformed result.
    assert.throws(() => validateAnalysis('sequence', value, index, snapshot), message);
  assert.deepEqual(validateAnalysis('sequence', {
    ...outputs.sequence(), participants: [], messages: [],
  }, index, snapshot).messages, []);
  const prompt = analysisPrompt('sequence', { name: 'Demo' }, index, snapshot, 'Run main', {
    sequences: [{ title: 'Previous sequence', requestedQuestion: 'An earlier interaction' }],
  });
  assert.match(prompt, /Run main/);
  assert.match(prompt, /An earlier interaction/);
  assert.match(prompt, /temporal order/);
});

// Verify independent nouns runs preserve scopes, evidence, and earlier results.
test('nouns analyses run on demand, retain separate scopes, and survive scans and restart', async (context) => {
  const setup = await createProjectFixture(context);
  const calls = [];

  // Capture only stage invocations while returning deterministic source-backed results.
  const run = (options) => {
    calls.push(options);
    return runFakeAnalysis(options);
  };

  const store = new ProjectStore({ ...setup, run });
  // Drain workers before deleting the temporary storage.
  context.after(() => store.close());
  const project = await store.add({ path: setup.root, analyze: false });

  // Wait until the job has saved all of its debugging metadata.
  const waitForIdle = () => waitFor(
    // Observe the worker slot rather than just the public job status.
    () => !store.running,
  );

  await waitForIdle();
  assert.deepEqual((await store.view(project.id)).nounAnalyses, []);
  for (const scope of [null, 42, {}, 'a'.repeat(4001)])
    await assert.rejects(store.enqueue(project.id, 'nouns', scope), { status: 400 });

  const wholeProject = await store.enqueue(project.id, 'nouns');
  await waitForIdle();
  const scope = 'Concepts in src/ [src/main.ts:1]';
  const focused = await store.enqueue(project.id, 'nouns', `  ${scope}  `);
  await waitForIdle();
  assert.equal(calls.length, 2);
  for (const call of calls) assert.ok(call.schemaPath.endsWith('nouns.schema.json'));
  assert.ok(calls[0].prompt.includes('the whole project'));
  assert.ok(calls[1].prompt.includes(JSON.stringify(scope)));
  let view = await store.view(project.id);
  assert.deepEqual(view.architectures, []);
  assert.deepEqual(view.flows, []);
  assert.equal(view.nounAnalyses.length, 2);
  assert.equal(view.nounAnalyses[0].requestedScope, null);
  assert.equal(view.nounAnalyses[1].requestedScope, scope);
  assert.notEqual(view.nounAnalyses[0].id, view.nounAnalyses[1].id);
  assert.equal(view.job.resultId, view.nounAnalyses[1].id);
  assert.equal(view.stats.nounAnalyses, 2);
  assert.equal(view.nounAnalyses[0].nouns[0].sources[0].stale, false);
  for (const job of [wholeProject, focused]) {
    const directory = store.path(project.id, `last_jobs/${job.id}`);
    await readFile(join(directory, 'nouns.schema.json'));
    await readFile(join(directory, 'nouns.prompt.txt'));
    await readFile(join(directory, 'nouns.result.json'));
  }

  await writeFile(join(setup.root, 'src/main.ts'), 'export function main() { return "changed"; }\n');
  await store.enqueue(project.id, 'initial');
  await waitForIdle();
  view = await store.view(project.id);
  assert.equal(view.nounAnalyses.length, 2);
  assert.equal(view.nounAnalyses[0].nouns[0].sources[0].stale, true);
  assert.equal(view.nounAnalyses[1].relationships[0].sources[0].stale, true);
  assert.equal(view.architectures[0].nodes[0].sources[0].stale, false);
  assert.equal(calls.length, 4);
  await store.close();
  const reopened = new ProjectStore({ dataDirectory: setup.dataDirectory, run });
  // Close the reopened store after checking durable noun IDs and evidence.
  context.after(() => reopened.close());
  const restored = await reopened.view(project.id);
  assert.deepEqual(restored.nounAnalyses, view.nounAnalyses);
});

// Verify a scoped request can reach its files even beyond the general snapshot cap.
test('nouns snapshot focus prioritizes named paths while retaining instruction exclusions', async (context) => {
  const setup = await createProjectFixture(context);
  for (let index = 0; index < 600; index++)
    await writeFile(join(setup.root, `context-${String(index).padStart(3, '0')}.ts`), 'export const value = 1;\n');
  await mkdir(join(setup.root, 'z-domain'));
  await writeFile(join(setup.root, 'z-domain/model.ts'), 'export class Model {}\n');
  await writeFile(join(setup.root, 'z-domain/AGENTS.md'), 'Do not include instructions.\n');
  const index = await indexProject(setup.root, 'Demo');
  const project = { root: setup.root };
  const baseline = await createSnapshot(project, index, join(setup.directory, 'baseline'));
  assert.equal(baseline.sources['z-domain/model.ts'], undefined);
  const focused = await createSnapshot(project, index, join(setup.directory, 'focused'), undefined, 'Nouns in z-domain');
  assert.equal(focused.sources['z-domain/model.ts'], 'export class Model {}\n');
  assert.equal(focused.sources['z-domain/AGENTS.md'], undefined);
  assert.equal(focused.coverage.included, 600);
  assert.equal(focused.coverage.limited, true);
});

// Verify failed and cancelled noun requests do not discard earlier results.
test('nouns jobs retain scope for retry and preserve results through failure and cancellation', async (context) => {
  const setup = await createProjectFixture(context);
  const store = new ProjectStore({ ...setup, run: runFakeAnalysis });
  // Abort any unfinished test worker before fixture cleanup.
  context.after(() => store.close());
  const project = await store.add({ path: setup.root, analyze: false });
  await waitFor(
    // Wait for the index before scheduling an independent analysis.
    () => !store.running,
  );
  await store.enqueue(project.id, 'nouns', 'src/');
  await waitFor(
    // Wait for the first saved analysis before simulating a provider failure.
    () => !store.running,
  );
  const original = (await store.view(project.id)).nounAnalyses;
  store.run =
    // Fail the new run before it can change saved understanding.
    async () => { throw new Error('Nouns provider unavailable'); };
  await store.enqueue(project.id, 'nouns', 'job handling');
  await waitFor(
    // Wait until failure and debug metadata have both been saved.
    () => !store.running,
  );
  const failed = (await store.get(project.id)).job;
  assert.equal(failed.status, 'failed');
  assert.equal(failed.feature, 'job handling');
  assert.deepEqual((await store.view(project.id)).nounAnalyses, original);
  store.run = runFakeAnalysis;
  await store.enqueue(project.id, failed.kind, failed.feature);
  await waitFor(
    // Wait for the retry to append a new result.
    () => !store.running,
  );
  assert.equal((await store.view(project.id)).nounAnalyses.length, 2);
  let entered = false;
  store.run =
    // Hold a nouns stage open until the shared cancellation flow aborts it.
    (options) => new Promise(
      // Report stage entry and reject when the worker is cancelled.
      (resolve, reject) => {
        entered = true;
        // Settle the pending runner when cancellation arrives.
        options.signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true });
      },
    );
  await store.enqueue(project.id, 'nouns', 'another scope');
  await waitFor(
    // Ensure the stage has installed its cancellation listener.
    () => entered,
  );
  await assert.rejects(store.enqueue(project.id, 'nouns'), { status: 409 });
  await store.cancel(project.id);
  await waitFor(
    // Allow cancelled-job metadata to finish saving.
    () => !store.running,
  );
  assert.equal((await store.get(project.id)).job.status, 'cancelled');
  assert.equal((await store.view(project.id)).nounAnalyses.length, 2);
});

// Verify noun identities, relationships, and citations against the shared snapshot.
test('nouns validation rejects unsupported concepts and invalid source evidence', async (context) => {
  const setup = await createProjectFixture(context);
  const index = await indexProject(setup.root, 'Demo');
  const directory = join(setup.directory, 'snapshot');
  const snapshot = await createSnapshot({ root: setup.root }, index, directory);
  const valid = validateAnalysis('nouns', outputs.nouns(), index, snapshot);
  assert.ok(valid.nouns[0].sources[0].hash);
  const cases = [
    [{ ...outputs.nouns(), nouns: [outputs.nouns().nouns[0], outputs.nouns().nouns[0]] }, /unique/],
    [{ ...outputs.nouns(), nouns: [outputs.nouns().nouns[0]] }, /unknown noun/],
  ];
  const missingEvidence = outputs.nouns();
  missingEvidence.nouns[0].sources = [];
  cases.push([missingEvidence, /array length/]);
  const invalidCitation = outputs.nouns();
  invalidCitation.relationships[0].sources[0].path = 'outside.ts';
  cases.push([invalidCitation, /citation does not exist/]);
  for (const [value, message] of cases) {
    // Refuse malformed generated content before any result is persisted.
    assert.throws(() => validateAnalysis('nouns', value, index, snapshot), message);
  }
  const empty = { ...outputs.nouns(), nouns: [], relationships: [], notes: ['No matching implementation.'] };
  assert.deepEqual(validateAnalysis('nouns', empty, index, snapshot).nouns, []);
  const prompt = analysisPrompt('nouns', { name: 'Demo' }, index, snapshot, 'a missing subsystem');
  assert.ok(prompt.includes('a missing subsystem'));
  assert.ok(prompt.includes('Do not invent entities or relationships'));
});

// Verify project deletion removes saved data while preserving source and other projects.
test('project deletion persists, preserves source, and permits adding the directory again', async (context) => {
  const setup = await createProjectFixture(context);
  const store = new ProjectStore({ ...setup, run: runFakeAnalysis });
  // Finish all store work before removing the fixture.
  context.after(() => store.close());
  const project = await store.add({ path: setup.root });
  await waitFor(
    // Wait for every analysis file to be saved before deleting it.
    () => !store.running,
  );
  const otherRoot = join(setup.directory, 'other');
  await mkdir(otherRoot);
  await writeFile(join(otherRoot, 'README.md'), '# Other\n');
  const other = await store.add({ path: otherRoot, analyze: false });
  await waitFor(
    // Finish the other project's index before comparing its storage.
    () => !store.running,
  );
  const otherAnalysis = await readFile(store.path(other.id, 'understanding.json'), 'utf8');
  assert.deepEqual(await store.deleteProject(project.id), { deletedProjectId: project.id });
  await assert.rejects(store.get(project.id), { status: 404 });
  await assert.rejects(readdir(store.path(project.id, '.')), { code: 'ENOENT' });
  assert.equal(await readFile(store.path(other.id, 'understanding.json'), 'utf8'), otherAnalysis);
  assert.equal(await readFile(join(setup.root, 'src/main.ts'), 'utf8'),
    'export function main() { return "hello"; }\n');
  await assert.rejects(store.deleteProject(project.id), { status: 404 });
  const added = await store.add({ path: setup.root, analyze: false });
  assert.equal(added.id, project.id);
  await store.deleteProject(added.id);
  await store.deleteProject(other.id);
  await store.close();

  // An intentionally empty registry must stay empty after reopening.
  const reopened = new ProjectStore(setup);
  // Close the reopened store after checking durable deletion.
  context.after(() => reopened.close());
  assert.deepEqual(await reopened.list(), []);
  assert.deepEqual(JSON.parse(await readFile(join(setup.dataDirectory, 'projects.json'), 'utf8')), []);
});

// Verify cancellation drains writes and removes queued work before storage is deleted.
test('project deletion stops running and queued jobs and excludes concurrent mutations', async (context) => {
  const setup = await createProjectFixture(context);
  let entered = false;
  let aborted = false;
  let finishCancellation;
  const cancellation = new Promise(
    // Hold worker shutdown long enough to exercise concurrent requests.
    (resolve) => { finishCancellation = resolve; },
  );

  // Keep the first analysis active until deletion aborts and drains it.
  const run = async (options) => {
    if (entered) return runFakeAnalysis(options);
    entered = true;
    await new Promise(
      // Simulate a worker that requires asynchronous cancellation cleanup.
      (resolve) => {
        // Expose the abort before allowing delayed worker cleanup to finish.
        options.signal.addEventListener('abort', () => {
          aborted = true;
          resolve();
        }, { once: true });
      },
    );
    await cancellation;
    options.signal.throwIfAborted();
  };

  const store = new ProjectStore({ ...setup, run });
  // Release the worker even if an assertion fails before normal shutdown.
  context.after(async () => {
    finishCancellation();
    await store.close();
  });
  const project = await store.add({ path: setup.root });
  await waitFor(
    // Wait for the fake worker to accept cancellation.
    () => entered,
  );
  const queuedRoot = join(setup.directory, 'queued');
  await mkdir(queuedRoot);
  await writeFile(join(queuedRoot, 'README.md'), '# Queued\n');
  const queued = await store.add({ path: queuedRoot });
  assert.equal(queued.job.status, 'queued');
  await store.deleteProject(queued.id);
  assert.equal(store.queue.length, 0);

  const removal = store.deleteProject(project.id);
  await waitFor(
    // Confirm deletion has acquired its lock and signalled the worker.
    () => aborted,
  );
  await assert.rejects(store.enqueue(project.id), { status: 409 });
  await assert.rejects(store.deleteArchitectureNode(project.id, 'overview', 'cli'), { status: 409 });
  await assert.rejects(store.deleteProject(project.id), { status: 409 });
  await assert.rejects(store.cancel(project.id), { status: 409 });
  await assert.rejects(store.renameProject(project.id, 'During deletion'), { status: 409 });
  finishCancellation();
  await removal;
  assert.equal(store.running, null);
  await assert.rejects(readdir(store.path(project.id, '.')), { code: 'ENOENT' });
  await assert.rejects(readdir(store.path(queued.id, '.')), { code: 'ENOENT' });
  assert.deepEqual(await store.list(), []);
  await readFile(join(queuedRoot, 'README.md'));
});

// Verify edit locks prevent conflicting edits and analysis jobs.
test('diagram edits exclude concurrent edits and analysis jobs to prevent lost JSON updates', async (context) => {
  const setup = await createProjectFixture(context);

  // Return connected architecture fixtures for the edit-lock test.
  const run = (options) =>
    options.schemaPath.endsWith('architecture.schema.json')
      ? Promise.resolve(createConnectedArchitecture())
      : runFakeAnalysis(options);

  const store = new ProjectStore({ ...setup, run });
  // Close the store after checking edit serialization.
  context.after(() => store.close());
  const project = await store.add({ path: setup.root });
  await waitFor(
    // Wait for the initial graph to finish before testing edit locks.
    async () => (await store.get(project.id)).job.status === 'completed',
  );
  const first = store.deleteArchitectureNode(project.id, 'overview', 'cache');
  const second = store.deleteArchitectureNode(project.id, 'overview', 'storage');
  const job = store.enqueue(project.id, 'initial');
  await assert.rejects(store.deleteProject(project.id), { status: 409 });
  await assert.rejects(second, { status: 409 });
  await assert.rejects(job, { status: 409 });
  await first;
  assert.deepEqual(
    (await store.view(project.id)).architectures[0].nodes.map(
      // Read remaining overview node identifiers after the concurrent edit.
      (node) => node.id,
    ),
    ['cli', 'storage'],
  );
  let entered = false;
  store.run =
    // Hold an analysis stage open until cancellation.
    (options) =>
      new Promise(
        // Mark the fake stage entered and wait for its abort signal.
        (resolve, reject) => {
          entered = true;
          // Reject the held analysis when its signal is aborted.
          options.signal.addEventListener('abort', () => reject(new Error('Stopped')), {
            once: true,
          });
        },
      );
  await store.enqueue(project.id, 'architecture', 'Pending question');
  await waitFor(
    // Wait until the fake analysis stage holds the worker.
    () => entered,
  );
  await assert.rejects(store.deleteArchitectureNode(project.id, 'overview', 'storage'), {
    status: 409,
  });
  await store.cancel(project.id);
  await waitFor(
    // Wait until the cancelled analysis is persisted.
    async () => (await store.get(project.id)).job.status === 'cancelled',
  );
  await store.deleteArchitectureNode(project.id, 'overview', 'storage');
  assert.deepEqual(
    (await store.view(project.id)).architectures[0].nodes.map(
      // Read remaining overview nodes after editing becomes available again.
      (node) => node.id,
    ),
    ['cli'],
  );
});

// Verify queue serialization, cancellation, and interrupted-job recovery.
test('queue permits one worker, supports active cancellation, and marks interrupted jobs on restart', async (context) => {
  const setup = await createProjectFixture(context);
  let entered = false;
  let concurrent = 0;
  let maximum = 0;
  let cancelledSnapshot;

  // Track concurrent stage execution while holding the first job until cancellation.
  const run = async (options) => {
    concurrent++;
    maximum = Math.max(maximum, concurrent);

    try {
      if (!entered) {
        cancelledSnapshot = options.root;
        entered = true;
        await new Promise(
          // Wait for the first simulated stage to be aborted.
          (_, reject) =>
            options.signal.addEventListener(
              'abort',
              // Reject the blocked stage when cancellation reaches its signal.
              () => reject(new Error('stopped')),
              {
                once: true,
              },
            ),
        );
      }

      return await runFakeAnalysis(options);
    } finally {
      concurrent--;
    }
  };

  const store = new ProjectStore({ ...setup, run });
  // Close the queued-job store after the test.
  context.after(() => store.close());
  const first = await store.add({ path: setup.root });
  await waitFor(
    // Wait until the first job enters its blocked stage.
    () => entered,
  );
  const otherRoot = join(setup.directory, 'second');
  await mkdir(join(otherRoot, 'src'), { recursive: true });
  await writeFile(join(otherRoot, 'src/main.ts'), 'export function main() {}\n');
  const second = await store.add({ path: otherRoot });
  assert.equal((await store.get(second.id)).job.status, 'queued');
  const activeJob = structuredClone((await store.get(first.id)).job);
  await store.renameProject(first.id, 'Renamed while running');
  assert.deepEqual((await store.get(first.id)).job, activeJob);
  const queuedJob = structuredClone((await store.get(second.id)).job);
  await store.renameProject(second.id, 'Renamed while queued');
  assert.deepEqual((await store.get(second.id)).job, queuedJob);
  await assert.rejects(store.enqueue(first.id), { status: 409 });
  await store.cancel(first.id);
  await waitFor(
    // Wait for the second queued project to complete.
    async () => (await store.get(second.id)).job.status === 'completed',
  );
  assert.equal((await store.get(first.id)).job.status, 'cancelled');
  assert.equal(
    await readFile(join(cancelledSnapshot, 'src/main.ts'), 'utf8'),
    'export function main() { return "hello"; }\n',
  );
  assert.equal(maximum, 1);
  await store.close();
  const registry = JSON.parse(await readFile(join(setup.dataDirectory, 'projects.json'), 'utf8'));
  registry[0].job.status = 'running';
  const leftover = store.path(first.id, `last_jobs/${registry[0].job.id}/source`);
  await mkdir(leftover, { recursive: true });
  await writeFile(join(leftover, 'leftover.txt'), 'interrupted snapshot');
  await writeJson(join(setup.dataDirectory, 'projects.json'), registry);
  const reopened = new ProjectStore({ dataDirectory: setup.dataDirectory });
  // Close the recovered store after checking interrupted jobs.
  context.after(() => reopened.close());
  assert.equal((await reopened.list())[0].job.status, 'interrupted');
  assert.equal(await readFile(join(leftover, 'leftover.txt'), 'utf8'), 'interrupted snapshot');
});

// Verify retention removes whole old jobs while preserving every newer working file.
test('last_jobs retains three started jobs per project and preserves saved results', async (context) => {
  const setup = await createProjectFixture(context);
  const store = new ProjectStore({ ...setup, run: runFakeAnalysis });
  // Finish outstanding work before the fixture directory is removed.
  context.after(() => store.close());
  const project = await store.add({ path: setup.root });
  await waitFor(
    // Wait for final debug metadata as well as the generated results.
    () => !store.running,
  );
  const initialJob = (await store.get(project.id)).job.id;
  const history = store.path(project.id, 'last_jobs');
  const initialDirectory = join(history, initialJob);
  assert.match(await readFile(join(history, 'README.md'), 'utf8'), /debugging purposes only/);
  assert.equal(
    await readFile(join(initialDirectory, 'source/src/main.ts'), 'utf8'),
    await readFile(join(setup.root, 'src/main.ts'), 'utf8'),
  );
  await readFile(join(initialDirectory, 'directories.schema.json'));
  await readFile(join(initialDirectory, 'architecture.schema.json'));
  await readFile(join(initialDirectory, 'directories.prompt.txt'));
  await readFile(join(initialDirectory, 'architecture.prompt.txt'));
  await readFile(join(initialDirectory, 'directories.result.json'));
  await readFile(join(initialDirectory, 'architecture.result.json'));
  await readFile(join(initialDirectory, 'index.json'));
  const initialMetadata = JSON.parse(await readFile(join(initialDirectory, 'job.json'), 'utf8'));
  assert.equal(initialMetadata.status, 'completed');

  const flowJob = await store.enqueue(project.id, 'flow', 'Run the CLI');
  await waitFor(
    // Finish the flow before requesting a focused architecture.
    () => !store.running,
  );
  const flowDirectory = join(history, flowJob.id);
  await writeFile(join(flowDirectory, 'extra-debug.txt'), 'keep this file too');
  const architectureJob = await store.enqueue(project.id, 'architecture', 'Explain the CLI');
  await waitFor(
    // Finish the focused architecture before indexing again.
    () => !store.running,
  );
  const savedUnderstanding = await readFile(store.path(project.id, 'understanding.json'), 'utf8');
  const nounsJob = await store.enqueue(project.id, 'nouns');
  await waitFor(
    // Wait until the fourth job has evicted the first job and saved its metadata.
    () => !store.running,
  );
  const entries = await readdir(history);
  assert.deepEqual(entries.sort(), ['README.md', flowJob.id, architectureJob.id, nounsJob.id].sort());
  await assert.rejects(readFile(join(initialDirectory, 'job.json')), { code: 'ENOENT' });
  assert.equal(await readFile(join(flowDirectory, 'extra-debug.txt'), 'utf8'), 'keep this file too');
  await readFile(join(flowDirectory, 'source/src/main.ts'));
  await readFile(join(flowDirectory, 'flow.schema.json'));
  await readFile(join(history, architectureJob.id, 'source/src/main.ts'));
  await readFile(join(history, nounsJob.id, 'index.json'));
  const afterNouns = JSON.parse(await readFile(store.path(project.id, 'understanding.json'), 'utf8'));
  assert.deepEqual(afterNouns.flows, JSON.parse(savedUnderstanding).flows);
  assert.deepEqual(afterNouns.architectures, JSON.parse(savedUnderstanding).architectures);
  assert.equal(afterNouns.nounAnalyses.length, 1);

  // Another project's jobs must not consume this project's retention slots.
  const otherRoot = join(setup.directory, 'other');
  await mkdir(otherRoot);
  await writeFile(join(otherRoot, 'README.md'), '# Other project\n');
  const other = await store.add({ path: otherRoot, analyze: false });
  await waitFor(
    // Wait for the other project's index-only job to finish.
    () => !store.running,
  );
  assert.deepEqual((await readdir(history)).sort(), entries.sort());
  await assert.rejects(readdir(store.path(other.id, 'last_jobs')), { code: 'ENOENT' });
});

// Order retention by recorded start times and preserve interrupted files across restarts.
test('job history uses recorded start times and preserves interrupted files', async (context) => {
  const setup = await createProjectFixture(context);
  const project = {
    id: 'demo-project',
    name: 'Demo project',
    root: setup.root,
    job: {
      id: 'interrupted-job',
      kind: 'initial',
      status: 'running',
      startedAt: '2026-11-18T10:00:00.000Z',
      message: 'Analyzing source.',
      messages: [{ message: 'Analyzing source.', timestamp: '2026-11-18T10:00:00.000Z' }],
    },
  };
  await writeJson(join(setup.dataDirectory, 'projects.json'), [project]);
  const projectDirectory = join(setup.dataDirectory, 'projects', project.id);
  const savedUnderstanding = {
    directoryAnalysis: { summary: 'Previously saved results' }, flows: [],
  };
  await writeJson(join(projectDirectory, 'understanding.json'), savedUnderstanding);

  for (const [index, id] of ['oldest', 'older', 'recent', 'newest', 'interrupted-job'].entries()) {
    const directory = join(projectDirectory, 'last_jobs', id);
    await mkdir(join(directory, 'source'), { recursive: true });
    await writeFile(join(directory, 'source/partial.txt'), `partial source ${id}`);
    await writeFile(join(directory, 'architecture.schema.json'), '{}');
    await writeFile(join(directory, 'extra-debug.txt'), `debug ${id}`);
    const timestamp = `2026-11-18T09:00:0${index}.000Z`;
    await writeJson(join(directory, 'job.json'), {
      id, kind: 'initial', status: 'completed', startedAt: timestamp,
      finishedAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
      message: 'Analysis is ready.',
      messages: [{ message: 'Analysis is ready.', timestamp }],
    });

    // Filesystem times deliberately oppose execution order and must not affect retention.
    const modified = new Date(`2026-11-18T09:10:0${4 - index}.000Z`);
    await utimes(directory, modified, modified);
  }

  const store = new ProjectStore({ dataDirectory: setup.dataDirectory });
  // Close the initialized store even if an assertion fails.
  context.after(() => store.close());
  assert.equal((await store.list())[0].job.status, 'interrupted');
  const history = join(projectDirectory, 'last_jobs');
  assert.deepEqual(
    (await readdir(history)).sort(),
    ['README.md', 'recent', 'newest', 'interrupted-job'].sort(),
  );
  await assert.rejects(readdir(join(projectDirectory, 'jobs')), { code: 'ENOENT' });

  for (const id of ['recent', 'newest', 'interrupted-job']) {
    assert.equal(await readFile(join(history, id, 'source/partial.txt'), 'utf8'), `partial source ${id}`);
    assert.equal(await readFile(join(history, id, 'extra-debug.txt'), 'utf8'), `debug ${id}`);
    await readFile(join(history, id, 'architecture.schema.json'));
  }

  assert.equal(
    JSON.parse(await readFile(join(history, 'interrupted-job/job.json'), 'utf8')).status,
    'interrupted',
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(projectDirectory, 'understanding.json'), 'utf8')),
    savedUnderstanding,
  );
  await store.close();
  const reopened = new ProjectStore({ dataDirectory: setup.dataDirectory });
  // Close the second store after checking that retained files survive restart.
  context.after(() => reopened.close());
  await reopened.list();
  assert.equal(
    await readFile(join(history, 'interrupted-job/source/partial.txt'), 'utf8'),
    'partial source interrupted-job',
  );
  assert.equal((await readdir(history)).length, 4);
});

// Verify CLI arguments, streamed results, citation checks, and termination behavior.
test('runner launches codex with argument arrays, reads JSONL, and validates source evidence', async (context) => {
  const setup = await createProjectFixture(context);
  const executable = join(setup.directory, 'fake codex');
  await writeFile(
    executable,
    `#!/usr/bin/env node\nconst args=process.argv.slice(2);\nif(!args.includes('--sandbox')||args[args.indexOf('--sandbox')+1]!=='read-only'||!args.includes('--ignore-user-config')||!args.includes('--skip-git-repo-check'))process.exit(3);\nprocess.stdin.resume();process.stdin.on('end',()=>{console.log(JSON.stringify({type:'turn.started'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(${JSON.stringify(outputs.architecture())})}}));console.log(JSON.stringify({type:'turn.completed'}));});\n`,
    { mode: 0o700 },
  );
  const index = await indexProject(setup.root, 'Demo');
  const snapshot = await createSnapshot({ root: setup.root }, index, join(setup.directory, 'job'));
  const value = await runCodex({
    root: snapshot.root,
    schemaPath: 'schema with spaces.json',
    prompt: 'Analyze this snapshot.',
    command: executable,
  });
  assert.equal(value.title, 'CLI design');
  const validated = validateAnalysis('architecture', value, index, snapshot);
  assert.ok(validated.nodes[0].sources[0].hash);
  const directoryAnalysis = outputs.directories();
  directoryAnalysis.directories[1].description = 'Calls `main()`. [src/main.ts:1]';
  const cleanDirectories = validateAnalysis('directories', directoryAnalysis, index, snapshot);
  assert.equal(cleanDirectories.directories[1].description, 'Calls `main()`.');
  assert.equal(cleanDirectories.directories[1].sources.length, 1);
  const invalid = outputs.architecture();
  invalid.nodes[0].sources[0].line = 999;
  // Reject a citation whose line does not exist in the snapshot.
  assert.throws(
    () => validateAnalysis('architecture', invalid, index, snapshot),
    /citation does not exist/,
  );
  const badEdge = outputs.architecture();
  badEdge.edges = [
    {
      from: 'cli',
      to: 'missing',
      label: 'bad',
      description: 'bad',
      kind: 'uses',
      inferred: false,
      sources: [],
    },
  ];
  // Reject an architecture connection referencing an unknown component.
  assert.throws(
    () => validateAnalysis('architecture', badEdge, index, snapshot),
    /unknown component/,
  );
  await assert.rejects(
    runCodex({
      root: snapshot.root,
      schemaPath: 'x',
      prompt: 'x',
      command: join(setup.directory, 'missing-codex'),
    }),
    /CLI was not found/,
  );
  const hanging = join(setup.directory, 'hanging-codex');
  await writeFile(hanging, '#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n', { mode: 0o700 });
  const controller = new AbortController();
  const cancelled = runCodex({
    root: snapshot.root,
    schemaPath: 'x',
    prompt: 'x',
    command: hanging,
    signal: controller.signal,
  });
  // Abort the hanging CLI after it has started.
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(cancelled, /cancelled/);
  await assert.rejects(
    runCodex({
      root: snapshot.root,
      schemaPath: 'x',
      prompt: 'x',
      command: hanging,
      timeoutMs: 30,
    }),
    /timed out/,
  );
});

// Verify a failed stage preserves completed results and can be retried.
test('failed analysis retains completed results and makes the failure retryable', async (context) => {
  const setup = await createProjectFixture(context);
  const store = new ProjectStore({
    ...setup,
    // Simulate architecture failure after the directory stage succeeds.
    run: async (options) => {
      if (options.schemaPath.endsWith('architecture.schema.json'))
        throw new Error('Provider unavailable.');
      return runFakeAnalysis(options);
    },
  });
  // Close the retry test's project store.
  context.after(() => store.close());
  const project = await store.add({ path: setup.root });
  await waitFor(
    // Wait for the simulated provider failure to be saved.
    async () => (await store.get(project.id)).job.status === 'failed',
  );
  const view = await store.view(project.id);
  assert.equal(view.tree.title, 'Demo CLI');
  assert.deepEqual(view.architectures, []);
  assert.match(view.job.message, /Provider unavailable/);
  await waitFor(
    // Wait for failed-job metadata to finish saving before inspecting its files.
    () => !store.running,
  );
  const failedDirectory = store.path(project.id, `last_jobs/${view.job.id}`);
  await readFile(join(failedDirectory, 'source/src/main.ts'));
  await readFile(join(failedDirectory, 'directories.result.json'));
  await readFile(join(failedDirectory, 'architecture.schema.json'));
  await readFile(join(failedDirectory, 'architecture.prompt.txt'));
  assert.equal(JSON.parse(await readFile(join(failedDirectory, 'job.json'), 'utf8')).status, 'failed');
  store.run = runFakeAnalysis;
  await store.enqueue(project.id);
  await waitFor(
    // Wait for the retried analysis to finish successfully.
    async () => (await store.get(project.id)).job.status === 'completed',
  );
  assert.equal((await store.view(project.id)).architectures[0].id, 'overview');
});

// Verify the viewer exposes exact saved prompts and schemas, using job-owned files.
test('HTTP prompt viewer exposes saved inputs during and after analysis', async (context) => {
  const setup = await createProjectFixture(context);
  const inputs = [];
  let finishStage;
  const store = new ProjectStore({
    ...setup,

    // Hold each stage while its saved prompt is inspected through HTTP.
    run: async (options) => {
      inputs.push(options);
      await new Promise(
        // Release blocked stages on cancellation if an assertion fails.
        (resolve) => {
          finishStage = resolve;
          options.signal.addEventListener('abort', resolve, { once: true });
        },
      );

      return runFakeAnalysis(options);
    },
  });
  const app = createApp({ store });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  // Close the worker and listener even if prompt inspection fails.
  context.after(async () => {
    await store.close();
    app.closeAllConnections();
    await new Promise(
      // Wait for the test listener to stop accepting requests.
      (resolve) => app.close(resolve),
    );
  });
  const base = `http://127.0.0.1:${app.address().port}`;
  const project = await store.add({ path: setup.root });
  // Wait until the runner receives the directory prompt.
  await waitFor(() => inputs.length === 1);
  const jobId = (await store.get(project.id)).job.id;
  const url = `${base}/api/projects/${project.id}/jobs/${jobId}/prompts`;
  const first = await (await fetch(url)).json();
  assert.equal(first.directory, store.path(project.id, `last_jobs/${jobId}`));
  assert.deepEqual(first.prompts, [{ stage: 'directories',
    path: join(first.directory, 'directories.prompt.txt'), content: inputs[0].prompt,
    schema: { path: inputs[0].schemaPath, content: await readFile(inputs[0].schemaPath, 'utf8') },
  }]);
  assert.deepEqual(JSON.parse(first.prompts[0].schema.content), schemas.directories);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  assert.equal((await fetch(url, { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(url, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
  assert.equal((await fetch(`${base}/api/projects/missing/jobs/${jobId}/prompts`)).status, 404);
  assert.equal((await fetch(`${base}/api/projects/${project.id}/jobs/missing/prompts`)).status, 404);
  assert.equal((await fetch(`${base}/api/projects/${project.id}/jobs/..%2Foutside/prompts`)).status, 404);

  const otherRoot = join(setup.directory, 'queued');
  await mkdir(otherRoot);
  await writeFile(join(otherRoot, 'README.md'), '# Queued project');
  const other = await store.add({ path: otherRoot });
  const otherJob = (await store.get(other.id)).job;
  const queuedUrl = `${base}/api/projects/${other.id}/jobs/${otherJob.id}/prompts`;
  assert.deepEqual((await (await fetch(queuedUrl)).json()).prompts, []);
  assert.equal((await fetch(`${base}/api/projects/${other.id}/jobs/${jobId}/prompts`)).status, 404);
  await store.cancel(other.id);

  finishStage();
  // Wait until the second stage is running before inspecting both saved prompts.
  await waitFor(() => inputs.length === 2);
  const second = await (await fetch(url)).json();
  assert.deepEqual(second.prompts, [first.prompts[0], { stage: 'architecture',
    path: join(first.directory, 'architecture.prompt.txt'), content: inputs[1].prompt,
    schema: { path: inputs[1].schemaPath, content: await readFile(inputs[1].schemaPath, 'utf8') },
  }]);
  assert.deepEqual(JSON.parse(second.prompts[1].schema.content), schemas.architecture);
  await writeFile(join(first.directory, 'private-debug.txt'), 'Unrelated debug data');
  finishStage();
  // Wait for final job metadata as well as the result.
  await waitFor(() => !store.running);
  assert.equal((await store.get(project.id)).job.status, 'completed');
  assert.deepEqual(await (await fetch(`${url}?path=private-debug.txt`)).json(), second);

  // Show historical saved schemas even when they differ from today's definitions.
  const historicalSchema = '{"type":"object","properties":{"legacy":{"type":"string"}}}';
  await writeFile(inputs[0].schemaPath, historicalSchema);
  const historical = await (await fetch(url)).json();
  assert.equal(historical.prompts[0].schema.content, historicalSchema);
  await rm(inputs[0].schemaPath);
  const missingSchema = await (await fetch(url)).json();
  assert.deepEqual(missingSchema.prompts[0], { ...first.prompts[0], schema: null });
  assert.deepEqual(missingSchema.prompts[1], second.prompts[1]);
  await rm(first.directory, { recursive: true });
  assert.deepEqual((await (await fetch(url)).json()).prompts, []);
});

// Return a missing-project error from every HTTP analysis enqueue endpoint.
test('HTTP enqueue rejects a missing project without creating a job', async (context) => {
  const setup = await createProjectFixture(context);
  const run = context.mock.fn(runFakeAnalysis);
  const store = new ProjectStore({ ...setup, run });
  const app = createApp({ store });
  // Close workers and the HTTP listener before removing the fixture.
  context.after(async () => {
    await store.close();
    app.closeAllConnections();
    await new Promise(
      // Wait until the temporary HTTP server releases its listening socket.
      (resolve) => app.close(resolve),
    );
  });
  await store.add({ path: setup.root, analyze: false });
  const projects = await store.list();
  const registryPath = join(setup.dataDirectory, 'projects.json');
  const registry = await readFile(registryPath, 'utf8');
  const savedProjects = await readdir(join(setup.dataDirectory, 'projects'));
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const base = `http://127.0.0.1:${app.address().port}`;

  for (const [endpoint, body] of [
    ['analysis', {}], ['directories', {}],
    ['architecture', { question: 'Explain main()' }],
    ['flows', { feature: 'Trace main()' }],
    ['nouns', { scope: 'src/' }],
    ['endpoints', { scope: 'src/' }],
    ['sequences', { question: 'Diagram main()' }],
  ]) {
    const response = await fetch(`${base}/api/projects/missing/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 404, endpoint);
    assert.deepEqual(await response.json(), { error: 'Project not found.' }, endpoint);
  }

  assert.equal(run.mock.callCount(), 0);
  assert.deepEqual(store.queue, []);
  assert.equal(store.running, null);
  assert.deepEqual(await store.list(), projects);
  assert.equal(await readFile(registryPath, 'utf8'), registry);
  assert.deepEqual(await readdir(join(setup.dataDirectory, 'projects')), savedProjects);
});

// Verify project HTTP APIs, direct routes, and local-origin boundaries.
test('HTTP project APIs, direct routes, method rules, and origin boundaries work', async (context) => {
  const setup = await createProjectFixture(context);
  const store = new ProjectStore({ ...setup, run: runFakeAnalysis });
  let pickerCalls = 0;
  let selection = { cancelled: false, path: setup.root };
  const app = createApp({
    store,

    // Provide authenticated runner status without contacting the real CLI.
    runnerStatus: async () => ({ available: true, authenticated: true, message: 'Test runner' }),

    // Count native picker calls and return the current simulated selection.
    chooseDirectory: async () => {
      pickerCalls++;
      return selection;
    },
  });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  // Close the worker and all HTTP connections after the test.
  context.after(async () => {
    await store.close();
    app.closeAllConnections();
    await new Promise(
      // Wait for the HTTP listener to close.
      (resolve) => app.close(resolve),
    );
  });
  const base = `http://127.0.0.1:${app.address().port}`;

  // Send JSON mutations with optional headers to the test server.
  const post = (path, body, headers = {}) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  const settings = await fetch(`${base}/api/settings`);
  assert.equal(settings.status, 200);
  assert.deepEqual(await settings.json(), { dataDirectory: setup.dataDirectory });
  assert.equal((await post('/api/settings', {})).status, 405);
  assert.equal(
    (await fetch(`${base}/api/settings`, { headers: { Origin: 'https://untrusted.example' } }))
      .status,
    403,
  );

  assert.equal((await fetch(`${base}/api/choose-directory`)).status, 405);
  const routerAsset = await fetch(`${base}/graph-routing.js`);
  assert.equal(routerAsset.status, 200);
  assert.match(routerAsset.headers.get('content-type'), /text\/javascript/);
  assert.match(await routerAsset.text(), /export function routeGraphEdges/);
  const analysisListAsset = await fetch(`${base}/analysis-list.js`);
  assert.equal(analysisListAsset.status, 200);
  assert.match(analysisListAsset.headers.get('content-type'), /text\/javascript/);
  assert.match(await analysisListAsset.text(), /export function getAnalysisEntries/);
  const scanAsset = await fetch(`${base}/code-scan.js`);
  assert.equal(scanAsset.status, 200);
  assert.match(scanAsset.headers.get('content-type'), /text\/javascript/);
  assert.match(await scanAsset.text(), /export function renderCodeScan/);

  // Traverse browser imports so extracted modules cannot silently return missing assets.
  const moduleUrls = new Set(['/app.js']);
  for (const path of moduleUrls) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /text\/javascript/, path);
    const source = await response.text();
    for (const [, specifier] of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g))
      moduleUrls.add(new URL(specifier, `${base}${path}`).pathname);
  }

  assert.equal(
    (await post('/api/choose-directory', {}, { Origin: 'https://untrusted.example' })).status,
    403,
  );
  assert.equal((await fetch(`${base}/api/choose-directory`, { method: 'POST' })).status, 415);
  assert.equal(pickerCalls, 0);
  assert.deepEqual(await (await post('/api/choose-directory', {})).json(), selection);
  selection = { cancelled: true, path: null };
  assert.deepEqual(await (await post('/api/choose-directory', {})).json(), selection);
  assert.equal(pickerCalls, 2);
  assert.equal((await (await fetch(`${base}/api/projects`)).json()).projects.length, 0);
  assert.equal(
    (await post('/api/projects', { path: setup.root }, { Origin: 'https://untrusted.example' }))
      .status,
    403,
  );
  const rebindingStatus = await new Promise(
    // Read the response to a request carrying an untrusted Host header.
    (resolve, reject) => {
      const request = httpRequest(
        `${base}/api/projects`,
        { headers: { Host: 'untrusted.example' } },
        // Drain the HTTP response and expose its status for the boundary assertion.
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on('error', reject);
      request.end();
    },
  );
  assert.equal(rebindingStatus, 403);
  const response = await post('/api/projects', { path: setup.root });
  assert.equal(response.status, 202);
  const project = await response.json();
  assert.equal(project.id, 'demo-project');
  assert.equal((await post(`/api/projects/${project.id}/refresh`, {})).status, 404);
  assert.equal((await fetch(`${base}/api/projects/${project.id}/refresh`)).status, 404);
  await waitFor(
    // Wait for the HTTP-created project's analysis to finish.
    async () => (await store.get(project.id)).job.status === 'completed',
  );

  for (const path of ['/api/project', '/api/source?path=src%2Fmain.ts']) {
    assert.equal((await fetch(`${base}${path}`)).status, 404);
    assert.equal((await fetch(`${base}${path}`, { method: 'HEAD' })).status, 404);
    assert.equal((await post(path, {})).status, 404);
  }

  const directoriesUrl = `/api/projects/${project.id}/directories`;
  assert.equal((await fetch(`${base}${directoriesUrl}`)).status, 405);
  assert.equal((await fetch(`${base}${directoriesUrl}`, { method: 'HEAD' })).status, 405);
  assert.equal((await fetch(`${base}${directoriesUrl}`, { method: 'POST' })).status, 415);
  assert.equal((await post(directoriesUrl, {}, { Origin: 'https://untrusted.example' })).status, 403);
  const directoryResponse = await post(directoriesUrl, {});
  assert.equal(directoryResponse.status, 202);
  assert.equal((await directoryResponse.json()).kind, 'directories');
  await waitFor(
    // Wait for the independent directory rerun requested over HTTP.
    () => !store.running,
  );
  assert.equal((await store.view(project.id)).architectures.length, 1);

  const actionsUrl = `/api/projects/${project.id}/analyses/architecture/overview`;
  assert.equal((await fetch(`${base}${actionsUrl}/duplicate`)).status, 405);
  assert.equal((await fetch(`${base}${actionsUrl}/duplicate`, { method: 'POST' })).status, 415);
  assert.equal((await post(`${actionsUrl}/delete`, {}, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await post(`/api/projects/${project.id}/analyses/sequences/missing/delete`, {})).status, 404);
  assert.equal((await post(`/api/projects/${project.id}/analyses/directories/directories/duplicate`, {})).status, 400);
  const copyResponse = await post(`${actionsUrl}/duplicate`, {});
  assert.equal(copyResponse.status, 200);
  const copyId = (await copyResponse.json()).analysisId;
  const copyUrl = `/api/projects/${project.id}/analyses/architecture/${copyId}`;
  const rerunResponse = await post(`${copyUrl}/rerun`, {});
  assert.equal(rerunResponse.status, 202);
  assert.equal((await rerunResponse.json()).analysisId, copyId);
  await waitFor(
    // Wait for the targeted HTTP rerun before deleting its copy.
    () => !store.running,
  );
  assert.equal((await fetch(`${base}${copyUrl}/modify`)).status, 405);
  assert.equal((await fetch(`${base}${copyUrl}/modify`, { method: 'POST' })).status, 415);
  assert.equal((await post(`${copyUrl}/modify`, { prompt: 'Explain more' },
    { Origin: 'https://untrusted.example' })).status, 403);
  for (const prompt of [undefined, '', '  ', 'x'.repeat(4001), 42])
    assert.equal((await post(`${copyUrl}/modify`, { prompt })).status, 400);
  const modification = await post(`${copyUrl}/modify`, { prompt: 'Explain the greeting.' });
  assert.equal(modification.status, 202);
  const modificationJob = await modification.json();
  assert.equal(modificationJob.analysisId, copyId);
  assert.equal(modificationJob.modificationPrompt, 'Explain the greeting.');
  await waitFor(
    // Finish the HTTP modification before reading its persisted prompt history.
    () => !store.running,
  );
  assert.deepEqual((await store.view(project.id)).architectures.find(
    // Verify the same saved copy was revised instead of creating another result.
    (entry) => entry.id === copyId,
  ).modificationPrompts, ['Explain the greeting.']);
  assert.equal((await post(`${copyUrl}/delete`, {})).status, 200);
  assert.equal((await store.view(project.id)).architectures.length, 1);

  for (const path of [
    '/',
    '/flows',
    '/directories/src',
    '/architecture',
    '/nouns',
    '/sequences',
    '/code-scan',
    '/all',
    `/projects/${project.id}/directories`,
    `/projects/${project.id}/flows/hello`,
    `/projects/${project.id}/architecture`,
    `/projects/${project.id}/nouns`,
    `/projects/${project.id}/sequences`,
    `/projects/${project.id}/sequences/saved-diagram`,
    `/projects/${project.id}/code-scan`,
    `/projects/${project.id}/code-scan/src`,
    `/projects/${project.id}/all`,
  ]) {
    const page = await fetch(`${base}${path}`);
    assert.equal(page.status, 200, path);
    const pageText = await page.text();
    assert.match(pageText, /CodeScope/);
    assert.match(pageText, /id="tab-sequences"[\s\S]*id="tab-all"/);
    assert.doesNotMatch(pageText, /Refresh index|Analyze project|id="refresh"|id="analyze-project"/);
    assert.equal((await fetch(`${base}${path}`, { method: 'HEAD' })).status, 200);
  }

  assert.equal((await post('/api/projects', { path: setup.root })).status, 409);
  const keepfitRoot = join(setup.directory, 'keepfit');
  await mkdir(keepfitRoot);
  const duplicateName = await post('/api/projects', {
    path: keepfitRoot,
    name: '  DEMO PROJECT  ',
  });
  assert.equal(duplicateName.status, 409);
  assert.match((await duplicateName.json()).error, /project with this name/);
  assert.equal((await store.list()).length, 1);
  const view = await (await fetch(`${base}/api/projects/${project.id}`)).json();
  assert.equal(view.codeScan.directories[0].path, 'src');
  assert.equal(view.codeScan.directories[0].files[0].symbols[0].name, 'main');
  assert.equal(view.architectures[0].nodes[0].title, 'CLI');
  assert.match(
    (await (await fetch(`${base}/api/projects/${project.id}/source?path=src%2Fmain.ts`)).json())
      .content,
    /function main/,
  );
  assert.equal(
    (await fetch(`${base}/api/projects/${project.id}/source?path=..%2Foutside`)).status,
    404,
  );
  assert.equal((await fetch(`${base}/api/projects/missing`)).status, 404);
  assert.equal((await post(`/api/projects/${project.id}/flows`, { feature: '' })).status, 400);

  for (const question of ['', ' ', null, 42, 'a'.repeat(4001)])
    assert.equal(
      (await post(`/api/projects/${project.id}/architecture`, { question })).status,
      400,
    );

  assert.equal((await fetch(`${base}/api/projects/${project.id}/architecture`)).status, 405);
  assert.equal(
    (
      await post(
        `/api/projects/${project.id}/architecture`,
        { question: 'How does the CLI work?' },
        { Origin: 'https://untrusted.example' },
      )
    ).status,
    403,
  );
  const diagramJob = await post(`/api/projects/${project.id}/architecture`, {
    question: 'How does the CLI work?',
  });
  assert.equal(diagramJob.status, 202);
  assert.equal((await diagramJob.json()).kind, 'architecture');
  await waitFor(
    // Wait for the requested focused diagram to finish before reading its route.
    async () => (await store.get(project.id)).job.status === 'completed',
  );
  const diagrams = (await (await fetch(`${base}/api/projects/${project.id}`)).json()).architectures;
  assert.equal(diagrams.length, 2);
  assert.equal(diagrams[1].requestedQuestion, 'How does the CLI work?');
  assert.equal(
    (await fetch(`${base}/projects/${project.id}/architecture/${diagrams[1].id}`)).status,
    200,
  );
  const deletionUrl = `/api/projects/${project.id}/architecture/${diagrams[1].id}/nodes/cli/delete`;
  assert.equal((await fetch(`${base}${deletionUrl}`)).status, 405);
  assert.equal((await post(deletionUrl, {}, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await fetch(`${base}${deletionUrl}`, { method: 'POST' })).status, 415);
  assert.equal(
    (await post(`/api/projects/${project.id}/architecture/missing/nodes/cli/delete`, {})).status,
    404,
  );
  const deletion = await post(deletionUrl, {});
  assert.equal(deletion.status, 200);
  assert.deepEqual(await deletion.json(), { deletedNodeId: 'cli', deletedConnections: 0 });
  const edited = await (await fetch(`${base}/api/projects/${project.id}`)).json();
  assert.deepEqual(edited.architectures[1].nodes, []);
  assert.deepEqual(edited.architectures[1].edges, []);
  assert.equal(edited.architectures[0].nodes.length, 1);
  assert.equal((await fetch(`${base}/api/projects/${project.id}/analysis`)).status, 405);
  assert.equal((await fetch(`${base}/api/projects`, { method: 'DELETE' })).status, 405);
  assert.equal((await fetch(`${base}/unknown`)).status, 404);
  const sequencesUrl = `/api/projects/${project.id}/sequences`;
  assert.equal((await fetch(`${base}${sequencesUrl}`)).status, 405);
  assert.equal((await fetch(`${base}${sequencesUrl}`, { method: 'POST' })).status, 415);
  assert.equal((await post(sequencesUrl, { question: 'Run main' }, { Origin: 'https://untrusted.example' })).status, 403);
  for (const question of [undefined, null, '', '  ', 7, 'x'.repeat(4001)])
    assert.equal((await post(sequencesUrl, { question })).status, 400);
  const sequenceResponse = await post(sequencesUrl, { question: '  Diagram main()  ' });
  assert.equal(sequenceResponse.status, 202);
  assert.equal((await sequenceResponse.json()).kind, 'sequence');
  await waitFor(
    // Wait for the sequence result to be persisted through the HTTP API.
    () => !store.running,
  );
  const sequenceView = await (await fetch(`${base}/api/projects/${project.id}`)).json();
  assert.equal(sequenceView.sequences[0].requestedQuestion, 'Diagram main()');
  assert.equal(sequenceView.job.resultId, sequenceView.sequences[0].id);
  assert.equal((await fetch(`${base}/projects/${project.id}/sequences/${sequenceView.job.resultId}`)).status, 200);
  assert.match(await (await fetch(`${base}/sequence-diagram.js`)).text(), /renderSequenceDiagram/);

  const nounsUrl = `/api/projects/${project.id}/nouns`;
  assert.equal((await fetch(`${base}${nounsUrl}`)).status, 405);
  assert.equal((await fetch(`${base}${nounsUrl}`, { method: 'HEAD' })).status, 405);
  assert.equal((await fetch(`${base}${nounsUrl}`, { method: 'POST' })).status, 415);
  assert.equal((await post(nounsUrl, {}, { Origin: 'https://untrusted.example' })).status, 403);
  for (const scope of [null, 42, [], {}, 'a'.repeat(4001)])
    assert.equal((await post(nounsUrl, { scope })).status, 400);
  for (const body of [{}, { scope: 'src/' }, { scope: '   ' }]) {
    const response = await post(nounsUrl, body);
    assert.equal(response.status, 202);
    assert.equal((await response.json()).kind, 'nouns');
    await waitFor(
      // Wait for each HTTP-requested result before starting the next scope.
      () => !store.running,
    );
  }
  const nounsView = await (await fetch(`${base}/api/projects/${project.id}`)).json();
  assert.equal(nounsView.nounAnalyses.length, 3);
  assert.equal(nounsView.nounAnalyses[1].requestedScope, 'src/');
  assert.equal(nounsView.nounAnalyses[2].requestedScope, null);
  assert.equal(nounsView.job.resultId, nounsView.nounAnalyses[2].id);
  assert.equal((await fetch(`${base}/projects/${project.id}/nouns/${nounsView.job.resultId}`)).status, 200);
  assert.equal(nounsView.architectures.length, 2);
  const renameUrl = `/api/projects/${project.id}/rename`;
  assert.equal((await fetch(`${base}${renameUrl}`)).status, 405);
  assert.equal((await fetch(`${base}${renameUrl}`, { method: 'HEAD' })).status, 405);
  assert.equal((await fetch(`${base}${renameUrl}`, { method: 'POST' })).status, 415);
  assert.equal((await post(renameUrl, { name: 'New name' }, {
    Origin: 'https://untrusted.example',
  })).status, 403);
  assert.equal((await post('/api/projects/missing/rename', { name: 'New name' })).status, 404);
  for (const name of [null, 42, [], {}, '', '  ', 'a'.repeat(101)])
    assert.equal((await post(renameUrl, { name })).status, 400);
  assert.equal((await post(renameUrl, {})).status, 400);
  const second = await store.add({ path: keepfitRoot, name: 'Keepfit', analyze: false });
  const duplicateRename = await post(renameUrl, { name: '  KEEPFit  ' });
  assert.equal(duplicateRename.status, 409);
  assert.match((await duplicateRename.json()).error, /project with this name/);
  const renameResponse = await post(renameUrl, { name: '  Renamed project  ' });
  assert.equal(renameResponse.status, 200);
  const renamed = await renameResponse.json();
  assert.equal(renamed.name, 'Renamed project');
  assert.equal(renamed.id, project.id);
  assert.equal(renamed.root, project.root);
  const renamedView = await (await fetch(`${base}/api/projects/${project.id}`)).json();
  assert.equal(renamedView.name, 'Renamed project');
  assert.deepEqual(renamedView.nounAnalyses, nounsView.nounAnalyses);
  const registry = await (await fetch(`${base}/api/projects`)).json();
  assert.equal(registry.projects[0].name, 'Renamed project');
  await store.deleteProject(second.id);
  const projectDeletionUrl = `/api/projects/${project.id}/delete`;
  assert.equal((await fetch(`${base}${projectDeletionUrl}`)).status, 405);
  assert.equal((await fetch(`${base}${projectDeletionUrl}`, { method: 'HEAD' })).status, 405);
  assert.equal((await post(projectDeletionUrl, {}, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await fetch(`${base}${projectDeletionUrl}`, { method: 'POST' })).status, 415);
  assert.equal((await post('/api/projects/missing/delete', {})).status, 404);
  const projectDeletion = await post(projectDeletionUrl, {});
  assert.equal(projectDeletion.status, 200);
  assert.deepEqual(await projectDeletion.json(), { deletedProjectId: project.id });
  assert.equal((await fetch(`${base}/api/projects/${project.id}`)).status, 404);
  assert.deepEqual((await (await fetch(`${base}/api/projects`)).json()).projects, []);
  await readFile(join(setup.root, 'src/main.ts'));
});

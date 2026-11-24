import { mkdir, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateRoot, indexProject, projectView, fail } from './analysis.mjs';
import { createSnapshot, analyzeStage, runCodex } from './runner.mjs';
import { prepareJobHistory, pruneJobHistory } from './job-history.mjs';

// Load saved JSON or clone a fallback when the file does not exist.
export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(fallback);
    throw error;
  }
}

// Replace saved JSON atomically using a private temporary file.
export async function writeJson(path, value) {
  await mkdir(resolve(path, '..'), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temporary, path);
}

// Create the initial empty analysis state for a project.
const createEmptyUnderstanding = () => ({
  directoryAnalysis: null,
  architectures: [],
  flows: [],
  nounAnalyses: [],
  areaAnalyses: [],
  sequences: [],
  endpointAnalyses: [],
  presentations: [],
});

// Recognize jobs that are queued or currently running.
const isJobActive = (job) => job && ['queued', 'running'].includes(job.status);

const analysisTypes = {
  directories: { collection: null, stage: 'directories', request: null },
  architecture: { collection: 'architectures', stage: 'architecture', request: 'requestedQuestion' },
  flows: { collection: 'flows', stage: 'flow', request: 'requestedFeature' },
  nouns: { collection: 'nounAnalyses', stage: 'nouns', request: 'requestedScope' },
  areas: { collection: 'areaAnalyses', stage: 'areas', request: 'requestedScope' },
  sequences: { collection: 'sequences', stage: 'sequence', request: 'requestedQuestion' },
  endpoints: { collection: 'endpointAnalyses', stage: 'endpoints', request: null },
  presentations: { collection: 'presentations', stage: 'presentation', request: 'requestedTopic' },
};

// Locate a saved result without treating a missing selection as a different analysis.
function locateSavedAnalysis(understanding, kind, id) {
  if (kind === 'directories')
    return id === 'directories' && understanding.directoryAnalysis
      ? { analysis: understanding.directoryAnalysis } : null;
  const entries = understanding[analysisTypes[kind].collection] || [];
  const index = entries.findIndex(
    // Stable result IDs identify both authored and generated analyses.
    (entry) => entry.id === id,
  );

  return index < 0 ? null : { analysis: entries[index], entries, index };
}

// Recover the original question, including older results without request metadata.
function savedAnalysisRequest(kind, analysis) {
  if (['directories', 'endpoints'].includes(kind) ||
    ['nouns', 'areas'].includes(kind) && !analysis.requestedScope)
    return null;
  if (kind === 'architecture' && (analysis.id === 'overview' || analysis.requestedQuestion === null))
    return null;
  const request = analysis[analysisTypes[kind].request] || analysis.title;
  if (typeof request !== 'string' || !request.trim() || request.length > 4000)
    throw fail('This saved analysis does not have a valid request to rerun.');

  return request.trim();
}

// Build revision context without exposing the saved source inventory to the model.
function savedAnalysisRevision(understanding, stage, job) {
  if (!job.analysisId || ['directories', 'endpoints'].includes(stage)) return undefined;
  const kind = Object.keys(analysisTypes).find(
    // Resolve the selected result collection from its worker stage.
    (entry) => analysisTypes[entry].stage === stage,
  );
  const target = locateSavedAnalysis(understanding, kind, job.analysisId);
  if (!target) throw fail('The selected analysis no longer exists.', 404);
  const { baseline, coverage, modificationPrompts = [], ...content } = target.analysis;
  if (!job.modificationPrompt && !modificationPrompts.length) return undefined;

  return { analysis: content, instructions: modificationPrompts,
    prompt: job.modificationPrompt || null };
}

// Give repeated copies recognizable names while keeping every result's ID independent.
function copiedAnalysisTitle(entries, title) {
  const base = String(title).replace(/ \(copy(?: \d+)?\)$/, '');
  const titles = new Set(entries.map(
    // Consider existing names only in the selected analysis type.
    (entry) => entry.title,
  ));
  let name = `${base} (copy)`;
  let number = 1;
  while (titles.has(name)) name = `${base} (copy ${++number})`;

  return name;
}

// Keep the four latest distinct progress updates with their recorded timestamps.
function recordJobMessage(job, message, timestamp = new Date().toISOString()) {
  if (job.messages.at(-1)?.message !== message) job.messages.push({ message, timestamp });
  job.message = message;
  job.messages = job.messages.slice(-4);
}

// Normalize a source directory name for use in storage paths and project URLs.
function projectIdBase(root) {
  return (
    basename(root)
      .normalize('NFKD')
      .replace(/\p{Mark}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 80)
      .replace(/^-+|-+$/g, '') || 'project'
  );
}

// Allocate a readable ID without colliding with registered or on-disk names.
function allocateProjectId(root, usedNames) {
  const base = projectIdBase(root);
  let id = base;
  let suffix = 0;

  while (usedNames.has(id.toLowerCase()))
    id = `${base}-${String(++suffix).padStart(2, '0')}`;

  return id;
}

// Save each result with its own complete source baseline and coverage.
function mergeStageResult(understanding, result, stage, job, index, snapshot) {
  const timestamp = new Date().toISOString();
  const { nextPrompts, ...content } = result;
  const analysis = {
    ...content,
    baseline: {
      files: { ...index.files, ...snapshot.fingerprints },
      analyzedAt: timestamp,
    },
    coverage: snapshot.coverage,
  };
  let key = stage;
  if (stage === 'endpoints') {
    const previous = understanding.endpointAnalyses?.at(-1);
    key = previous?.id || 'endpoints';
    // Rediscovery replaces the project-wide inventory only after validation succeeds.
    understanding.endpointAnalyses = [{
      ...analysis, id: key, createdAt: previous?.createdAt || timestamp,
    }];
  } else if (job.analysisId && stage !== 'directories') {
    const kind = Object.keys(analysisTypes).find(
      // Map the single rerun stage back to its saved result collection.
      (entry) => analysisTypes[entry].stage === stage,
    );
    const target = locateSavedAnalysis(understanding, kind, job.analysisId);
    if (!target) throw fail('The analysis being rerun no longer exists.', 404);
    key = target.analysis.id;
    target.entries[target.index] = { ...target.analysis, ...analysis, id: key };
    if (job.modificationPrompt)
      target.entries[target.index].modificationPrompts = [
        ...(target.analysis.modificationPrompts || []), job.modificationPrompt,
      ];
  } else if (stage === 'directories') understanding.directoryAnalysis = analysis;
  else if (stage === 'architecture') {
    const focused = job.kind === 'architecture';
    key = focused ? randomUUID() : 'overview';
    const graph = {
      ...analysis,
      id: key,
      requestedQuestion: focused ? job.feature : null,
      createdAt: timestamp,
    };
    const graphs = understanding.architectures ||= [];
    if (focused) graphs.push(graph);
    else understanding.architectures = [graph, ...graphs.filter(
      // Retrying initial analysis replaces only the first, overall diagram.
      (entry) => entry.id !== 'overview',
    )];
  } else if (stage === 'presentation') {
    key = randomUUID();
    (understanding.presentations ||= []).push({
      ...analysis,
      id: key,
      requestedTopic: job.feature,
      createdAt: timestamp,
    });
  } else if (stage === 'sequence') {
    key = randomUUID();
    (understanding.sequences ||= []).push({
      ...analysis,
      id: key,
      requestedQuestion: job.feature,
      createdAt: timestamp,
    });
  } else if (['nouns', 'areas'].includes(stage)) {
    key = randomUUID();
    const collection = stage === 'areas' ? 'areaAnalyses' : 'nounAnalyses';
    (understanding[collection] ||= []).push({
      ...analysis,
      id: key,
      requestedScope: job.feature,
      createdAt: timestamp,
    });
  } else {
    key = randomUUID();
    (understanding.flows ||= []).push({ id: key, ...analysis, requestedFeature: job.feature });
  }
  understanding.nextPrompts = Object.fromEntries(Object.entries(nextPrompts).map(
    // Store suggestions once at project level rather than inside every saved analysis.
    ([kind, prompt]) => [kind, prompt.trim()],
  ));
  understanding.updatedAt = timestamp;

  return key;
}

// Coordinate registered projects, saved analyses, background jobs, and serialized edits.
export class ProjectStore {
  // Initialize storage paths, queue state, and asynchronous registry loading.
  constructor({
    dataDirectory = process.env.CODESCOPE_DATA_DIR || resolve(import.meta.dirname, '../.codescope'),
    run = runCodex,
  } = {}) {
    this.directory = resolve(dataDirectory);
    this.run = run;
    this.projects = [];
    this.queue = [];
    this.running = null;
    this.closed = false;
    this.writes = Promise.resolve();
    this.edits = new Map();
    this.initializing = this.initialize();
  }

  // Resolve a project-owned storage path after validating its identifier.
  path(id, name) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw fail('Invalid saved project ID.');
    return resolve(this.directory, 'projects', id, name);
  }

  // Load the registry and interrupt abandoned jobs.
  async initialize() {
    const registry = await readJson(resolve(this.directory, 'projects.json'), null);
    this.projects = registry || [];

    for (const project of this.projects) {
      if (isJobActive(project.job)) {
        project.job.status = 'interrupted';
        recordJobMessage(project.job, 'The server restarted before analysis finished. Retry when ready.');
        project.job.finishedAt = new Date().toISOString();
      }

      const directory = await prepareJobHistory(this.path(project.id, '.'));
      if (project.job?.startedAt && /^[a-zA-Z0-9_-]+$/.test(project.job.id))
        await writeJson(resolve(directory, project.job.id, 'job.json'), project.job);
      await pruneJobHistory(directory, project.job?.id);
    }

    await this.saveRegistry();
  }

  // Collect names that are already owned by projects or existing storage entries.
  async usedProjectNames() {
    let entries = [];

    try {
      entries = await readdir(resolve(this.directory, 'projects'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    const registeredNames = this.projects.map(
      // Include registrations whose first job has not created a directory yet.
      (project) => project.id,
    );

    return new Set(
      [...entries, ...registeredNames].map(
        // Avoid case-only collisions on case-insensitive filesystems.
        (name) => name.toLowerCase(),
      ),
    );
  }

  // Serialize registry writes so concurrent updates preserve their order.
  saveRegistry() {
    this.writes = this.writes
      .catch(
        // Allow later writes to proceed after an earlier write failed.
        () => {},
      )
      .then(
        // Write the latest project registry after preceding writes finish.
        () => writeJson(resolve(this.directory, 'projects.json'), this.projects),
      );
    return this.writes;
  }

  // Return a copy of the initialized project registry.
  async list() {
    await this.initializing;
    return structuredClone(this.projects);
  }

  // Find a registered project or report that it is missing.
  async get(id) {
    await this.initializing;
    const project = this.projects.find(
      // Match a registered project by its stable identifier.
      (entry) => entry.id === id,
    );
    if (!project) throw fail('Project not found.', 404);

    return project;
  }

  // Validate a display name while excluding the project being renamed.
  validateProjectName(name, projectId) {
    if (typeof name !== 'string' || !name.trim())
      throw fail('Enter a project name.');
    const trimmed = name.trim();
    if (trimmed.length > 100)
      throw fail('Project names must be 100 characters or fewer.');
    if (
      this.projects.some(
        // Display-name uniqueness is independent of stable directory-based IDs.
        (entry) => entry.id !== projectId &&
          entry.name.trim().toLowerCase() === trimmed.toLowerCase(),
      )
    )
      throw fail(
        'A project with this name is already in your project picker. Choose a different name.',
        409,
      );

    return trimmed;
  }

  // Change only the display name, preserving the source root and saved analyses.
  async renameProject(id, name) {
    const project = await this.get(id);
    if (this.closed) throw fail('CodeScope is shutting down. Try again after restarting.', 503);
    if (this.edits.has(id)) throw fail('A project change is being saved. Try again shortly.', 409);

    // Reserve the name synchronously so concurrent additions and renames see it.
    project.name = this.validateProjectName(name, id);
    await this.saveRegistry();

    return structuredClone(project);
  }

  // Register a canonical project directory and queue its first job.
  async add({ path, name, analyze = true }) {
    await this.initializing;
    const root = await validateRoot(path);
    if (
      this.projects.some(
        // Reject a directory that is already registered.
        (project) => project.root === root,
      )
    )
      throw fail('This directory is already in your project picker.', 409);
    if (name !== undefined && (typeof name !== 'string' || name.trim().length > 100))
      throw fail('Project names must be 100 characters or fewer.');
    if (typeof analyze !== 'boolean') throw fail('The analyze option must be true or false.');
    const usedNames = await this.usedProjectNames();
    // Include projects registered while the filesystem names were being read.
    for (const project of this.projects) usedNames.add(project.id.toLowerCase());
    const project = {
      id: allocateProjectId(root, usedNames),
      name: this.validateProjectName(name?.trim() || basename(root)),
      root,
      createdAt: new Date().toISOString(),
    };
    // Registration is synchronous after canonical-path validation, so duplicate adds cannot race.
    if (
      this.projects.some(
        // Recheck duplicates after asynchronous path validation completes.
        (entry) => entry.root === root,
      )
    )
      throw fail('This directory is already in your project picker.', 409);
    this.projects.push(project);
    await writeJson(this.path(project.id, 'understanding.json'), createEmptyUnderstanding());
    await this.saveRegistry();
    if (analyze) await this.enqueue(project.id, 'initial');

    return structuredClone(project);
  }

  // Scan current files and compare them with the baselines owned by saved analyses.
  async view(id) {
    const project = await this.get(id);
    const index = await indexProject(project.root, project.name);
    const understanding = await readJson(
      this.path(id, 'understanding.json'),
      createEmptyUnderstanding(),
    );

    return projectView(project, index, understanding, project.job || null);
  }

  // Export the saved deck with original citations, excluding private source baselines.
  async presentation(id, deckId) {
    const project = await this.get(id);
    const understanding = await readJson(this.path(id, 'understanding.json'), {});
    const deck = understanding.presentations?.find(
      // Downloads always target the explicitly requested saved result.
      (entry) => entry.id === deckId,
    );
    if (!deck) throw fail('Presentation not found.', 404);
    const { baseline, coverage, ...content } = deck;

    return { projectName: project.name, deck: content };
  }

  // Read saved prompts and output schemas using only known stage filenames.
  async jobPrompts(id, jobId) {
    const project = await this.get(id);
    if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) throw fail('Invalid job ID.');
    const directory = this.path(id, `last_jobs/${jobId}`);
    const prompts = [];

    try {
      const files = await readdir(directory);
      const stages = [
        'directories', 'architecture', 'flow', 'nouns', 'areas', 'sequence', 'endpoints',
        'presentation',
      ];
      for (const stage of stages) {
        const filename = `${stage}.prompt.txt`;
        if (!files.includes(filename)) continue;
        const path = resolve(directory, filename);
        const schemaFilename = `${stage}.schema.json`;
        const schemaPath = resolve(directory, schemaFilename);
        prompts.push({
          stage, path, content: await readFile(path, 'utf8'),
          schema: files.includes(schemaFilename)
            ? { path: schemaPath, content: await readFile(schemaPath, 'utf8') } : null,
        });
      }
    } catch (error) {
      // Queued jobs have no working files until the worker starts them.
      if (error.code !== 'ENOENT') throw error;
      if (project.job?.id !== jobId) throw fail('Saved job prompts are no longer available.', 404);
    }

    return { directory, prompts };
  }

  // Stop project work before removing its saved data and registry entry.
  async deleteProject(id) {
    const project = await this.get(id);
    if (this.closed) throw fail('CodeScope is shutting down. Try again after restarting.', 503);
    if (this.edits.has(id)) throw fail('A project change is being saved. Try again shortly.', 409);
    const removal = (
      // Drain writers before deleting storage so cancelled jobs cannot recreate it.
      async () => {
        this.queue = this.queue.filter(
          // Discard only the deleted project's queued work.
          (entry) => entry.project.id !== id,
        );
        if (this.running?.project.id === id) {
          this.running.controller.abort();
          await this.running.promise;
        }

        await rm(this.path(id, '.'), { recursive: true, force: true });
        this.projects = this.projects.filter(
          // Preserve every other project's registration.
          (entry) => entry !== project,
        );
        await this.saveRegistry();

        return { deletedProjectId: id };
      }
    )();
    this.edits.set(id, removal);

    try {
      return await removal;
    } finally {
      this.edits.delete(id);
    }
  }

  // Validate and persist a new job before adding it to the worker queue.
  async enqueue(id, kind = 'initial', feature) {
    const project = await this.get(id);
    if (!['initial', 'directories', 'flow', 'architecture', 'nouns', 'areas', 'sequence',
      'endpoints', 'presentation']
      .includes(kind))
      throw fail('Unknown analysis job kind.');
    if (this.edits.has(id)) throw fail('A diagram edit is being saved. Try again shortly.', 409);
    if (isJobActive(project.job))
      throw fail('This project already has an analysis job. Wait for it or cancel it first.', 409);
    if (this.closed) throw fail('CodeScope is shutting down. Try again after restarting.', 503);
    if (
      kind === 'flow' &&
      (typeof feature !== 'string' || !feature.trim() || feature.length > 4000)
    )
      throw fail('Describe a code flow in 1–4,000 characters.');
    if (
      kind === 'architecture' &&
      (typeof feature !== 'string' || !feature.trim() || feature.length > 4000)
    )
      throw fail('Ask an architecture question in 1–4,000 characters.');
    if (
      kind === 'sequence' &&
      (typeof feature !== 'string' || !feature.trim() || feature.length > 4000)
    )
      throw fail('Describe a sequence in 1–4,000 characters.');
    if (
      ['nouns', 'areas'].includes(kind) &&
      feature !== undefined &&
      (typeof feature !== 'string' || feature.length > 4000)
    )
      throw fail(`Describe the ${kind} scope in 4,000 characters or fewer, or leave it blank.`);
    if (kind === 'endpoints' && feature !== undefined)
      throw fail('Endpoints discovery covers the entire project and does not accept a scope.');
    if (kind === 'presentation' &&
      (typeof feature !== 'string' || !feature.trim() || feature.length > 4000))
      throw fail('Enter a presentation topic in 1–4,000 characters.');
    return this.queueAnalysisJob(project, kind, feature);
  }

  // Persist a validated job before dispatch, optionally replacing one saved result.
  async queueAnalysisJob(project, kind, feature, analysisId, modificationPrompt) {
    if (this.closed) throw fail('CodeScope is shutting down. Try again after restarting.', 503);
    const job = {
      id: randomUUID(),
      kind,
      feature: ['flow', 'architecture', 'nouns', 'areas', 'sequence', 'presentation'].includes(kind)
        ? feature?.trim() || null : null,
      status: 'queued',
      stage: 'queued',
      message: 'Waiting for the analysis worker…',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(analysisId ? { analysisId } : {}),
      ...(modificationPrompt ? { modificationPrompt } : {}),
    };
    recordJobMessage(job, job.message, job.createdAt);
    project.job = job;
    this.queue.push({ project, job });
    await this.saveRegistry();
    this.pumpQueue();

    return structuredClone(job);
  }

  // Rerun, modify, copy, or delete a saved result under the project's edit lock.
  async changeAnalysis(id, kind, analysisId, action, prompt) {
    const project = await this.get(id);
    if (!Object.hasOwn(analysisTypes, kind) || !['rerun', 'modify', 'duplicate', 'delete'].includes(action))
      throw fail('Unknown analysis action.');
    if (kind === 'endpoints' && ['modify', 'duplicate'].includes(action))
      throw fail('Endpoints discovery can only be rerun or deleted.');
    if (action === 'modify') {
      if (kind === 'directories') throw fail('Directory analysis cannot be modified with a prompt.');
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000)
        throw fail('Describe the modification in 1–4,000 characters.');
    }
    if (this.closed) throw fail('CodeScope is shutting down. Try again after restarting.', 503);
    if (isJobActive(project.job))
      throw fail('Wait for the current analysis to finish or cancel it first.', 409);
    if (this.edits.has(id)) throw fail('A project change is being saved. Try again shortly.', 409);
    const operation = (
      // Read and modify only the selected result while excluding competing writers.
      async () => {
        const understanding = await readJson(this.path(id, 'understanding.json'), createEmptyUnderstanding());
        const target = locateSavedAnalysis(understanding, kind, analysisId);
        if (!target) throw fail('Analysis not found.', 404);
        if (['rerun', 'modify'].includes(action))
          return this.queueAnalysisJob(project, analysisTypes[kind].stage,
            savedAnalysisRequest(kind, target.analysis), analysisId,
            action === 'modify' ? prompt.trim() : undefined);

        let resultId = analysisId;
        if (action === 'duplicate') {
          if (kind === 'directories') throw fail('The directories analysis cannot be duplicated.');
          const copy = {
            ...structuredClone(target.analysis),
            id: randomUUID(),
            title: copiedAnalysisTitle(target.entries, target.analysis.title),
            createdAt: new Date().toISOString(),
          };
          target.entries.splice(target.index + 1, 0, copy);
          resultId = copy.id;
        } else if (kind === 'directories') understanding.directoryAnalysis = null;
        else if (kind === 'endpoints') understanding.endpointAnalyses = [];
        else target.entries.splice(target.index, 1);

        understanding.updatedAt = new Date().toISOString();
        await writeJson(this.path(id, 'understanding.json'), understanding);

        return { kind, analysisId: resultId };
      }
    )();
    this.edits.set(id, operation);

    try {
      return await operation;
    } finally {
      this.edits.delete(id);
    }
  }

  // Remove a diagram node and its connections under a per-project edit lock.
  async deleteArchitectureNode(id, diagramId, nodeId) {
    const project = await this.get(id);
    if (this.closed) throw fail('CodeScope is shutting down. Try again after restarting.', 503);
    if (isJobActive(project.job))
      throw fail('Wait for the current analysis to finish before editing this diagram.', 409);
    if (this.edits.has(id)) throw fail('A diagram edit is being saved. Try again shortly.', 409);
    const edit = (
      // Load and atomically save the selected diagram's node deletion.
      async () => {
        const understanding = await readJson(
          this.path(id, 'understanding.json'),
          createEmptyUnderstanding(),
        );
        const graph = (understanding.architectures || []).find(
          // Find any saved diagram by its stable ID, including the initial overview.
          (entry) => entry.id === diagramId,
        );
        if (!graph) throw fail('Architecture diagram not found.', 404);
        if (
          !graph.nodes.some(
            // Confirm that the selected diagram still contains the node.
            (node) => node.id === nodeId,
          )
        )
          throw fail('Diagram node not found.', 404);
        const edges = graph.edges.filter(
          // Keep connections that do not touch the deleted node.
          (edge) => edge.from !== nodeId && edge.to !== nodeId,
        );
        const deletedConnections = graph.edges.length - edges.length;
        graph.nodes = graph.nodes.filter(
          // Keep all diagram nodes except the selected one.
          (node) => node.id !== nodeId,
        );
        graph.edges = edges;
        understanding.updatedAt = new Date().toISOString();
        await writeJson(this.path(id, 'understanding.json'), understanding);

        return { deletedNodeId: nodeId, deletedConnections };
      }
    )();
    this.edits.set(id, edit);

    try {
      return await edit;
    } finally {
      this.edits.delete(id);
    }
  }

  // Persist job changes with a new update timestamp.
  async updateJob(job, changes) {
    const updatedAt = new Date().toISOString();
    if (typeof changes.message === 'string') recordJobMessage(job, changes.message, updatedAt);
    Object.assign(job, changes, { updatedAt });
    await this.saveRegistry();
  }

  // Start the next queued job when the worker is idle.
  pumpQueue() {
    if (this.running || this.closed) return;
    let next;

    while ((next = this.queue.shift())) {
      if (next.job.status === 'queued') break;
    }

    if (!next) return;
    const controller = new AbortController();
    const promise = this.executeJob(next.project, next.job, controller.signal).finally(
      // Release the worker slot and continue with the next queued job.
      () => {
        this.running = null;
        this.pumpQueue();
      },
    );
    this.running = { ...next, controller, promise };
  }

  // Index a project and run its analysis with cancellation and failure recovery.
  async executeJob(project, job, signal) {
    const directory = this.path(project.id, `last_jobs/${job.id}`);

    try {
      const historyDirectory = await prepareJobHistory(this.path(project.id, '.'));
      await this.updateJob(job, {
        status: 'running',
        stage: 'indexing',
        message: 'Indexing directories and hashing source files…',
        startedAt: new Date().toISOString(),
      });
      await writeJson(resolve(directory, 'job.json'), job);
      await pruneJobHistory(historyDirectory, job.id);
      const index = await indexProject(project.root, project.name, signal);
      signal.throwIfAborted();
      await writeJson(resolve(directory, 'index.json'), index);
      const snapshot = await createSnapshot(
        project,
        index,
        directory,
        signal,
        ['nouns', 'areas', 'sequence', 'presentation'].includes(job.kind) ? job.feature || '' : '',
      );
      await this.updateJob(job, { coverage: snapshot.coverage });
      await this.runAnalysisStages(project, job, index, snapshot, directory, signal);

      await this.updateJob(job, {
        status: 'completed',
        stage: 'ready',
        message: 'Analysis is ready.',
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      const cancelled = signal.aborted;
      await this.updateJob(job, {
        status: cancelled ? 'cancelled' : 'failed',
        message: cancelled
          ? 'Analysis cancelled. Completed results are still available.'
          : error.message.slice(-2500),
        finishedAt: new Date().toISOString(),
      }).catch(
        // Preserve the original job failure if its status cannot be saved.
        () => {},
      );
    } finally {
      await writeJson(resolve(directory, 'job.json'), job).catch(
        // Report debug storage failures without replacing the analysis outcome.
        (error) => console.error('Could not save debugging job metadata:', error),
      );
    }
  }

  // Run requested stages in order and persist each successful result.
  async runAnalysisStages(project, job, index, snapshot, directory, signal) {
    const stages =
      {
        directories: ['directories'], flow: ['flow'], architecture: ['architecture'],
        areas: ['areas'], nouns: ['nouns'], sequence: ['sequence'], endpoints: ['endpoints'],
        presentation: ['presentation'],
      }[job.kind] ||
      ['directories', 'architecture'];
    let understanding = await readJson(
      this.path(project.id, 'understanding.json'),
      createEmptyUnderstanding(),
    );

    for (const stage of stages) {
      signal.throwIfAborted();
      await this.updateJob(job, {
        stage,
        message:
          job.modificationPrompt
            ? 'Modifying the selected analysis…'
            : stage === 'presentation'
              ? 'Creating slides and custom diagrams for your topic…'
              : stage === 'directories'
                ? 'Analyzing directory responsibilities…'
                : stage === 'architecture'
                  ? job.feature
                    ? 'Diagramming the requested architecture…'
                    : 'Building the system architecture…'
                  : stage === 'sequence'
                    ? 'Tracing interactions for the sequence diagram…'
                    : stage === 'areas'
                      ? 'Mapping responsibilities into nested areas…'
                      : stage === 'nouns'
                        ? 'Identifying nouns and their relationships…'
                        : stage === 'endpoints'
                          ? 'Finding servers and REST endpoints…'
                          : 'Tracing the requested code flow…',
      });
      let lastProgress = 0;
      const result = await analyzeStage({
        stage,
        project,
        index,
        snapshot,
        jobDirectory: directory,
        feature: job.feature,
        understanding,
        revision: savedAnalysisRevision(understanding, stage, job),
        signal,
        run: this.run,

        // Throttle progress writes and ignore messages after cancellation.
        onProgress: (message) => {
          if (Date.now() - lastProgress < 1500 || signal.aborted) return;
          lastProgress = Date.now();
          // Keep progress persistence failures from interrupting the analysis process.
          this.updateJob(job, { message }).catch(() => {});
        },
      });
      signal.throwIfAborted();
      const key = mergeStageResult(understanding, result, stage, job, index, snapshot);
      await writeJson(this.path(project.id, 'understanding.json'), understanding);
      if (job.kind !== 'initial')
        await this.updateJob(job, { resultId: key });
    }
  }

  // Cancel the running worker or mark a queued job cancelled.
  async cancel(id) {
    const project = await this.get(id);
    if (this.edits.has(id)) throw fail('A project change is being saved. Try again shortly.', 409);
    if (!isJobActive(project.job)) throw fail('There is no active analysis to cancel.', 409);
    if (this.running?.job.id === project.job.id) {
      this.running.controller.abort();
      await this.updateJob(project.job, { message: 'Stopping the analysis worker…' });
    } else
      await this.updateJob(project.job, {
        status: 'cancelled',
        message: 'Queued analysis cancelled.',
        finishedAt: new Date().toISOString(),
      });

    return structuredClone(project.job);
  }

  // Stop accepting work and wait for active jobs, edits, and writes.
  async close() {
    this.closed = true;
    if (this.running) {
      this.running.controller.abort();
      await this.running.promise;
    }

    await Promise.allSettled(this.edits.values());
    await this.writes;
  }
}

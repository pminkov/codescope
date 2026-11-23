import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { ProjectStore } from './storage.mjs';
import { readSource, fail } from './analysis.mjs';
import { codexStatus } from './runner.mjs';
import { createDirectoryPicker } from './native-dialog.mjs';
import { AskService } from './ask.mjs';

const assets = {
  '/': ['index.html', 'text/html'],
  '/app.js': ['app.js', 'text/javascript'],
  '/content.js': ['content.js', 'text/javascript'],
  '/job-progress.js': ['job-progress.js', 'text/javascript'],
  '/sequence-diagram.js': ['sequence-diagram.js', 'text/javascript'],
  '/graph-routing.js': ['graph-routing.js', 'text/javascript'],
  '/analysis-list.js': ['analysis-list.js', 'text/javascript'],
  '/code-scan.js': ['code-scan.js', 'text/javascript'],
  '/ask.js': ['ask.js', 'text/javascript'],
  '/dialog-stack.js': ['dialog-stack.js', 'text/javascript'],
  '/ui/icons.js': ['ui/icons.js', 'text/javascript'],
  '/ui/source-links.js': ['ui/source-links.js', 'text/javascript'],
  '/ui/source-preview.js': ['ui/source-preview.js', 'text/javascript'],
  '/ui/analysis-controls.js': ['ui/analysis-controls.js', 'text/javascript'],
  '/views/directories.js': ['views/directories.js', 'text/javascript'],
  '/views/flows.js': ['views/flows.js', 'text/javascript'],
  '/views/architecture.js': ['views/architecture.js', 'text/javascript'],
  '/views/nouns.js': ['views/nouns.js', 'text/javascript'],
  '/views/endpoints.js': ['views/endpoints.js', 'text/javascript'],
  '/views/sequences.js': ['views/sequences.js', 'text/javascript'],
  '/views/all-analyses.js': ['views/all-analyses.js', 'text/javascript'],
  '/views/job-progress.js': ['views/job-progress.js', 'text/javascript'],
  '/views/workspace.js': ['views/workspace.js', 'text/javascript'],
  '/styles.css': ['styles.css', 'text/css'],
};
const pageRoute = new RegExp(
  '^/(?:projects/[a-zA-Z0-9_-]+/)?' +
  '(?:flows|directories|architecture|nouns|sequences|endpoints|code-scan|all)(?:/|$)',
);

// Read a bounded JSON object from a mutation request.
async function readJsonBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json'))
    throw fail('Use application/json for this request.', 415);
  let body = '';

  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 65536) throw fail('Request body is too large.', 413);
  }

  try {
    const value = JSON.parse(body || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();

    return value;
  } catch {
    throw fail('Request body must be a JSON object.');
  }
}

// Reject unsupported hosts, origins, and methods before resolving the URL.
function validateRequest(request, response) {
  const origin = `http://${request.headers.host}`;
  const host = new URL(origin).hostname;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host))
    throw fail('Use the local CodeScope address.', 403);
  if (request.headers.origin && request.headers.origin !== origin)
    throw fail('Cross-origin requests are not allowed.', 403);
  if (!['GET', 'HEAD', 'POST'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD, POST');
    throw fail('Method not allowed.', 405);
  }

  const url = new URL(request.url, origin);

  return url;
}

// Open the native folder picker while the client connection remains active.
async function chooseProjectDirectory(request, response, chooseDirectory) {
  if (request.method !== 'POST') throw fail('Use POST to open the folder picker.', 405);
  await readJsonBody(request);
  const controller = new AbortController();

  // Dismiss the picker if the client disconnects before receiving its result.
  const abortDirectoryPicker = () => {
    if (!response.writableEnded) controller.abort();
  };

  response.once('close', abortDirectoryPicker);

  try {
    return await chooseDirectory({ signal: controller.signal });
  } finally {
    response.off('close', abortDirectoryPicker);
  }
}

// Handle project reads and mutations using their registered project ID.
async function handleProjectRequest(request, url, match, store, json) {
  const [, id, action] = match;
  if (action === 'rename') {
    if (request.method !== 'POST') throw fail('Use POST to rename a project.', 405);
    const body = await readJsonBody(request);

    return json(await store.renameProject(id, body.name));
  }

  if (action === 'delete') {
    if (request.method !== 'POST') throw fail('Use POST to delete a project.', 405);
    await readJsonBody(request);

    return json(await store.deleteProject(id));
  }

  if (['analysis', 'directories', 'flows', 'architecture', 'nouns', 'sequences', 'endpoints',
    'cancel'].includes(action)) {
    if (request.method !== 'POST') throw fail('Use POST for this action.', 405);
    const body = await readJsonBody(request);
    if (action === 'cancel') return json(await store.cancel(id));

    return json(
      await store.enqueue(
        id,
        action === 'sequences'
          ? 'sequence'
          : action === 'flows'
            ? 'flow'
            : ['architecture', 'nouns', 'endpoints', 'directories'].includes(action)
              ? action
              : 'initial',
        ['nouns', 'endpoints'].includes(action) ? body.scope
          : ['architecture', 'sequences'].includes(action) ? body.question : body.feature,
      ),
      202,
    );
  }

  if (request.method === 'POST') throw fail('Method not allowed.', 405);
  const view = await store.view(id);
  if (action === 'source')
    return json(await readSource(view.root, url.searchParams.get('path'), view.tree));

  return json(view);
}

// Create the local HTTP server with injectable storage and integrations.
export function createApp({
  store = new ProjectStore(),
  runnerStatus = codexStatus,
  chooseDirectory = createDirectoryPicker(),
} = {}) {
  const questions = new AskService(store);
  const server = createServer(
    // Dispatch local API requests and serve the browser assets.
    async (request, response) => {
      const headers = {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy':
          "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      };

      // Write a response while suppressing its body for HEAD requests.
      const send = (status, body, type = 'application/json') => {
        response.writeHead(status, { ...headers, 'Content-Type': `${type}; charset=utf-8` });
        response.end(request.method === 'HEAD' ? undefined : body);
      };

      // Serialize an API result with its response status.
      const json = (value, status = 200) => send(status, JSON.stringify(value));

      try {
        const url = validateRequest(request, response);
        if (url.pathname === '/api/choose-directory') {
          return json(await chooseProjectDirectory(request, response, chooseDirectory));
        }

        if (url.pathname === '/api/projects') {
          if (request.method === 'POST')
            return json(await store.add(await readJsonBody(request)), 202);
          return json({ projects: await store.list() });
        }

        if (url.pathname === '/api/runner') {
          if (request.method === 'POST') throw fail('Method not allowed.', 405);
          return json(await runnerStatus());
        }

        const ask = url.pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/ask$/);
        if (ask) {
          if (request.method !== 'POST') throw fail('Use POST to ask a question.', 405);

          return await questions.stream(ask[1], await readJsonBody(request), response, headers);
        }

        const jobPrompts = url.pathname.match(
          /^\/api\/projects\/([a-zA-Z0-9_-]+)\/jobs\/([a-zA-Z0-9_-]+)\/prompts$/,
        );
        if (jobPrompts) {
          if (request.method === 'POST') throw fail('Method not allowed.', 405);

          return json(await store.jobPrompts(...jobPrompts.slice(1)));
        }

        const analysisAction = url.pathname.match(
          new RegExp(
            '^/api/projects/([a-zA-Z0-9_-]+)/analyses/' +
            '(directories|architecture|flows|nouns|sequences|endpoints)/' +
            '([a-zA-Z0-9_-]+)/(rerun|modify|duplicate|delete)$',
          ),
        );
        if (analysisAction) {
          if (request.method !== 'POST') throw fail('Use POST for analysis actions.', 405);
          const body = await readJsonBody(request);

          return json(await store.changeAnalysis(...analysisAction.slice(1), body.prompt),
            ['rerun', 'modify'].includes(analysisAction[4]) ? 202 : 200);
        }

        // Delete individual nodes in a diagram.
        const nodeDeletion = url.pathname.match(
          /^\/api\/projects\/([a-zA-Z0-9_-]+)\/architecture\/([a-zA-Z0-9_-]+)\/nodes\/([a-zA-Z0-9_-]+)\/delete$/,
        );
        if (nodeDeletion) {
          if (request.method !== 'POST') throw fail('Use POST to delete a diagram node.', 405);
          await readJsonBody(request);

          return json(await store.deleteArchitectureNode(...nodeDeletion.slice(1)));
        }

        const match = url.pathname.match(
          new RegExp(
            '^/api/projects/([a-zA-Z0-9_-]+)(?:/' +
            '(source|analysis|directories|flows|architecture|nouns|sequences|endpoints|' +
            'cancel|delete|rename))?$',
          ),
        );
        if (match) {
          if (match[2] === 'delete' && request.method === 'POST')
            questions.active.get(match[1])?.abort();
          // Await inside this handler so rejected route operations reach the JSON error response.
          return await handleProjectRequest(request, url, match, store, json);
        }

        if (request.method === 'POST') throw fail('Not found.', 404);
        const asset = pageRoute.test(url.pathname) ? assets['/'] : assets[url.pathname];
        if (!asset) throw fail('Not found.', 404);
        send(200, await readFile(new URL(`../public/${asset[0]}`, import.meta.url)), asset[1]);
      } catch (error) {
        if (response.destroyed) return;
        if (!error.status) console.error('CodeScope request failed:', error.message);
        if (response.headersSent) return response.end();
        json(
          {
            error: error.status
              ? error.message
              : 'Could not load project data. Check the server terminal and try again.',
          },
          error.status || 500,
        );
      }
    },
  );
  server.projectStore = store;
  server.questions = questions;
  // Cancel question workers when the HTTP listener finishes closing.
  server.once('close', () => questions.close());

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 4310);
  const server = createApp();
  // Report startup failures without leaving a successful exit status.
  server.on('error', (error) => {
    console.error(`CodeScope could not start: ${error.message}`);
    process.exitCode = 1;
  });
  // Print the local URL once the server starts listening.
  server.listen(port, '127.0.0.1', () =>
    console.log(`CodeScope: http://127.0.0.1:${server.address().port}`),
  );

  // Close the listener and worker before exiting on a termination signal.
  const shutdownServer = async () => {
    server.questions.close();
    server.close();
    await server.projectStore.close();
    process.exit(0);
  };

  process.once('SIGINT', shutdownServer);
  process.once('SIGTERM', shutdownServer);
}

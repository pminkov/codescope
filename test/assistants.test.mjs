import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Exercise real subprocess dispatch and preference persistence with local CLI stand-ins.
test('assistant selection follows readiness and persists an explicit choice', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codescope-assistants-'));
  // Remove only this test's isolated executables and saved settings.
  context.after(() => rm(root, { recursive: true, force: true }));
  const codex = join(root, 'codex');
  const claude = join(root, 'claude');
  process.env.CODESCOPE_CODEX_BIN = codex;
  process.env.CODESCOPE_CLAUDE_BIN = claude;
  const { ProjectStore } = await import('../src/storage.mjs');
  const store = new ProjectStore({ dataDirectory: root });
  await store.initializing;
  const missing = await store.assistantStatus();
  assert.deepEqual(missing.ready, []);
  assert.deepEqual(missing.checks, [
    { id: 'codex', command: [codex, 'login', 'status'], ready: false,
      result: 'Executable not found.' },
    { id: 'claude', command: [claude, 'auth', 'status', '--json'], ready: false,
      result: 'Executable not found.' },
  ]);

  await writeFile(claude, `#!/bin/sh
if [ "$1" = auth ]; then
  echo '{"loggedIn":true}'
else
  cat >/dev/null
  echo '{"type":"result","structured_output":{"answer":"ok"}}'
fi
`, { mode: 0o700 });
  assert.equal((await store.assistantStatus()).selected, 'claude');
  const run = await store.resolveAssistantRunner();
  const schemaPath = join(root, 'schema.json');
  await writeFile(schemaPath, '{}');
  assert.deepEqual(await run({ root, schemaPath, prompt: 'test' }), { answer: 'ok' });

  await writeFile(codex, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  assert.equal((await store.assistantStatus()).selected, null);
  await assert.rejects(store.resolveAssistantRunner(), /Choose an AI assistant/);
  await store.selectAssistant('claude');
  const reopened = new ProjectStore({ dataDirectory: root });
  await reopened.initializing;
  assert.equal((await reopened.assistantStatus()).selected, 'claude');
  await rm(claude);
  assert.equal((await reopened.assistantStatus()).selected, 'codex');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDirectoryPicker } from '../src/native-dialog.mjs';

// Unit tests inject execution so the automated suite never opens an OS dialog.
// Verify canonical folder selection uses a fixed, folder-only native script.
test('native picker returns the canonical directory and uses a fixed folder-only script', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "codescope folder's "));
  // Remove the temporary folder after the picker test.
  context.after(() => rm(directory, { recursive: true, force: true }));
  const controller = new AbortController();
  const picker = createDirectoryPicker({
    platform: 'darwin',

    // Inspect native command arguments and simulate the selected folder.
    run: async (binary, args, options) => {
      assert.equal(binary, '/usr/bin/osascript');
      assert.equal(args[0], '-e');
      assert.match(args[1], /choose folder/);
      assert.ok(!args[1].includes(directory));
      assert.equal(options.signal, controller.signal);

      return { stdout: `${directory}/\n` };
    },
  });
  assert.deepEqual(await picker({ signal: controller.signal }), {
    cancelled: false,
    path: await realpath(directory),
  });
});

// Verify cancellation succeeds and concurrent dialogs are rejected.
test('cancelling a native dialog is successful and only one picker opens at a time', async () => {
  let complete;
  const picker = createDirectoryPicker({
    platform: 'darwin',

    // Hold native execution open until the test supplies its result.
    run: () =>
      new Promise(
        // Expose the pending execution resolver to the test.
        (resolve) => {
          complete = resolve;
        },
      ),
  });
  const pending = picker();
  await assert.rejects(picker(), { status: 409 });
  complete({ stdout: '\n' });
  assert.deepEqual(await pending, { cancelled: true, path: null });
  const next = picker();
  complete({ stdout: '' });
  assert.deepEqual(await next, { cancelled: true, path: null });
});

// Verify unsupported platforms, picker failures, and aborts preserve fallback behavior.
test('unsupported systems and unavailable native dialogs preserve a manual-path fallback', async () => {
  const unsupported = createDirectoryPicker({
    platform: 'linux',

    // Fail the test if an unsupported platform attempts native execution.
    run: () => {
      throw new Error('must not run');
    },
  });
  await assert.rejects(unsupported(), { status: 501 });
  const failed = createDirectoryPicker({
    platform: 'darwin',

    // Simulate a missing native dialog service.
    run: async () => {
      throw new Error('No window server');
    },
  });
  await assert.rejects(failed(), { status: 503 });
  await assert.rejects(failed(), { status: 503 });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(failed({ signal: controller.signal }), { name: 'AbortError' });
});

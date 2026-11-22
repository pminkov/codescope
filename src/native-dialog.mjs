import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fail, validateRoot } from './analysis.mjs';

const execute = promisify(execFile);
const chooseFolderScript = `
activate
try
  set projectFolder to choose folder with prompt "Choose a project folder for CodeScope"
  return POSIX path of projectFolder
on error messageText number errorNumber
  if errorNumber is -128 then return ""
  error messageText number errorNumber
end try
`;

// Create a macOS folder picker that permits only one open dialog.
export function createDirectoryPicker({ platform = process.platform, run = execute } = {}) {
  let choosing = false;
  // Choose and canonicalize a folder, preserving cancellation and fallback errors.
  return async ({ signal } = {}) => {
    if (platform !== 'darwin')
      throw fail(
        'The native folder picker requires macOS. You can paste a directory path instead.',
        501,
      );
    if (choosing)
      throw fail(
        'A folder picker is already open. Choose a folder or cancel that dialog first.',
        409,
      );
    signal?.throwIfAborted();
    choosing = true;

    try {
      const { stdout } = await run('/usr/bin/osascript', ['-e', chooseFolderScript], {
        signal,
        maxBuffer: 65536,
      });
      const path = stdout.trim();
      if (!path) return { cancelled: true, path: null };

      return { cancelled: false, path: await validateRoot(path) };
    } catch (error) {
      if (signal?.aborted || error.status) throw error;
      throw fail(
        'Could not open the macOS folder picker. You can still paste a directory path.',
        503,
      );
    } finally {
      choosing = false;
    }
  };
}

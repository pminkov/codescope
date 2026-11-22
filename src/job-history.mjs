import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const retainedJobCount = 3;
const historyReadme = `# Recent jobs for debugging

This directory is for debugging purposes only. It contains the last three
jobs started for this project, including the current job while it runs.
Completed, failed, cancelled, and interrupted jobs all count toward this limit.

Each job keeps all of its working files, including its filtered source snapshot,
index, output schemas, prompts, and any returned stage results. job.json records
the job's status and original request. Files available before a failure or
interruption are preserved. Older index-only jobs have no snapshot or stages.

When another job starts, older job directories are removed in their entirety.
Saved diagrams and flows live in the project's understanding.json, outside this
debugging history, and are unaffected by this retention limit.

Jobs are ordered by the startedAt timestamp recorded in job.json.
`;

// Create the job history directory and describe its retention policy.
export async function prepareJobHistory(projectDirectory) {
  const directory = resolve(projectDirectory, 'last_jobs');
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'README.md'), historyReadme, { mode: 0o600 });

  return directory;
}

// Keep the current job and the newest remaining jobs, deleting only whole directories.
export async function pruneJobHistory(directory, currentJobId) {
  const jobs = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = resolve(directory, entry.name);
    const job = JSON.parse(await readFile(resolve(path, 'job.json'), 'utf8'));
    const startedAt = Date.parse(job.startedAt);
    if (!Number.isFinite(startedAt))
      throw new Error(`Job history record has an invalid start time: ${entry.name}.`);
    jobs.push({ id: entry.name, path, startedAt });
  }

  jobs.sort(
    // Always protect the latest registered job, including timestamp ties.
    (a, b) =>
      Number(b.id === currentJobId) - Number(a.id === currentJobId) ||
      b.startedAt - a.startedAt ||
      a.id.localeCompare(b.id),
  );

  for (const job of jobs.slice(retainedJobCount))
    await rm(job.path, { recursive: true, force: true });
}

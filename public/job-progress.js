// Locate only the saved results produced by the current completed job.
export function getCompletedJobTargets(project) {
  const job = project?.job;
  if (job?.status !== 'completed') return [];
  const targets = [];
  if (['initial', 'directories'].includes(job.kind) && project.hasDirectoryAnalysis)
    targets.push({ tab: 'directories', selection: '', label: 'Open directories' });

  const kinds = {
    initial: ['architectures', 'architecture'],
    architecture: ['architectures', 'architecture'],
    flow: ['flows', 'flows'],
    nouns: ['nounAnalyses', 'nouns'],
    sequence: ['sequences', 'sequences'],
  };
  const target = kinds[job.kind];
  if (!target) return targets;
  const [collection, tab] = target;
  const id = job.kind === 'initial' ? 'overview' : job.resultId || job.analysisId;
  const exists = id && project[collection]?.some(
    // Deleted results must not link to an unrelated default selection.
    (analysis) => analysis.id === id,
  );
  if (exists) targets.push({
    tab, selection: id, label: job.kind === 'initial' ? 'Open architecture' : 'Open analysis',
  });

  return targets;
}

// Allow dismissal only after a real analysis job has reached a terminal state.
function canDismissJob(job) {
  return Boolean(job?.id && job.kind !== 'index' &&
    ['completed', 'failed', 'cancelled', 'interrupted'].includes(job.status));
}

// Keep finished progress visible for five minutes after execution ends.
export function getJobDismissalDelay(job, now = Date.now()) {
  if (!canDismissJob(job)) return null;
  const finished = Date.parse(job.finishedAt);

  return Number.isFinite(finished) ? Math.max(0, finished + 5 * 60 * 1000 - now) : null;
}

// Remember each project's dismissed job across reloads, with an in-memory fallback.
export function createJobDismissals(storageHost = globalThis) {
  const dismissed = new Map();

  return {
    // Hide expired progress on reload while keeping active and recent jobs visible.
    isDismissed(projectId, job, now = Date.now()) {
      if (!canDismissJob(job)) return false;
      if (getJobDismissalDelay(job, now) === 0) return true;
      if (!dismissed.has(projectId)) {
        let jobId = null;
        try {
          jobId = storageHost.localStorage?.getItem(`codescope-dismissed-job:${projectId}`);
        } catch {
          // Blocked browser storage must not prevent progress from rendering.
        }
        dismissed.set(projectId, jobId);
      }

      return dismissed.get(projectId) === job.id;
    },

    // Hide only the selected terminal job, retaining its saved result and history.
    dismiss(projectId, job) {
      if (!canDismissJob(job)) return false;
      dismissed.set(projectId, job.id);
      try {
        storageHost.localStorage?.setItem(`codescope-dismissed-job:${projectId}`, job.id);
      } catch {
        // Continue remembering the dismissal for this page when storage is blocked.
      }

      return true;
    },
  };
}

// Format elapsed execution time without resetting it on navigation or browser reload.
export function formatJobElapsed(job, now = Date.now()) {
  const start = Date.parse(job?.startedAt);
  const end = ['queued', 'running'].includes(job?.status) ? now
    : Date.parse(job?.finishedAt);
  const seconds = Number.isFinite(start) && Number.isFinite(end)
    ? Math.max(0, Math.floor((end - start) / 1000)) : 0;

  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

// Present the latest four structured progress messages without changing saved history.
export function getJobMessages(job) {
  return job ? job.messages.slice(-4) : [];
}

// Show each message's recorded local clock time with hours, minutes, and seconds.
export function formatJobMessageTime(timestamp) {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return '--:--:--';

  return new Date(timestamp).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
}

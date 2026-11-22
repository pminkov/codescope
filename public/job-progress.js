// Allow dismissal only after a real analysis job has reached a terminal state.
function canDismissJob(job) {
  return Boolean(job?.id && job.kind !== 'index' &&
    ['completed', 'failed', 'cancelled', 'interrupted'].includes(job.status));
}

// Remember each project's dismissed job across reloads, with an in-memory fallback.
export function createJobDismissals(storageHost = globalThis) {
  const dismissed = new Map();

  return {
    // Keep running jobs and new job IDs visible regardless of earlier dismissals.
    isDismissed(projectId, job) {
      if (!canDismissJob(job)) return false;
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
    : Date.parse(job?.finishedAt || job?.updatedAt);
  const seconds = Number.isFinite(start) && Number.isFinite(end)
    ? Math.max(0, Math.floor((end - start) / 1000)) : 0;

  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

// Present a bounded history while retaining progress from older server versions.
export function getJobMessages(job) {
  const messages = Array.isArray(job?.messages) ? job.messages.flatMap(
    // Normalize text-only history and validate recorded times before presenting them.
    (entry) => {
      const message = typeof entry === 'string' ? entry : entry?.message;
      if (typeof message !== 'string' || !message.trim()) return [];
      const timestamp = typeof entry?.timestamp === 'string' &&
        Number.isFinite(Date.parse(entry.timestamp)) ? entry.timestamp : null;

      return [{ message, timestamp }];
    },
  ) : [];
  if (job?.message && messages.at(-1)?.message !== job.message)
    messages.push({ message: job.message, timestamp: null });

  return messages.slice(-4);
}

// Show each message's recorded local clock time with hours, minutes, and seconds.
export function formatJobMessageTime(timestamp) {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return '--:--:--';

  return new Date(timestamp).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
}

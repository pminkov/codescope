// Combine saved results using their last successful analysis time, never creation time.
export function getAnalysisEntries(project) {
  const entries = [];
  if (project.hasDirectoryAnalysis) {
    entries.push({
      tab: 'directories', id: '', label: 'Directories', icon: 'folder',
      title: 'Directory analysis', description: project.description,
      analyzedAt: project.directoryReview?.reviewedAt,
    });
  }

  const endpoints = project.endpointAnalyses?.at(-1);
  if (endpoints) entries.push({
    tab: 'endpoints', id: '', label: 'Endpoints', icon: 'endpoints',
    title: endpoints.title, description: endpoints.description,
    analyzedAt: endpoints.review?.reviewedAt,
  });

  for (const [collection, tab, label, icon] of [
    ['architectures', 'architecture', 'Architecture', 'architecture'],
    ['flows', 'flows', 'Code flow', 'flow'],
    ['nounAnalyses', 'nouns', 'Nouns', 'nouns'],
    ['sequences', 'sequences', 'Sequence diagram', 'sequences'],
    ['presentations', 'presentations', 'Presentation', 'presentation'],
  ]) {
    for (const analysis of project[collection] || []) {
      entries.push({
        tab, id: analysis.id, label, icon,
        title: analysis.title, description: analysis.description,
        analyzedAt: analysis.review?.reviewedAt,
      });
    }
  }

  // Keep undated legacy results visible after results with a known analysis time.
  for (const entry of entries) {
    const timestamp = Date.parse(entry.analyzedAt);
    entry.timestamp = Number.isFinite(timestamp) ? timestamp : -Infinity;
    if (!Number.isFinite(timestamp)) entry.analyzedAt = null;
  }

  // Preserve collection order when results share an analysis timestamp.
  return entries.sort((left, right) => (right.timestamp - left.timestamp) || 0);
}

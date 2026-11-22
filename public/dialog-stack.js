// Track opening order independently of DOM position, keyboard focus, and dialog type.
export function createDialogStack() {
  let entries = [];
  const listeners = new Set();

  // Update clients after a layer enters or leaves the opening-order stack.
  function notifyChange() {
    for (const listener of listeners) listener();
  }

  return {
    // Register an opening, promoting a previously closed or suspended layer when reopened.
    register(element, close, isOpen, kind = 'dialog') {
      entries = entries.filter(
        // One layer can occupy only one position in the stack.
        (entry) => entry.element !== element,
      );
      entries.push({ element, close, isOpen, kind });
      notifyChange();
    },

    // Remove only the layer that closed, preserving every other layer's order.
    remove(element) {
      const remaining = entries.filter(
        // Dismissing an older layer must not disturb newer layers.
        (entry) => entry.element !== element,
      );
      if (remaining.length === entries.length) return;
      entries = remaining;
      notifyChange();
    },

    // Find the actual most recently opened native dialog for top-layer attachment.
    latestDialog() {
      return entries.findLast(
        // A suspended chat is still open but is not a native modal host.
        (entry) => entry.kind === 'dialog' && entry.isOpen(),
      )?.element;
    },

    // Close exactly one active layer, ignoring stale entries from asynchronous close events.
    dismissLatest() {
      const entry = entries.findLast(
        // Already-closed elements must not consume another Escape press.
        (candidate) => candidate.isOpen(),
      );
      if (!entry) return false;
      entry.close();
      if (entries.includes(entry)) this.remove(entry.element);

      return true;
    },

    // Notify layout clients without treating their DOM movements as new openings.
    subscribe(listener) {
      listeners.add(listener);
    },
  };
}

// Share one Escape policy between native dialogs and explicitly registered floating panels.
export function setupDialogStack(root = document) {
  const stack = createDialogStack();

  // Record a native modal only when it opens, never when focus or its content changes.
  function registerDialog(dialog) {
    stack.register(dialog,
      // Native close keeps existing confirmation and focus-restoration handlers intact.
      () => dialog.close(),
      // Native close events are queued, so check current state before dismissing a layer.
      () => dialog.open && dialog.isConnected);
  }

  // Follow attribute mutations in occurrence order instead of document query order.
  function recordDialogChanges(records) {
    for (const record of records) {
      const dialog = record.target;
      if (dialog.tagName !== 'DIALOG') continue;
      if (!dialog.open) stack.remove(dialog);
      else if (record.oldValue === null) registerDialog(dialog);
    }
  }

  const observer = new MutationObserver(recordDialogChanges);
  observer.observe(root.body, { attributes: true, attributeFilter: ['open'],
    attributeOldValue: true, subtree: true });
  for (const dialog of root.querySelectorAll('dialog[open]')) registerDialog(dialog);

  // Block the browser's second dismissal and ignore key repeats while Escape is held.
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.isComposing) return;
    recordDialogChanges(observer.takeRecords());
    if (event.repeat) {
      event.preventDefault();
      event.stopPropagation();

      return;
    }
    if (!stack.dismissLatest()) return;
    event.preventDefault();
    event.stopPropagation();
  }, { capture: true });

  // Apply the same ordering to browser close requests that arrive without a keydown.
  root.addEventListener('cancel', (event) => {
    if (event.target.tagName !== 'DIALOG') return;
    recordDialogChanges(observer.takeRecords());
    if (!stack.dismissLatest()) return;
    event.preventDefault();
    event.stopPropagation();
  }, { capture: true });

  return stack;
}

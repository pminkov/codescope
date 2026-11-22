import test from 'node:test';
import assert from 'node:assert/strict';
import { createDialogStack } from '../public/dialog-stack.js';

// Register a controllable native dialog or floating panel for opening-order checks.
function openTestLayer(stack, name, closed, kind = 'dialog') {
  const layer = { name, open: true };
  // Track an explicit opening with the same lifecycle as an Ask panel or native modal.
  const register = () => stack.register(layer,
    // Record which window Escape actually dismissed.
    () => { closed.push(name); layer.open = false; },
    // Simulate native dialogs which may close before their close event is delivered.
    () => layer.open, kind);
  register();

  return { layer, register };
}

// Neither DOM order nor a special case for chat may override the actual opening order.
test('Escape dismisses sequence details and Ask in reverse opening order', () => {
  for (const order of [['ask', 'sequence'], ['sequence', 'ask']]) {
    const stack = createDialogStack();
    const closed = [];
    for (const name of order) openTestLayer(stack, name, closed, name === 'ask' ? 'panel' : 'dialog');
    assert.equal(stack.dismissLatest(), true);
    assert.deepEqual(closed, [order[1]]);
    assert.equal(stack.dismissLatest(), true);
    assert.deepEqual(closed, [...order].reverse());
    assert.equal(stack.dismissLatest(), false);
  }
});

// Source previews form another stack layer while a suspended Ask remains in its old slot.
test('nested source previews close before sequence details and a suspended chat', () => {
  const stack = createDialogStack();
  const closed = [];
  openTestLayer(stack, 'ask', closed, 'panel');
  const sequence = openTestLayer(stack, 'sequence', closed);
  const source = openTestLayer(stack, 'source', closed);
  assert.equal(stack.latestDialog(), source.layer);
  stack.dismissLatest();
  assert.deepEqual(closed, ['source']);
  assert.equal(stack.latestDialog(), sequence.layer);
  stack.dismissLatest();
  assert.deepEqual(closed, ['source', 'sequence']);
  assert.equal(stack.latestDialog(), undefined);
  stack.dismissLatest();
  assert.deepEqual(closed, ['source', 'sequence', 'ask']);
});

// Reopening a dialog creates a new opening, independent of its element's DOM position.
test('reopening and closing layers out of order keeps the remaining stack correct', () => {
  const stack = createDialogStack();
  const closed = [];
  const source = openTestLayer(stack, 'source', closed);
  const sequence = openTestLayer(stack, 'sequence', closed);
  openTestLayer(stack, 'ask', closed, 'panel');
  stack.remove(source.layer);
  source.register();
  assert.equal(stack.latestDialog(), source.layer);
  stack.dismissLatest();
  assert.deepEqual(closed, ['source']);
  stack.remove(sequence.layer);
  stack.dismissLatest();
  assert.deepEqual(closed, ['source', 'ask']);
  assert.equal(stack.dismissLatest(), false);
});

// Queued native close events must not consume Escape or close a second layer.
test('closed entries are skipped and self-removing close handlers dismiss only once', () => {
  const stack = createDialogStack();
  const closed = [];
  openTestLayer(stack, 'ask', closed, 'panel');
  const source = openTestLayer(stack, 'source', closed);
  source.layer.open = false;
  stack.dismissLatest();
  assert.deepEqual(closed, ['ask']);
  assert.equal(stack.dismissLatest(), false);
  const panel = {};
  stack.register(panel,
    // The real Ask close handler unregisters itself and must not trigger another dismissal.
    () => { closed.push('panel'); stack.remove(panel); },
    // Keep this entry active until its close handler unregisters it.
    () => true, 'panel');
  stack.dismissLatest();
  assert.deepEqual(closed, ['ask', 'panel']);
  assert.equal(stack.dismissLatest(), false);
});

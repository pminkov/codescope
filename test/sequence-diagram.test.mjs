import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSequenceDiagram, setupSequencePan, setupSequenceZoom } from '../public/sequence-diagram.js';

// Simulate a scrollable canvas while retaining native event cancellation behavior.
function createPanViewport() {
  const viewport = new EventTarget();
  const classes = new Set();
  const captures = new Set();
  Object.assign(viewport, {
    scrollLeft: 100, scrollTop: 200,
    clientLeft: 2, clientTop: 2, clientWidth: 300, clientHeight: 200,
    classList: {
      // Track the dragging cursor state.
      add(name) { classes.add(name); },

      // Restore the normal cursor after release.
      remove(name) { classes.delete(name); },

      // Expose observable class state for assertions.
      contains(name) { return classes.has(name); },
    },

    // Treat the fixture itself as noninteractive background space.
    closest() { return null; },

    // Include a border and a scrollbar area outside the client dimensions.
    getBoundingClientRect() { return { left: 10, top: 20, width: 320, height: 220 }; },

    // Record keyboard focus without changing scroll offsets.
    focus() { viewport.focused = true; },

    // Keep drags active after the pointer leaves the diagram.
    setPointerCapture(id) { captures.add(id); },

    // Test whether disposal or release must end capture.
    hasPointerCapture(id) { return captures.has(id); },

    // Release capture once the gesture ends.
    releasePointerCapture(id) { captures.delete(id); },
  });

  return viewport;
}

// Dispatch a cancellable mouse gesture or click with an optional interactive target.
function dispatchPanEvent(viewport, type, { target = viewport, ...properties } = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerId: 1, pointerType: 'mouse', button: 0,
    clientX: 150, clientY: 150, ...properties });
  Object.defineProperty(event, 'target', { value: target });
  viewport.dispatchEvent(event);

  return event;
}

// Mouse motion moves the canvas in both directions without accidental activation.
test('sequence background dragging pans in screen pixels and suppresses its click', () => {
  const viewport = createPanViewport();
  const dispose = setupSequencePan(viewport);
  assert.equal(dispatchPanEvent(viewport, 'pointerdown').defaultPrevented, true);
  assert.equal(viewport.focused, true);
  assert.equal(viewport.hasPointerCapture(1), true);
  assert.equal(viewport.classList.contains('is-panning'), true);
  dispatchPanEvent(viewport, 'pointermove', { clientX: 148, clientY: 149 });
  assert.deepEqual([viewport.scrollLeft, viewport.scrollTop], [100, 200]);
  dispatchPanEvent(viewport, 'pointermove', { clientX: 110, clientY: 90, pointerId: 2 });
  assert.deepEqual([viewport.scrollLeft, viewport.scrollTop], [100, 200]);
  dispatchPanEvent(viewport, 'pointermove', { clientX: 110, clientY: 90 });
  assert.deepEqual([viewport.scrollLeft, viewport.scrollTop], [140, 260]);
  dispatchPanEvent(viewport, 'pointermove', { clientX: 180, clientY: 170 });
  assert.deepEqual([viewport.scrollLeft, viewport.scrollTop], [70, 180]);
  dispatchPanEvent(viewport, 'pointerup');
  assert.equal(viewport.hasPointerCapture(1), false);
  assert.equal(viewport.classList.contains('is-panning'), false);
  assert.equal(dispatchPanEvent(viewport, 'click').defaultPrevented, true);
  assert.equal(dispatchPanEvent(viewport, 'click').defaultPrevented, false);
  dispose();
});

// Preserve participant/message activation, touch scrolling, and native scrollbars.
test('sequence panning ignores interactive targets, touch, other buttons, and scrollbars', () => {
  const viewport = createPanViewport();
  const dispose = setupSequencePan(viewport);
  const link = {
    // Represent either an SVG participant link or a message hit target.
    closest() { return link; },
  };
  for (const properties of [{ target: link }, { pointerType: 'touch' }, { button: 1 },
    { button: 2 }, { clientX: 315 }, { clientY: 225 }]) {
    assert.equal(dispatchPanEvent(viewport, 'pointerdown', properties).defaultPrevented, false);
    assert.equal(viewport.hasPointerCapture(1), false);
    dispatchPanEvent(viewport, 'pointermove', { clientX: 100, clientY: 100 });
    assert.deepEqual([viewport.scrollLeft, viewport.scrollTop], [100, 200]);
  }
  dispatchPanEvent(viewport, 'pointerdown');
  dispatchPanEvent(viewport, 'pointerup');
  assert.equal(dispatchPanEvent(viewport, 'click').defaultPrevented, false);
  dispose();
});

// Navigation and interrupted gestures must never leave the canvas captured.
test('sequence panning releases cancelled gestures and removes handlers on disposal', () => {
  for (const ending of ['pointercancel', 'lostpointercapture', 'dispose']) {
    const viewport = createPanViewport();
    const dispose = setupSequencePan(viewport);
    dispatchPanEvent(viewport, 'pointerdown');
    dispatchPanEvent(viewport, 'pointermove', { clientX: 100, clientY: 100 });
    if (ending === 'dispose') dispose();
    else dispatchPanEvent(viewport, ending);
    assert.equal(viewport.hasPointerCapture(1), false);
    assert.equal(viewport.classList.contains('is-panning'), false);
    assert.equal(dispatchPanEvent(viewport, 'click').defaultPrevented, false);
    dispatchPanEvent(viewport, 'pointermove', { clientX: 50, clientY: 50 });
    assert.deepEqual([viewport.scrollLeft, viewport.scrollTop], [150, 250]);
    dispose();
    assert.equal(dispatchPanEvent(viewport, 'pointerdown').defaultPrevented, false);
  }
});

// Keep the foreground header pinned in screen space through scroll and zoom changes.
test('sequence participant headers stay pinned through scrolling, zoom, and fit', (context) => {
  const originalObserver = globalThis.ResizeObserver;
  // Restore the host environment after the synchronous viewport test.
  context.after(() => {
    if (originalObserver) globalThis.ResizeObserver = originalObserver;
    else delete globalThis.ResizeObserver;
  });
  // Stand in for browser resize observation while zoom is driven explicitly.
  globalThis.ResizeObserver = class {
    // Accept the observed canvas without scheduling browser layout work.
    observe() {}

    // Allow diagram disposal to release observation.
    disconnect() {}
  };
  const viewport = createPanViewport();
  const headerAttributes = new Map();
  const headers = {
    // Record the transform used to keep the participant row visible.
    setAttribute(name, value) { headerAttributes.set(name, value); },
  };
  const svg = {
    viewBox: { baseVal: { width: 1000, height: 2000 } },

    // Keep the SVG canvas resizable without needing a DOM renderer.
    setAttribute() {},

    // Expose the foreground participant layer to zoom setup.
    querySelector() { return headers; },
  };
  // Locate the diagram within the simulated scroll region.
  viewport.querySelector = () => svg;
  const controls = new EventTarget();
  const elements = {
    '.sequence-scroll': viewport, '.sequence-zoom-controls': controls,
    '.sequence-zoom-level': {}, '[data-sequence-zoom="out"]': {},
    '[data-sequence-zoom="in"]': {}, '[data-sequence-zoom="fit"]': {
      // Accept the fit button's pressed state.
      setAttribute() {},
    },
  };
  const figure = {
    // Provide the diagram and controls owned by this figure.
    querySelector(selector) { return elements[selector]; },
  };
  const dispose = setupSequenceZoom(figure, { mode: 'manual', scale: 1 });
  assert.equal(headerAttributes.get('transform'), 'translate(0 200)');
  viewport.scrollTop = 400;
  viewport.dispatchEvent(new Event('scroll'));
  assert.equal(headerAttributes.get('transform'), 'translate(0 400)');

  for (const action of ['in', 'fit']) {
    dispatchPanEvent(controls, 'click', { target: {
      // Select a zoom control using the same delegated action as the browser.
      closest() { return { dataset: { sequenceZoom: action } }; },
    } });
    assert.equal(headerAttributes.get('transform'), 'translate(0 400)');
    assert.equal(elements['.sequence-zoom-level'].textContent, action === 'in' ? '125%' : '30%');
  }
  assert.equal(viewport.scrollLeft, 0);
  dispose();
  viewport.scrollTop = 600;
  viewport.dispatchEvent(new Event('scroll'));
  assert.equal(headerAttributes.get('transform'), 'translate(0 400)');
});

// Build a diagram covering forward, reverse, asynchronous, and self interactions.
function createSequenceFixture() {
  return {
    title: 'Run <analysis>',
    participants: [
      { id: 'browser', name: 'Browser', description: 'Starts the action.' },
      { id: 'worker', name: 'Analysis worker', description: 'Runs the job.' },
    ],
    messages: [
      { from: 'browser', to: 'worker', label: 'Start job', description: 'Queue the job.', kind: 'call', condition: null, inferred: false },
      { from: 'worker', to: 'browser', label: 'Job accepted', description: 'Return status.', kind: 'return', condition: null, inferred: false },
      { from: 'worker', to: 'worker', label: 'Read snapshot', description: 'Inspect source.', kind: 'call', condition: 'While running', inferred: false },
      { from: 'worker', to: 'browser', label: 'Notify', description: 'Inferred delivery.', kind: 'event', condition: null, inferred: true },
    ],
  };
}

// Check geometric paths and numbering for every supported message direction.
test('sequence renderer draws ordered arrows, replies, events, conditions, and self calls', () => {
  const svg = renderSequenceDiagram(createSequenceFixture());
  assert.match(svg, /class="sequence-participant"/);
  assert.match(svg, /1\. Start job/);
  assert.match(svg, /2\. Job accepted/);
  assert.match(svg, /sequence-return/);
  assert.match(svg, /sequence-event sequence-inferred/);
  assert.match(svg, /marker-end="url\(#sequence-arrow-event\)"/);
  assert.match(svg, /\[While running\]/);
  assert.match(svg, /h 170 v 28 h -170/);
  assert.equal((svg.match(/data-sequence-message=/g) || []).length, 4);
  assert.equal((svg.match(/<line x1=/g) || []).length, 2);
  assert.doesNotMatch(svg, /NaN|undefined/);
  assert.equal(renderSequenceDiagram({ participants: [], messages: [] }), '');
});

// Compact headers must cover passing messages and still accommodate wrapped names.
test('sequence headers are compact, foregrounded, and grow for multiline names', () => {
  const diagram = createSequenceFixture();
  const svg = renderSequenceDiagram(diagram);
  const headers = svg.slice(svg.indexOf('<g class="sequence-participant-headers"'));
  assert.equal((headers.match(/height="36"/g) || []).length, 2);
  assert.match(headers, /sequence-header-background" width="560" height="52"/);
  assert.ok(svg.indexOf('sequence-participant-headers') > svg.lastIndexOf('data-sequence-message='));
  assert.equal((svg.match(/data-sequence-participant=/g) || []).length, 2);

  diagram.participants[0].name = 'A'.repeat(60);
  const wrapped = renderSequenceDiagram(diagram);
  assert.equal((wrapped.match(/height="70"/g) || []).length, 2);
  assert.match(wrapped, /sequence-header-background" width="560" height="86"/);
  assert.doesNotMatch(wrapped, /NaN|undefined/);
});

// Keep model-provided text escaped and reserve enough height for long labels.
test('sequence renderer escapes untrusted text and wraps long labels without clipping rows', () => {
  const diagram = createSequenceFixture();
  const short = renderSequenceDiagram(diagram);
  diagram.participants[0].name = '<img src=x onerror=alert(1)>';
  diagram.messages[0].label = '<script>alert("x")</script>';
  diagram.messages[0].description = '"><script>alert(1)</script>';
  diagram.messages[2].label = 'a'.repeat(120);
  diagram.messages[2].condition = 'b'.repeat(160);
  const svg = renderSequenceDiagram(diagram);
  assert.doesNotMatch(svg, /<script|<img|aria-label="[^"]*"x"/);
  assert.match(svg, /&lt;script&gt;/);
  assert.match(svg, /Run &lt;analysis&gt;/);
  assert.ok(Number(svg.match(/height="(\d+)"/)[1]) > Number(short.match(/height="(\d+)"/)[1]));
  assert.ok((svg.match(/<tspan/g) || []).length > 15);
});

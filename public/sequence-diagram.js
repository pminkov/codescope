import { escapeHtml as escape } from './content.js';

// Render keyboard-accessible controls for the diagram's viewing scale.
export function renderSequenceZoomControls() {
  return '<div class="sequence-zoom-controls" role="group" aria-label="Sequence diagram zoom"><button type="button" class="sequence-zoom-button" data-sequence-zoom="out" aria-label="Zoom out" title="Zoom out">−</button><output class="sequence-zoom-level" aria-live="polite" aria-atomic="true" aria-label="Diagram zoom level">100%</output><button type="button" class="sequence-zoom-button" data-sequence-zoom="in" aria-label="Zoom in" title="Zoom in">+</button><button type="button" class="sequence-zoom-button" data-sequence-zoom="reset" aria-label="Reset zoom to 100%">100%</button><button type="button" class="sequence-zoom-button" data-sequence-zoom="fit" aria-pressed="false">Fit to width</button></div>';
}

// Pan with the mouse on empty canvas space, preserving links and native scrolling.
export function setupSequencePan(viewport) {
  let drag;
  let suppressClick = false;

  // Capture background drags without taking over node links or scrollbar thumbs.
  const startPan = (event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    suppressClick = false;
    if (drag || event.target.closest('a, button, input, select, textarea')) return;
    const bounds = viewport.getBoundingClientRect();
    const left = bounds.left + viewport.clientLeft;
    const top = bounds.top + viewport.clientTop;
    if (event.clientX < left || event.clientX >= left + viewport.clientWidth ||
        event.clientY < top || event.clientY >= top + viewport.clientHeight) return;

    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      left: viewport.scrollLeft, top: viewport.scrollTop, moved: false };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('is-panning');
    viewport.focus({ preventScroll: true });
    event.preventDefault();
  };

  // Follow the pointer in screen pixels at every zoom level, including off-canvas.
  const movePan = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    viewport.scrollLeft = drag.left - dx;
    viewport.scrollTop = drag.top - dy;
    event.preventDefault();
  };

  // End capture on release, cancellation, lost capture, or diagram disposal.
  const endPan = (event) => {
    if (!drag || event && event.pointerId !== drag.pointerId) return;
    suppressClick = event?.type === 'pointerup' && drag.moved;
    const { pointerId } = drag;
    drag = undefined;
    viewport.classList.remove('is-panning');
    if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
  };

  // A completed pan must never activate a message under the released pointer.
  const suppressPanClick = (event) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  };

  viewport.addEventListener('pointerdown', startPan);
  viewport.addEventListener('pointermove', movePan);
  viewport.addEventListener('pointerup', endPan);
  viewport.addEventListener('pointercancel', endPan);
  viewport.addEventListener('lostpointercapture', endPan);
  viewport.addEventListener('click', suppressPanClick, true);

  // Release pointer capture and every handler when the diagram is replaced.
  return () => {
    endPan();
    viewport.removeEventListener('pointerdown', startPan);
    viewport.removeEventListener('pointermove', movePan);
    viewport.removeEventListener('pointerup', endPan);
    viewport.removeEventListener('pointercancel', endPan);
    viewport.removeEventListener('lostpointercapture', endPan);
    viewport.removeEventListener('click', suppressPanClick, true);
  };
}

// Scale SVG dimensions and keep fitted diagrams responsive to their viewport.
export function setupSequenceZoom(figure, preference) {
  const viewport = figure.querySelector('.sequence-scroll');
  const svg = viewport.querySelector('svg');
  const { width, height } = svg.viewBox.baseVal;
  const level = figure.querySelector('.sequence-zoom-level');
  const zoomOut = figure.querySelector('[data-sequence-zoom="out"]');
  const zoomIn = figure.querySelector('[data-sequence-zoom="in"]');
  const fit = figure.querySelector('[data-sequence-zoom="fit"]');
  const participantHeaders = svg.querySelector('.sequence-participant-headers');
  let scale = 1;

  // Offset only the header row so it stays above scrolled messages at every zoom.
  const pinParticipantHeaders = () => {
    participantHeaders.setAttribute('transform', `translate(0 ${viewport.scrollTop / scale})`);
  };

  // Resize the actual canvas so scroll extents and arrow hit targets scale together.
  const applyZoom = () => {
    const fitScale = Math.min(1, viewport.clientWidth / width);
    if (fitScale <= 0) return;
    const previousScale = scale;
    const center = (viewport.scrollLeft + viewport.clientWidth / 2) / scale;
    const top = viewport.scrollTop / scale;
    const minimum = Math.min(0.1, fitScale);
    scale = preference.mode === 'fit' ? fitScale
      : Math.max(minimum, Math.min(2.5, preference.scale));
    preference.scale = scale;

    svg.setAttribute('width', String(Math.floor(width * scale)));
    svg.setAttribute('height', String(Math.ceil(height * scale)));
    level.textContent = `${Math.round(scale * 100)}%`;
    zoomOut.disabled = scale <= minimum;
    zoomIn.disabled = scale >= 2.5;
    fit.setAttribute('aria-pressed', String(preference.mode === 'fit'));
    if (scale !== previousScale) {
      viewport.scrollLeft = preference.mode === 'fit' ? 0
        : center * scale - viewport.clientWidth / 2;
      viewport.scrollTop = top * scale;
    }
    pinParticipantHeaders();
  };

  // Change the current view without rebuilding the SVG or closing source details.
  const changeZoom = (event) => {
    const action = event.target.closest('[data-sequence-zoom]')?.dataset.sequenceZoom;
    if (!action) return;
    preference.mode = action === 'fit' ? 'fit' : 'manual';
    preference.scale = action === 'reset' ? 1
      : action === 'in' ? scale * 1.25 : action === 'out' ? scale / 1.25 : scale;
    applyZoom();
  };

  const controls = figure.querySelector('.sequence-zoom-controls');
  const disposePan = setupSequencePan(viewport);
  viewport.addEventListener('scroll', pinParticipantHeaders, { passive: true });
  controls.addEventListener('click', changeZoom);
  const observer = new ResizeObserver(applyZoom);
  observer.observe(viewport);
  applyZoom();

  // Release viewport observation and handlers when navigation replaces the diagram.
  return () => {
    disposePan();
    viewport.removeEventListener('scroll', pinParticipantHeaders);
    observer.disconnect();
    controls.removeEventListener('click', changeZoom);
  };
}

// Wrap labels into bounded lines, including symbols without spaces.
function wrapLabel(value, columns) {
  const lines = [];
  let line = '';

  for (const word of String(value).split(/\s+/)) {
    if (line && line.length + word.length + 1 > columns) {
      lines.push(line);
      line = '';
    }

    let remainder = word;
    while (remainder.length > columns) {
      if (line) lines.push(line);
      lines.push(remainder.slice(0, columns));
      remainder = remainder.slice(columns);
      line = '';
    }
    line = line ? `${line} ${remainder}` : remainder;
  }
  if (line) lines.push(line);

  return lines;
}

// Place escaped SVG text lines at fixed vertical intervals.
function renderTextLines(lines, x, y, className) {
  return `<text class="${className}" text-anchor="middle">${lines.map(
    // Preserve line spacing without allowing model-provided SVG markup.
    (line, index) => `<tspan x="${x}" y="${y + index * 18}">${escape(line)}</tspan>`,
  ).join('')}</text>`;
}

// Draw ordered interactions with lifelines, response arrows, and self calls.
export function renderSequenceDiagram(analysis) {
  if (!analysis.participants.length) return '';
  const spacing = 220;
  const width = analysis.participants.length * spacing + 120;
  const participants = analysis.participants.map(
    // Share label wrapping and column positions between headers and lifelines.
    (participant, index) => ({ ...participant, x: 120 + index * spacing,
      lines: wrapLabel(participant.name, 23) }),
  );
  const headerHeight = Math.max(36, ...participants.map(
    // Allow wrapped names to grow while keeping single-line headers compact.
    (participant) => participant.lines.length * 18 + 16,
  ));
  const headerBand = headerHeight + 16;
  const positions = new Map(participants.map(
    // Keep message endpoints centered on their participant columns.
    (participant) => [participant.id, participant.x],
  ));
  let cursor = headerBand + 40;
  const messages = analysis.messages.map(
    // Give every message enough vertical space for its label and branch condition.
    (message, index) => {
      const from = positions.get(message.from);
      const to = positions.get(message.to);
      const self = from === to;
      const columns = self ? 22 : Math.max(22, Math.floor(Math.abs(to - from) / 7.5) - 3);
      const labels = wrapLabel(`${index + 1}. ${message.label}`, columns);
      const conditions = message.condition ? wrapLabel(`[${message.condition}]`, columns) : [];
      const center = self ? from + 85 : (from + to) / 2;
      const top = cursor;
      const arrowY = top + (labels.length + conditions.length) * 18 + 8;
      cursor = arrowY + (self ? 70 : 48);
      const path = self
        ? `M ${from} ${arrowY} h 170 v 28 h -170`
        : `M ${from} ${arrowY} H ${to}`;
      const className = `sequence-message sequence-${message.kind}${message.inferred ? ' sequence-inferred' : ''}`;

      return `<a class="${className}" href="#sequence-details-dialog" aria-haspopup="dialog" aria-controls="sequence-details-dialog" data-sequence-message="${index + 1}" aria-label="Message ${index + 1}: ${escape(message.label)}. Open details."><title>${escape(message.description)}</title><rect class="sequence-message-hit" x="${Math.min(from, to) - 10}" y="${top - 14}" width="${self ? 190 : Math.abs(to - from) + 20}" height="${cursor - top - 20}" rx="4"/>${renderTextLines(conditions, center, top, 'sequence-condition')}${renderTextLines(labels, center, top + conditions.length * 18, 'sequence-label')}<path class="sequence-arrow" d="${path}" marker-end="url(#sequence-arrow-${message.kind === 'event' ? 'event' : 'call'})"/></a>`;
    },
  );
  const height = cursor + 60;
  const lifelines = participants.map(
    // Repeat participant names at the bottom to keep long diagrams readable.
    (participant) => {
      const { x, lines } = participant;

      return `<g class="sequence-participant"><title>${escape(participant.description)}</title><line x1="${x}" y1="${headerBand - 8}" x2="${x}" y2="${height - 55}"/>${renderTextLines(lines, x, height - 25 - (lines.length - 1) * 9, 'sequence-participant-name')}</g>`;
    },
  );
  const headers = participants.map(
    // Draw clickable participant cards in the foreground above passing messages.
    (participant) => {
      const { x, lines } = participant;
      const labelY = 8 + headerHeight / 2 + 4 - (lines.length - 1) * 9;

      return `<a class="sequence-participant-link" href="#sequence-details-dialog" data-sequence-participant="${escape(participant.id)}" aria-label="View details for ${escape(participant.name)}" aria-haspopup="dialog" aria-controls="sequence-details-dialog"><title>${escape(participant.description)}</title><rect x="${x - 97}" y="8" width="194" height="${headerHeight}" rx="7"/>${renderTextLines(lines, x, labelY, 'sequence-participant-name')}</a>`;
    },
  );

  return `<svg class="sequence-diagram" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-labelledby="sequence-title sequence-description"><title id="sequence-title">${escape(analysis.title)}</title><desc id="sequence-description">Read from top to bottom. Solid arrows are calls, dashed arrows are replies, and open arrows are asynchronous messages. Select a participant or message to open its details and sources in a dialog.</desc><defs><marker id="sequence-arrow-call" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 1 1 L 9 5 L 1 9 Z"/></marker><marker id="sequence-arrow-event" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 1 1 L 9 5 L 1 9"/></marker></defs>${lifelines.join('')}${messages.join('')}<g class="sequence-participant-headers" role="group" aria-label="Participants"><rect class="sequence-header-background" width="${width}" height="${headerBand}"/>${headers.join('')}</g></svg>`;
}

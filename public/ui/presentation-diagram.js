import { escapeHtml as escape } from '../content.js';

// Wrap bounded diagram labels without dropping long symbols or source terms.
function wrapDiagramText(value, width) {
  const lines = [];
  let line = '';
  for (const word of value.split(/\s+/)) {
    if (line && `${line} ${word}`.length > width) {
      lines.push(line);
      line = '';
    }
    let remaining = word;
    while (remaining.length > width) {
      if (line) lines.push(line);
      lines.push(remaining.slice(0, width));
      remaining = remaining.slice(width);
      line = '';
    }
    line = line ? `${line} ${remaining}` : remaining;
  }
  if (line) lines.push(line);

  return lines;
}

// Assign predictable card positions for CodeScope's three diagram types.
function positionDiagramNodes(diagram) {
  const layers = [0, 0, 0];
  // Keep journey order in a snake so its second row continues from the first.
  return diagram.nodes.map((node, index) => {
    let column = index % 3;
    let row = Math.floor(index / 3);
    if (diagram.type === 'system-map') {
      column = node.layer;
      row = layers[column]++;
    } else if (diagram.type === 'request-journey' && row === 1) column = 2 - column;

    return { ...node, x: 50 + column * 315, y: 65 + row * 205, number: index + 1 };
  });
}

// Draw wrapped SVG text using escaped text nodes rather than generated markup.
function renderDiagramText(value, x, y, width, className) {
  return /* HTML */ `
    <text x="${x}" y="${y}" class="${className}">
      ${wrapDiagramText(value, width).map(
        // Use fixed line spacing so card dimensions remain independent of browser fonts.
        (line, index) => `<tspan x="${x}" dy="${index ? 17 : 0}">${escape(line)}</tspan>`,
      ).join('')}
    </text>
  `;
}

// Route arrows through the open gutters between diagram cards.
function renderDiagramEdge(edge, nodes, markerId) {
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  const sameColumn = from.x === to.x;
  const sameRow = from.y === to.y;
  let path;
  let labelX;
  let labelY;
  if (sameColumn) {
    const down = to.y > from.y;
    const x = from.x + 115;
    const start = from.y + (down ? 135 : 0);
    const end = to.y + (down ? 0 : 135);
    path = `M ${x} ${start} V ${end}`;
    labelX = x;
    labelY = (start + end) / 2 - 8;
  } else if (sameRow) {
    const right = to.x > from.x;
    const start = from.x + (right ? 230 : 0);
    const end = to.x + (right ? 0 : 230);
    const y = from.y + 68;
    // Longer links take the top gutter instead of crossing intervening cards.
    const gutter = Math.abs(to.x - from.x) > 315 ? from.y - 28 : y;
    path = `M ${start} ${y} H ${start + (right ? 22 : -22)} V ${gutter}` +
      ` H ${end + (right ? -22 : 22)} V ${y} H ${end}`;
    labelX = (start + end) / 2;
    labelY = gutter - 10;
  } else {
    const startX = from.x + 115;
    const endX = to.x + 115;
    const down = to.y > from.y;
    const startY = from.y + (down ? 135 : 0);
    const endY = to.y + (down ? 0 : 135);
    const middleY = (startY + endY) / 2;
    path = `M ${startX} ${startY} V ${middleY} H ${endX} V ${endY}`;
    labelX = (startX + endX) / 2;
    labelY = middleY - 9;
  }

  return /* HTML */ `
    <g class="deck-diagram-edge ${edge.inferred ? 'is-inferred' : ''}">
      <path d="${path}" marker-end="url(#${escape(markerId)})" />
      ${renderDiagramText(edge.label, labelX, labelY, 18, 'deck-edge-label')}
    </g>
  `;
}

// Render one custom diagram as portable SVG with accessible descriptions.
export function renderPresentationDiagram(diagram, markerId = 'deck-arrow') {
  const nodes = positionDiagramNodes(diagram);
  const indexed = new Map(nodes.map(
    // Resolve connections without incorporating model IDs into CSS selectors or SVG IDs.
    (node) => [node.id, node],
  ));
  const module = diagram.type === 'module-detail';
  const journey = diagram.type === 'request-journey';
  const height = nodes.some(
    // Fit compact diagrams to their occupied row instead of shrinking them into a two-row canvas.
    (node) => node.y > 65,
  ) ? 440 : 250;
  const description = diagram.edges.map(
    // Give screen readers the relationships also conveyed by arrows.
    (edge) => `${indexed.get(edge.from).title} → ${indexed.get(edge.to).title}: ` +
      `${edge.label}${edge.inferred ? ' (inferred)' : ''}`,
  ).join('. ');

  return /* HTML */ `
    <figure class="deck-diagram" data-diagram-type="${escape(diagram.type)}">
      <figcaption>${escape(diagram.title)}</figcaption>
      <svg viewBox="0 0 960 ${height}" role="img" aria-label="${escape(diagram.title)}">
        <desc>${escape(description || diagram.title)}</desc>
        <defs>
          <marker
            id="${escape(markerId)}"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" class="deck-arrow-head" />
          </marker>
        </defs>
        ${module ? '<rect class="deck-module-boundary" x="15" y="12"' +
          ` width="930" height="${height - 24}" rx="22" />` : ''}
        ${diagram.edges.map(
          // Give every exported slide its own marker to avoid cross-slide ID collisions.
          (edge) => renderDiagramEdge(edge, indexed, markerId),
        ).join('')}
        ${nodes.map(
          // Cards share a fixed grid while type-specific labels explain their roles.
          (node) => /* HTML */ `
            <g class="deck-diagram-node">
              <rect x="${node.x}" y="${node.y}" width="230" height="135" rx="12" />
              ${renderDiagramText(journey ? `STEP ${node.number}` : node.group,
                node.x + 16, node.y + 24, 27, 'deck-node-group')}
              ${renderDiagramText(node.title, node.x + 16, node.y + 48, 25, 'deck-node-title')}
              ${renderDiagramText(node.description,
                node.x + 16, node.y + 87, 32, 'deck-node-description')}
            </g>
          `,
        ).join('')}
      </svg>
      ${diagram.edges.some(
        // Dashed connections remain explicitly explained in every output format.
        (edge) => edge.inferred,
      ) ? '<p class="deck-diagram-legend">Dashed connections are inferred.</p>' : ''}
    </figure>
  `;
}

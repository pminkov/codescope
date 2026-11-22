// Route orthogonal connections through the space between measured diagram cards.
const clearance = 12;
const stubLength = 24;
const normals = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };

// Round diagram coordinates to two decimal places.
const roundCoordinate = (value) => Math.round(value * 100) / 100;

// Remove duplicate points and redundant forward collinear segments.
function simplifyRoute(points) {
  const result = [];

  for (const point of points) {
    if (result.length && point[0] === result.at(-1)[0] && point[1] === result.at(-1)[1]) continue;

    while (result.length > 1) {
      const a = result.at(-2),
        b = result.at(-1);
      const straight = (b[0] - a[0]) * (point[1] - b[1]) === (b[1] - a[1]) * (point[0] - b[0]);
      const forward = (b[0] - a[0]) * (point[0] - b[0]) + (b[1] - a[1]) * (point[1] - b[1]) >= 0;
      if (!straight || !forward) break;
      result.pop();
    }

    result.push(point);
  }

  return result;
}

// Convert route points into an SVG path with rounded bends.
export function roundedPath(points, radius = 6) {
  if (!points.length) return '';
  let path = `M ${points[0].join(' ')}`;

  for (let index = 1; index < points.length - 1; index++) {
    const a = points[index - 1],
      b = points[index],
      c = points[index + 1];
    const before = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const after = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const r = Math.min(radius, before / 2, after / 2);
    const enter = b.map(
      // Stop the incoming segment before the bend's control point.
      (value, axis) => roundCoordinate(value + ((a[axis] - value) * r) / before),
    );
    const leave = b.map(
      // Start the outgoing segment after the bend's control point.
      (value, axis) => roundCoordinate(value + ((c[axis] - value) * r) / after),
    );
    path += ` L ${enter.join(' ')} Q ${b.join(' ')} ${leave.join(' ')}`;
  }

  if (points.length > 1) path += ` L ${points.at(-1).join(' ')}`;

  return path;
}

// Keep graph-routing search states ordered by their lowest known cost.
class MinHeap {
  entries = [];

  // Insert a search state while preserving minimum-cost heap order.
  push(entry) {
    const items = this.entries;
    let index = items.length;
    items.push(entry);

    while (index) {
      const parent = (index - 1) >> 1;
      if (items[parent].cost <= entry.cost) break;
      items[index] = items[parent];
      index = parent;
    }

    items[index] = entry;
  }

  // Remove the cheapest search state and restore heap order.
  pop() {
    const items = this.entries;
    const first = items[0],
      last = items.pop();
    if (items.length) {
      let index = 0;

      while (index * 2 + 1 < items.length) {
        let child = index * 2 + 1;
        if (child + 1 < items.length && items[child + 1].cost < items[child].cost) child++;
        if (items[child].cost >= last.cost) break;
        items[index] = items[child];
        index = child;
      }

      items[index] = last;
    }

    return first;
  }
}

// Choose card sides and space the endpoints of each connection.
function buildConnectionPorts(nodes, edges) {
  const rects = new Map(
    nodes.map(
      // Measure each card's right and bottom boundaries.
      (node) => [node.id, { ...node, right: node.x + node.width, bottom: node.y + node.height }],
    ),
  );
  const ports = new Map();

  // Register a source or target port on its card side.
  const addPort = (node, side, other, index, target) => {
    const port = { node, side, other, index, target, normal: normals[side] };
    const key = `${node.id}:${side}`;
    if (!ports.has(key)) ports.set(key, []);
    ports.get(key).push(port);

    return port;
  };

  const connections = edges.map(
    // Choose endpoint sides for a connection, including loops and skipped rows.
    (edge, index) => {
      const from = rects.get(edge.from),
        to = rects.get(edge.to);
      if (!from || !to) throw new Error('Diagram connection has an unknown component.');
      let sides;
      if (from === to) sides = ['right', 'right'];
      else if (to.y >= from.bottom + 2 * stubLength) sides = ['bottom', 'top'];
      else if (from.y >= to.bottom + 2 * stubLength) sides = ['top', 'bottom'];
      else if (to.x >= from.right) sides = ['right', 'left'];
      else sides = ['left', 'right'];
      const skipsRows =
        sides[0] === 'bottom'
          ? [...rects.values()].some(
              // Detect cards between the source and a lower target.
              (node) => node.y > from.bottom && node.bottom < to.y,
            )
          : sides[0] === 'top' &&
            [...rects.values()].some(
              // Detect cards between an upper target and the source.
              (node) => node.y > to.bottom && node.bottom < from.y,
            );
      if (skipsRows) {
        const difference = to.x + to.width / 2 - from.x - from.width / 2;
        sides[0] =
          difference < -1 ? 'left' : difference > 1 ? 'right' : index % 2 ? 'right' : 'left';
      }

      return {
        index,
        from: addPort(from, sides[0], to, index, false),
        to: addPort(to, sides[1], from, index, true),
      };
    },
  );

  for (const group of ports.values()) {
    const horizontal = ['top', 'bottom'].includes(group[0].side);
    const axis = horizontal ? 'x' : 'y',
      size = horizontal ? 'width' : 'height';
    // Order ports by the opposite card's position with stable tie breakers.
    group.sort(
      (a, b) =>
        a.other[axis] + a.other[size] / 2 - (b.other[axis] + b.other[size] / 2) ||
        a.index - b.index ||
        Number(a.target) - Number(b.target),
    );
    const node = group[0].node;
    const spacing = Math.min(24, (node[size] - 48) / Math.max(1, group.length - 1));
    // Space anchors and stubs along the selected card side.
    group.forEach((port, index) => {
      const along = node[axis] + node[size] / 2 + (index - (group.length - 1) / 2) * spacing;
      const center = horizontal
        ? [along, port.side === 'top' ? node.y : node.bottom]
        : [port.side === 'left' ? node.x : node.right, along];
      port.anchor = center.map(
        // Offset the visible endpoint from the card boundary.
        (value, axis) => roundCoordinate(value + port.normal[axis] * (port.target ? 6 : 3)),
      );
      port.stub = center.map(
        // Extend a routing stub outward from the card boundary.
        (value, axis) => roundCoordinate(value + port.normal[axis] * stubLength),
      );
    });
  }

  return { rects, connections };
}

// Build obstacle coordinates and cached grid segments shared by all routes.
function createRoutingGrid(rects, connections, { width, height }) {
  const obstacles = [...rects.values()].map(
    // Expand each card by the required routing clearance.
    (r) => ({
      left: r.x - clearance,
      right: r.right + clearance,
      top: r.y - clearance,
      bottom: r.bottom + clearance,
    }),
  );
  const xValues = [8, width - 8],
    yValues = [8, height - 8];

  for (const r of obstacles) {
    xValues.push(r.left, r.left - 12, r.right, r.right + 12);
    yValues.push(r.top, r.top - 12, r.bottom, r.bottom + 12);
  }

  for (const port of connections.flatMap(
    // Collect both endpoints when adding stub coordinates to the grid.
    (connection) => [connection.from, connection.to],
  )) {
    xValues.push(port.stub[0]);
    yValues.push(port.stub[1]);
  }

  // Deduplicate and sort usable coordinates inside the canvas.
  const gridCoordinates = (values, limit) =>
    [
      ...new Set(
        values
          .filter(
            // Keep coordinates within the canvas margin.
            (n) => n >= 8 && n <= limit - 8,
          )
          .map(roundCoordinate),
      ),
    ].sort(
      // Sort grid coordinates numerically.
      (a, b) => a - b,
    );

  const xs = gridCoordinates(xValues, width),
    ys = gridCoordinates(yValues, height);
  const columns = xs.length,
    rows = ys.length,
    count = columns * rows;
  const horizontalClear = new Uint8Array(count),
    verticalClear = new Uint8Array(count);
  const horizontalUsed = new Uint8Array(count),
    verticalUsed = new Uint8Array(count),
    visits = new Uint8Array(count);

  // Translate a grid point identifier into its canvas coordinates.
  const pointAt = (id) => [xs[id % columns], ys[Math.floor(id / columns)]];

  // Find the grid identifier for an endpoint coordinate.
  const gridPointId = ([x, y]) => {
    const column = xs.indexOf(x),
      row = ys.indexOf(y);
    return column < 0 || row < 0 ? -1 : row * columns + column;
  };

  // Cache obstacle clearance and usage for a neighboring grid segment.
  const gridSegment = (a, b, axis) => {
    const key = Math.min(a, b);
    const clear = axis === 0 ? horizontalClear : verticalClear;
    const used = axis === 0 ? horizontalUsed : verticalUsed;
    if (!clear[key]) {
      const [x1, y1] = pointAt(a),
        [x2, y2] = pointAt(b);
      const crosses = obstacles.some(
        // Test whether the segment crosses the interior of an expanded card.
        (r) =>
          axis === 0
            ? y1 > r.top + 0.01 &&
              y1 < r.bottom - 0.01 &&
              Math.max(x1, x2) > r.left + 0.01 &&
              Math.min(x1, x2) < r.right - 0.01
            : x1 > r.left + 0.01 &&
              x1 < r.right - 0.01 &&
              Math.max(y1, y2) > r.top + 0.01 &&
              Math.min(y1, y2) < r.bottom - 0.01,
      );
      clear[key] = crosses ? 2 : 1;
    }

    return { clear: clear[key] === 1, used, key };
  };

  return { columns, rows, count, pointAt, gridPointId, gridSegment, visits };
}

// Find a short orthogonal route and record its shared-grid usage.
function routeConnection(connection, grid) {
  const { columns, rows, count, pointAt, gridPointId, gridSegment, visits } = grid;

  const start = gridPointId(connection.from.stub),
    end = gridPointId(connection.to.stub);
  if (start < 0 || end < 0) return { index: connection.index, points: [], path: '' };
  const distance = new Float64Array(count * 2).fill(Infinity);
  const previous = new Int32Array(count * 2).fill(-1);
  const heap = new MinHeap();
  const startState = start * 2 + (connection.from.normal[0] ? 0 : 1);

  // Estimate the remaining Manhattan distance to the target stub.
  const remainingDistance = (id) =>
    Math.abs(pointAt(id)[0] - connection.to.stub[0]) +
    Math.abs(pointAt(id)[1] - connection.to.stub[1]);

  distance[startState] = 0;
  heap.push({ state: startState, cost: remainingDistance(start), distance: 0 });
  let finish = -1;

  while (heap.entries.length) {
    const current = heap.pop();
    if (current.distance !== distance[current.state]) continue;
    const id = Math.floor(current.state / 2),
      orientation = current.state % 2;
    if (id === end) {
      finish = current.state;
      break;
    }

    const column = id % columns,
      row = Math.floor(id / columns);
    const neighbors = [];
    if (column) neighbors.push([id - 1, 0]);
    if (column + 1 < columns) neighbors.push([id + 1, 0]);
    if (row) neighbors.push([id - columns, 1]);
    if (row + 1 < rows) neighbors.push([id + columns, 1]);

    for (const [next, axis] of neighbors) {
      const a = pointAt(id),
        b = pointAt(next),
        dx = b[0] - a[0],
        dy = b[1] - a[1];
      if (id === start && dx * connection.from.normal[0] + dy * connection.from.normal[1] < 0)
        continue;
      if (next === end && dx * connection.to.normal[0] + dy * connection.to.normal[1] > 0) continue;
      const link = gridSegment(id, next, axis);
      if (!link.clear) continue;
      const length = Math.abs(dx) + Math.abs(dy);
      const bend =
        orientation !== axis || (next === end && axis !== (connection.to.normal[0] ? 0 : 1));
      // Prefer short routes. Avoid sharing where practical without paying for
      // a long excursion around the entire diagram just to avoid a crossing.
      const cost =
        current.distance +
        length +
        (bend ? 18 : 0) +
        Math.min(0.45, link.used[link.key] * 0.15) * length +
        Math.min(4, visits[next] * 2);
      const nextState = next * 2 + axis;
      if (cost >= distance[nextState]) continue;
      distance[nextState] = cost;
      previous[nextState] = current.state;
      heap.push({ state: nextState, cost: cost + remainingDistance(next), distance: cost });
    }
  }

  // With card gutters and row spacing, every endpoint has a free route.
  // Leave a connection undrawn if a transient, collapsed layout has no route.
  if (finish === -1) return { index: connection.index, points: [], path: '' };
  const ids = [];

  for (let state = finish; state !== -1; state = previous[state]) {
    const id = Math.floor(state / 2);
    if (ids.at(-1) !== id) ids.push(id);
  }

  ids.reverse();
  // Record visits so later routes can prefer less congested grid points.
  ids.forEach((id) => visits[id]++);

  for (let index = 1; index < ids.length; index++) {
    const link = gridSegment(
      ids[index - 1],
      ids[index],
      Math.floor(ids[index - 1] / columns) === Math.floor(ids[index] / columns) ? 0 : 1,
    );
    link.used[link.key]++;
  }

  const points = simplifyRoute([connection.from.anchor, ...ids.map(pointAt), connection.to.anchor]);

  return { index: connection.index, points, path: roundedPath(points) };
}

// Route all connections using shared ports, obstacles, and congestion costs.
export function routeGraphEdges(nodes, edges, bounds) {
  if (!nodes.length || !edges.length) return [];
  const { rects, connections } = buildConnectionPorts(nodes, edges);
  const grid = createRoutingGrid(rects, connections, bounds);

  return connections.map(
    // Find each connection's route against the shared routing grid.
    (connection) => routeConnection(connection, grid),
  );
}

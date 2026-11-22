import test from 'node:test';
import assert from 'node:assert/strict';
import { routeGraphEdges } from '../public/graph-routing.js';

// Create a measured diagram card for routing fixtures.
const card = (id, x, y, width = 250, height = 160) => ({ id, x, y, width, height });

// Create a connection between two fixture card identifiers.
const link = (from, to) => ({ from, to });

// Convert route points into adjacent segments for geometry assertions.
function segments(route) {
  return route.points.slice(1).map(
    // Pair each point with its preceding route point.
    (point, index) => [route.points[index], point],
  );
}

// Measure the total Manhattan length of a routed connection.
const routeLength = (route) =>
  segments(route).reduce(
    // Accumulate the length of each orthogonal segment.
    (sum, [a, b]) => sum + Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]),
    0,
  );

// Measure the direct Manhattan distance between route endpoints.
const directDistance = (route) => {
  const a = route.points[0],
    b = route.points.at(-1);
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
};

// Check route count, orthogonality, and clearance from every card.
function checkRoutes(nodes, edges, size) {
  const routes = routeGraphEdges(nodes, edges, size);
  assert.equal(routes.length, edges.length);

  for (const route of routes) {
    assert.ok(route.path.startsWith('M '), `Missing connection ${route.index}`);
    assert.ok(!/NaN|Infinity/.test(route.path));

    for (const [a, b] of segments(route)) {
      assert.ok(a[0] === b[0] || a[1] === b[1]);

      for (const node of nodes) {
        const throughCard =
          a[1] === b[1]
            ? a[1] > node.y &&
              a[1] < node.y + node.height &&
              Math.max(a[0], b[0]) > node.x &&
              Math.min(a[0], b[0]) < node.x + node.width
            : a[0] > node.x &&
              a[0] < node.x + node.width &&
              Math.max(a[1], b[1]) > node.y &&
              Math.min(a[1], b[1]) < node.y + node.height;
        assert.equal(throughCard, false, `Connection ${route.index} crosses ${node.id}`);
      }
    }
  }

  return routes;
}

// Measure the collinear overlap between two routed connections.
function sharedLength(first, second) {
  let length = 0;

  for (const [a, b] of segments(first))
    for (const [c, d] of segments(second)) {
      if (a[1] === b[1] && c[1] === d[1] && a[1] === c[1])
        length += Math.max(
          0,
          Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) -
            Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])),
        );
      if (a[0] === b[0] && c[0] === d[0] && a[0] === c[0])
        length += Math.max(
          0,
          Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) -
            Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])),
        );
    }

  return length;
}

// Verify fan-out routes use separate anchors without shared trunks.
test('fan-out connections have separate ports and do not stack on shared trunks', () => {
  const nodes = [
    card('parent', 350, 32),
    card('a', 52, 288),
    card('b', 350, 288),
    card('c', 648, 288),
  ];
  const routes = checkRoutes(
    nodes,
    [link('parent', 'a'), link('parent', 'b'), link('parent', 'c')],
    { width: 950, height: 500 },
  );
  assert.equal(
    new Set(
      routes.map(
        // Read source anchors for the fan-out uniqueness assertion.
        (route) => route.points[0].join(','),
      ),
    ).size,
    3,
  );

  for (let a = 0; a < routes.length; a++)
    for (let b = a + 1; b < routes.length; b++) assert.equal(sharedLength(routes[a], routes[b]), 0);

  assert.ok(
    routes.some(
      // Confirm at least one route includes rounded SVG bends.
      (route) => route.path.includes(' Q '),
    ),
    'Bends should have rounded corners',
  );
});

// Verify fan-in routes attach at distinct target ports.
test('fan-in connections use different target ports', () => {
  const nodes = [
    card('a', 52, 32),
    card('b', 350, 32),
    card('c', 648, 32),
    card('target', 350, 288),
  ];
  const routes = checkRoutes(
    nodes,
    [link('a', 'target'), link('b', 'target'), link('c', 'target')],
    { width: 950, height: 500 },
  );
  assert.equal(
    new Set(
      routes.map(
        // Read target anchors for the fan-in uniqueness assertion.
        (route) => route.points.at(-1).join(','),
      ),
    ).size,
    3,
  );

  for (let a = 0; a < routes.length; a++)
    for (let b = a + 1; b < routes.length; b++) assert.equal(sharedLength(routes[a], routes[b]), 0);
});

// Verify storage branches stay clear of deeper diagram layers.
test('storage diagram keeps its three branches clear of connections to deeper layers', () => {
  const nodes = [
    card('store', 350, 32, 320),
    card('registry', 52, 288, 250, 260),
    card('index', 350, 288, 250, 260),
    card('source', 648, 288, 250, 260),
    card('workspace', 350, 644, 320, 180),
    card('understanding', 350, 920, 320, 180),
  ];
  const edges = [
    link('store', 'registry'),
    link('store', 'index'),
    link('store', 'understanding'),
    link('store', 'workspace'),
    link('store', 'source'),
    link('source', 'workspace'),
    link('workspace', 'understanding'),
  ];
  const routes = checkRoutes(nodes, edges, { width: 950, height: 1152 });

  for (const index of [0, 1, 4]) assert.equal(routes[index].points[0][1], 195);

  assert.equal(routes[2].points[0][0], 347);
  assert.equal(routes[3].points[0][0], 673);

  for (const [a, b] of [
    [0, 1],
    [0, 4],
    [1, 4],
  ])
    assert.equal(sharedLength(routes[a], routes[b]), 0);
});

// Verify long, return, and self connections avoid intervening cards.
test('long connections avoid intervening cards, including return paths and self connections', () => {
  const nodes = [card('top', 180, 32), card('middle', 180, 288), card('bottom', 180, 544)];
  const edges = [link('top', 'bottom'), link('bottom', 'top'), link('middle', 'middle')];
  const routes = checkRoutes(nodes, edges, { width: 610, height: 760 });
  assert.notEqual(routes[0].path, routes[1].path);
  assert.ok(
    routeLength(routes[0]) <= directDistance(routes[0]) + 96,
    'Use a nearby corridor instead of the canvas perimeter',
  );
  assert.notDeepEqual(routes[2].points[0], routes[2].points.at(-1));
});

// Verify routing respects changed card sizes after layout changes.
test('wrapped and expanded cards remain obstacles after layout changes', () => {
  const nodes = [
    card('a', 52, 32, 280, 220),
    card('b', 380, 32, 280, 220),
    card('c', 52, 332, 280, 400),
    card('d', 380, 332, 280, 400),
    card('e', 216, 828, 280, 160),
  ];
  checkRoutes(
    nodes,
    [link('a', 'b'), link('b', 'c'), link('a', 'e'), link('e', 'a'), link('c', 'd')],
    { width: 712, height: 1040 },
  );
});

// Verify skipped-row routes remain valid in a narrow single-column layout.
test('narrow single-column diagrams route skipped rows around the cards', () => {
  const nodes = [
    card('a', 32, 24, 236),
    card('b', 32, 264, 236),
    card('c', 32, 504, 236),
    card('d', 32, 744, 236),
  ];
  checkRoutes(nodes, [link('a', 'b'), link('a', 'c'), link('a', 'd'), link('d', 'b')], {
    width: 300,
    height: 928,
  });
});

// Verify compact overview links stay near their direct distance.
test('compact overview links stay short instead of looping through mandatory outside lanes', () => {
  const nodes = [
    ...[
      'browser',
      'persistence',
      'target',
      'validation',
      'codex',
      'model_service',
      'optional_data',
      'font_samples',
    ].map(
      // Arrange overview fixture cards in a compact grid.
      (id, index) => card(id, 52 + (index % 4) * 255, 32 + Math.floor(index / 4) * 224, 207, 144),
    ),
    card('server', 428, 496, 220, 144),
    card('store', 160, 736, 220, 144),
    card('indexer', 428, 736, 220, 144),
    card('runner', 696, 736, 220, 144),
  ];
  const pairs = [
    ['browser', 'server'],
    ['server', 'store'],
    ['server', 'indexer'],
    ['server', 'runner'],
    ['store', 'indexer'],
    ['indexer', 'target'],
    ['store', 'persistence'],
    ['store', 'runner'],
    ['runner', 'indexer'],
    ['runner', 'persistence'],
    ['runner', 'codex'],
    ['codex', 'runner'],
    ['runner', 'store'],
    ['runner', 'validation'],
    ['indexer', 'validation'],
    ['codex', 'model_service'],
    ['store', 'optional_data'],
  ];
  const edges = pairs.map(
    // Create connections for the overview fixture's endpoint pairs.
    ([from, to]) => link(from, to),
  );
  const routes = checkRoutes(nodes, edges, { width: 1076, height: 912 });

  for (const pair of [
    ['store', 'optional_data'],
    ['browser', 'server'],
    ['indexer', 'validation'],
  ]) {
    const route =
      routes[
        pairs.findIndex(
          // Find the route corresponding to the asserted endpoint pair.
          ([from, to]) => from === pair[0] && to === pair[1],
        )
      ];
    assert.ok(
      routeLength(route) <= directDistance(route) * 1.25,
      `${pair.join(' → ')} takes an unnecessary detour`,
    );
    assert.ok(route.points.length - 2 <= 5, `${pair.join(' → ')} has too many bends`);
    assert.equal(
      new Set(
        route.points.map(
          // Read route coordinates to detect repeated points.
          (point) => point.join(','),
        ),
      ).size,
      route.points.length,
      'Do not revisit points',
    );
  }
});

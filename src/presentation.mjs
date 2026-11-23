// Reject invalid slide identities and connections before saving a complete deck.
export function validatePresentation(deck) {
  const slideIds = new Set();
  for (const slide of deck.slides) {
    if (slideIds.has(slide.id)) throw new Error('Presentation slide IDs must be unique.');
    slideIds.add(slide.id);
    if ((slide.layout === 'diagram') !== Boolean(slide.diagram))
      throw new Error('Diagram slides must have a diagram; other layouts must use null.');
    if (slide.layout === 'content' && !slide.bullets.length)
      throw new Error('Content slides must have at least one talking point.');
    if (slide.layout === 'title' && slide.bullets.length)
      throw new Error('Title slides use a title and subtitle; put talking points on other slides.');
    if (slide.layout === 'diagram' && slide.bullets.length > 1)
      throw new Error('Diagram slides allow at most one takeaway; put details in speaker notes.');
    if (slide.subtitle.length + slide.bullets.join(' ').length > 520)
      throw new Error('Slide text is too dense. Split it across more slides.');
    if (!slide.diagram) continue;

    const { nodes, edges, type } = slide.diagram;
    const nodeIds = new Set();
    const layers = [0, 0, 0];
    for (const node of nodes) {
      if (nodeIds.has(node.id)) throw new Error('Presentation diagram node IDs must be unique.');
      nodeIds.add(node.id);
      layers[node.layer] += 1;
    }
    if (type === 'system-map' && layers.some(
      // Two cards per column keep source-generated system maps legible on a slide.
      (count) => count > 2,
    )) throw new Error('System maps allow at most two nodes in each layer.');

    for (const edge of edges) {
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to))
        throw new Error('Presentation connection points to an unknown node.');
      if (edge.from === edge.to)
        throw new Error('Presentation diagrams do not support self connections.');
    }
  }
}

import { escapeHtml as escape, formatText } from '../content.js';
import { renderIcon } from '../ui/icons.js';
import { renderPresentationDiagram } from '../ui/presentation-diagram.js';
import { renderSourceDisclosure } from '../ui/source-links.js';
import { renderNewAnalysisButton, renderSavedAnalysisListHeader } from '../ui/new-analysis.js';
import {
  renderAnalysisControls,
  renderAnalysisFreshness,
  renderAnalysisLabel,
} from '../ui/analysis-controls.js';

// Render the visual slide independently from navigation, notes, and browser state.
export function renderPresentationSlide(slide, index, total, projectName) {
  return /* HTML */ `
    <article class="deck-slide deck-layout-${escape(slide.layout)}">
      <header class="deck-slide-header">
        <span class="deck-brand">CODESCOPE <span>/ ${escape(projectName)}</span></span>
        <span>${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span>
      </header>
      <div class="deck-slide-body">
        <h2>${escape(slide.title)}</h2>
        ${slide.subtitle ? `<p class="deck-subtitle">${formatText(slide.subtitle)}</p>` : ''}
        ${slide.diagram ? renderPresentationDiagram(slide.diagram, `deck-arrow-${index}`) : ''}
        ${slide.bullets.length ? /* HTML */ `
          <ul class="deck-bullets">
            ${slide.bullets.map(
              // Render talking points with only the app's supported inline formatting.
              (bullet) => `<li>${formatText(bullet)}</li>`,
            ).join('')}
          </ul>
        ` : ''}
      </div>
      <footer class="deck-slide-footer">
        <span>
          ${slide.diagram ? escape(slide.diagram.type.replaceAll('-', ' ')) : 'CODE WALKTHROUGH'}
        </span>
        <span>
          ${slide.sources.length} source ${slide.sources.length === 1 ? 'reference' : 'references'}
        </span>
      </footer>
    </article>
  `;
}

// Render notes separately so slide changes can preserve the fullscreen stage element.
export function renderPresentationNotes(slide) {
  return /* HTML */ `
    <h3>Speaker notes</h3>
    <p>${formatText(slide.notes || 'No speaker notes for this slide.')}</p>
    ${renderSourceDisclosure(slide.sources)}
  `;
}

// Render a deck workspace with saved decks, slide outline, and presenter controls.
export function renderPresentationsView(project, selected, {
  projectUrl, actionsBusy, slideIndex = 0,
}) {
  if (!selected) return /* HTML */ `
    <article class="empty-analysis presentation-empty">
      <span class="eyebrow">PRESENTATION</span>
      <h2>Turn your codebase into a story</h2>
      <p>
        Enter a topic. CodeScope will inspect the source and create a deck with clear
        explanations, custom diagrams, and speaker notes.
      </p>
      <div class="presentation-types" aria-label="Available diagram types">
        <span>System maps</span><span>Request journeys</span><span>Module details</span>
      </div>
      ${renderNewAnalysisButton('presentations', actionsBusy)}
    </article>
  `;
  const slide = selected.slides[slideIndex];
  const exportUrl = `/api/projects/${project.id}/presentations/${selected.id}/export`;

  return /* HTML */ `
    <div class="workspace presentation-workspace">
      <aside class="sidebar presentation-sidebar" aria-label="Presentation navigation">
        <div class="sidebar-heading">
          <h2>Presentations</h2>
        </div>
        <p class="sidebar-description">Explore your codebase through slides and diagrams.</p>
        ${renderSavedAnalysisListHeader('presentations', project.presentations.length, actionsBusy)}
        <nav class="flow-options presentation-decks" aria-label="Saved presentations">
          ${project.presentations.map(
            // Keep every saved deck independently addressable and selectable.
            (deck, index) => /* HTML */ `
              <a
                href="${projectUrl('presentations', deck.id)}"
                class="flow-option ${deck.id === selected.id ? 'active' : ''}"
                ${deck.id === selected.id ? 'aria-current="page"' : ''}
              >
                <span class="flow-option-number">${String(index + 1).padStart(2, '0')}</span>
                <div>
                  <strong>${escape(deck.title)}</strong>
                  <p>${deck.slides.length} slides</p>
                </div>
                ${renderIcon('arrow')}
              </a>
            `,
          ).join('')}
        </nav>
        <h3 class="eyebrow">SLIDE OUTLINE</h3>
        <nav class="presentation-outline" aria-label="Slides">
          ${selected.slides.map(
            // Numbered buttons expose slide selection to pointer and keyboard users.
            (entry, index) => /* HTML */ `
              <button
                type="button"
                data-presentation-slide="${index}"
                ${index === slideIndex ? 'aria-current="step"' : ''}
              >
                <span>${String(index + 1).padStart(2, '0')}</span>${escape(entry.title)}
              </button>
            `,
          ).join('')}
        </nav>
      </aside>
      <section class="presentation-content">
        <div class="content-heading">
          <div>
            ${renderAnalysisLabel('PRESENTATION', project.presentations, selected.id)}
            <h2>${escape(selected.title)}</h2>
            <p>${formatText(selected.description)}</p>
          </div>
          ${renderAnalysisControls('presentations', selected.id, {
            busy: actionsBusy, review: selected.review,
          })}
        </div>
        ${renderAnalysisFreshness(selected.review)}
        <div class="presentation-toolbar">
          <button type="button" class="button" data-presentation-action="present">
            Present
          </button>
          <a class="button" href="${exportUrl}?format=html" download>Download HTML</a>
          <a class="button" href="${exportUrl}?format=json" download>Download JSON</a>
          <span>← → to navigate · F to present</span>
        </div>
        <div class="presentation-stage" tabindex="0" aria-label="Presentation slides">
          <div id="presentation-slide" aria-live="polite">
            ${renderPresentationSlide(slide, slideIndex, selected.slides.length, project.name)}
          </div>
          <div class="presentation-controls">
            <button
              type="button"
              class="button"
              data-presentation-action="previous"
              ${slideIndex === 0 ? 'disabled' : ''}
            >Previous</button>
            <span data-slide-position aria-live="polite">
              Slide ${slideIndex + 1} of ${selected.slides.length}
            </span>
            <button
              type="button"
              class="button"
              data-presentation-action="next"
              ${slideIndex === selected.slides.length - 1 ? 'disabled' : ''}
            >Next</button>
            <button
              type="button"
              class="button presentation-exit"
              data-presentation-action="exit"
            >Exit presentation</button>
          </div>
        </div>
        <div class="presentation-notes">
          ${renderPresentationNotes(slide)}
        </div>
      </section>
    </div>
  `;
}

// Export a self-contained deck with SVG diagrams, anchor navigation, and printable slides.
export function renderPresentationDocument(deck, projectName, css) {
  return /* HTML */ `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escape(deck.title)}</title>
    <style>${css}</style>
  </head>
  <body class="deck-export">
    <main>
      ${deck.slides.map(
        // Use ordinary anchors so the exported HTML works offline without scripts.
        (slide, index) => /* HTML */ `
          <section class="deck-export-page" id="slide-${index + 1}">
            ${renderPresentationSlide(slide, index, deck.slides.length, projectName)}
            <nav class="deck-export-navigation" aria-label="Slide ${index + 1} navigation">
              ${index ? `<a href="#slide-${index}">← Previous</a>` : '<span></span>'}
              <span>${index + 1} / ${deck.slides.length}</span>
              ${index + 1 < deck.slides.length
                ? `<a href="#slide-${index + 2}">Next →</a>` : '<a href="#slide-1">Start ↑</a>'}
            </nav>
            <details class="deck-export-notes">
              <summary>Speaker notes and sources</summary>
              <p>${formatText(slide.notes)}</p>
              <ul>${slide.sources.map(
                // Portable source references remain readable without access to the local app.
                (source) => `<li>${escape(source.path)}:${source.line}</li>`,
              ).join('')}</ul>
            </details>
          </section>
        `,
      ).join('')}
    </main>
  </body>
</html>`;
}

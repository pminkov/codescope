import { escapeHtml as escape, formatText } from '../content.js';
import { renderIcon } from '../ui/icons.js';
import { renderSourceButton, renderSourceDisclosure } from '../ui/source-links.js';
import { renderNewAnalysisButton, renderSavedAnalysisListHeader } from '../ui/new-analysis.js';
import {
  renderAnalysisControls,
  renderAnalysisFreshness,
  renderAnalysisLabel,
} from '../ui/analysis-controls.js';

// Render a saved flow's navigation entry and selection state.
function renderFlowOption(flow, index, selected, projectUrl) {
  return /* HTML */ `
    <a
      class="flow-option ${flow.id === selected.id ? 'active' : ''}"
      href="${projectUrl('flows', flow.id)}"
      ${flow.id === selected.id ? 'aria-current="page"' : ''}
    >
      <span class="flow-option-number">0${index + 1}</span>
      <div>
        <strong>${escape(flow.title)}</strong>
        <p>${formatText(flow.subtitle)}</p>
        <span>${escape(flow.tag || 'Source-linked walkthrough')}</span>
      </div>
      ${renderIcon('arrow')}
    </a>
  `;
}

// Render an alternate flow branch with its source evidence.
function renderFlowBranch(branch) {
  return /* HTML */ `
    <div class="branch">
      <span class="branch-marker">↳</span>
      <div>
        <h4>${escape(branch.title)}</h4>
        <p>${formatText(branch.text)}</p>
        ${renderSourceDisclosure(branch.sources)}
      </div>
    </div>
  `;
}

// Render one flow step with evidence, supporting calls, and saved expansion state.
function renderFlowStep(flow, step, number, detailState, projectUrl) {
  const key = `${flow.id}:${step.id}`;
  const open = detailState.get(key) !== false;
  const depthClass = step.depth ? `depth-${step.depth}` : '';
  const externalClass = step.external ? 'external-step' : '';
  const excludedSources = [step.source, ...(step.calls || [])].filter(Boolean);

  return /* HTML */ `
    <li class="timeline-item ${depthClass} ${externalClass}">
      <span class="step-number">${String(number).padStart(2, '0')}</span>
      <details class="step-card" data-detail="${escape(key)}" ${open ? 'open' : ''}>
        <summary>
          <div class="step-title">
            <span class="function-name">${escape(step.name)}</span>
            ${
              step.effect
                ? /* HTML */ `
                    <span class="effect ${step.external ? 'external' : ''}">
                      ${escape(step.effect)}
                    </span>
                  `
                : ''
            }
            <h4>${escape(step.title)}</h4>
          </div>
          ${renderIcon('chevron', 'step-chevron')}
        </summary>
        <div class="step-body">
          <p>${formatText(step.description)}</p>
          ${
            step.source
              ? renderSourceButton(step.source)
              : /* HTML */ `
                  <span class="external-reference">Outside this repository</span>
                `
          }
          ${renderSourceDisclosure(step.sources, excludedSources)}
          ${
            step.calls?.length
              ? /* HTML */ `
                  <div class="supporting-calls">
                    <span>SUPPORTING CALLS</span>
                    <div>
                      ${step.calls
                        .map(
                          // Render supporting call links using their symbols when available.
                          (reference) =>
                            renderSourceButton(
                              reference,
                              reference.symbol
                                ? `${reference.symbol}()`
                                : `${reference.path}:${reference.line || '?'}`,
                            ),
                        )
                        .join('')}
                    </div>
                  </div>
                `
              : ''
          }${
            step.tables
              ? /* HTML */ `
                  <div class="tables">
                    <span>TABLES</span>
                    ${step.tables
                      .map(
                        // Render a table name associated with the flow step.
                        (table) => /* HTML */ `
                          <code>${escape(table)}</code>
                        `,
                      )
                      .join('')}
                  </div>
                `
              : ''
          }${
            step.relatedFlow
              ? /* HTML */ `
                  <a class="inline-flow-link" href="${projectUrl('flows', step.relatedFlow)}">
                    Open the related flow →
                  </a>
                `
              : ''
          }
        </div>
      </details>
    </li>
  `;
}

// Compose the selected walkthrough without changing expansion state.
export function renderFlowsView(project, selected, { detailState, projectUrl, actionsBusy }) {
  if (!project.flows.length) {
    return /* HTML */ `
      <article class="empty-analysis">
        <span class="eyebrow">CODE FLOWS</span>
        <h2>Follow a feature through the code</h2>
        <p>
          Describe a user action, request, or process to trace. CodeScope will inspect this project
          and create a source-linked walkthrough.
        </p>
        ${renderNewAnalysisButton('flows', actionsBusy)}
      </article>
    `;
  }

  const steps = selected.phases.flatMap(
    // Collect steps across all phases for counts and expansion state.
    (phase) => phase.steps,
  );
  const sourceFiles = new Set(
    steps
      .flatMap(
        // Collect the primary and supporting citations for each step.
        (step) => [step.source, ...(step.calls || [])],
      )
      .filter(Boolean)
      .map(
        // Collect cited paths for the unique source file count.
        (reference) => reference.path,
      ),
  );
  const allOpen = steps.every(
    // Check whether every step is currently expanded.
    (step) => detailState.get(`${selected.id}:${step.id}`) !== false,
  );
  return /* HTML */ `
    <div class="workspace flow-workspace">
      <aside class="sidebar flow-sidebar" aria-label="Code flow navigation">
        <div class="sidebar-heading">
          <h2>Code flows</h2>
        </div>
        <p class="sidebar-description">From a user action to the code that makes it happen.</p>
        ${renderSavedAnalysisListHeader('flows', project.flows.length, actionsBusy)}
        <div class="flow-options">
          ${project.flows
            .map(
              // Render each flow navigation entry using the current selection.
              (flow, index) => renderFlowOption(flow, index, selected, projectUrl),
            )
            .join('')}
        </div>
        <div class="sidebar-bottom">
          <span class="eyebrow">FLOW SCOPE</span>
          <p>${formatText(project.scope)}</p>
          <div class="scope-tag">
            <i></i>
            ${escape(project.name)}
          </div>
        </div>
      </aside>
      <article class="flow-content">
        <div class="content-heading">
          <div>
            ${renderAnalysisLabel('CODE FLOW', project.flows, selected.id)}
            <h2>${escape(selected.title)}</h2>
            <p class="lead">${formatText(selected.description)}</p>
          </div>
          ${renderAnalysisControls('flows', selected.id, {
            busy: actionsBusy,
            review: selected.review,
          })}
        </div>
        ${renderAnalysisFreshness(selected.review)}
        <div class="flow-stats">
          <span>
            <strong>${steps.length}</strong>
            steps
          </span>
          <span>
            <strong>${sourceFiles.size}</strong>
            source files
          </span>
          <span>
            <strong>${selected.phases.length}</strong>
            ${selected.phases.length === 1 ? 'request' : 'request phases'}
          </span>
        </div>
        <div class="precondition">
          <span>STARTS WITH</span>
          <p>${formatText(selected.precondition)}</p>
        </div>
        <div class="insight">
          ${renderIcon('info')}
          <p>${formatText(selected.insight)}</p>
        </div>
        ${renderSourceDisclosure(selected.sources)}
        <div class="section-label execution-label">
          <h3>Execution walkthrough</h3>
          <button id="toggle-details" class="text-button">
            ${allOpen ? 'Collapse' : 'Expand'} details
          </button>
        </div>
        <div class="execution">${renderFlowPhases(selected, detailState, projectUrl)}</div>
        <div class="outcome">
          ${renderIcon('check')}
          <div>
            <span class="eyebrow">RESULT</span>
            <p>${formatText(selected.outcome)}</p>
          </div>
        </div>
        <section class="branches">
          <div class="section-label">
            <h3>Other paths to know</h3>
            <span>${selected.branches.length} branches</span>
          </div>
          <div class="branch-grid">${selected.branches.map(renderFlowBranch).join('')}</div>
        </section>
        <div class="trace-note">
          ${renderIcon('info')}
          <p>
            A source-reviewed walkthrough of the main calls. Indented steps run inside the preceding
            caller; supporting calls show helpers. Request phases are separated by browser actions
            and redirects.
          </p>
        </div>
      </article>
    </div>
  `;
}

// Number execution steps continuously across all phases of the selected flow.
function renderFlowPhases(selected, detailState, projectUrl) {
  let number = 0;

  return selected.phases
    .map(
      // Render a phase and its globally numbered execution steps.
      (phase, index) => /* HTML */ `
        ${
          phase.transition
            ? /* HTML */ `
                <div class="phase-transition">
                  <span>↓</span>
                  ${escape(phase.transition)}
                </div>
              `
            : ''
        }
        <section class="phase">
          <div class="phase-header">
            <span class="phase-index">${String(index + 1).padStart(2, '0')}</span>
            <h3>${escape(phase.title)}</h3>
            <code>${escape(phase.route)}</code>
          </div>
          ${renderSourceDisclosure(phase.sources)}
          <ol class="timeline">
            ${phase.steps
              .map(
                // Render each phase step while advancing the flow-wide number.
                (step) => renderFlowStep(selected, step, ++number, detailState, projectUrl),
              )
              .join('')}
          </ol>
        </section>
      `,
    )
    .join('');
}

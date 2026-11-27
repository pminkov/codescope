import { escapeHtml, formatText } from './content.js';

// Keep prior source locations available to follow-up questions without reusing link IDs.
function askAnswerHistory(message) {
  const answer = message.answer.replace(/\[([^\]\r\n]+)\]\(source:[a-zA-Z0-9_-]+\)/g, '$1');
  const references = (message.references || []).map(
    // Preserve explicit locations when a follow-up refers to a previously named function.
    (reference) => `${reference.symbol || reference.path}: ${reference.path}:${reference.line}${reference.endLine ? `-${reference.endLine}` : ''}`,
  );

  return `${answer}${references.length ? `\nSource references:\n${references.join('\n')}` : ''}`;
}

// Render only validated source links; model HTML and arbitrary URLs remain escaped text.
export function renderAskAnswer(answer, references = []) {
  const destinations = new Map(references.map(
    // Match each inline source marker to its server-validated destination.
    (reference) => [reference.id, reference],
  ));
  const tokens = /\[([^\]\r\n]+)\]\(source:([a-zA-Z0-9_-]+)\)|`([^`\r\n]+)`|\*\*([^*\r\n]+)\*\*/g;
  let html = '';
  let position = 0;
  for (const match of answer.matchAll(tokens)) {
    html += escapeHtml(answer.slice(position, match.index));
    if (match[1] !== undefined) {
      const reference = destinations.get(match[2]);
      const label = formatText(match[1]);
      html += reference
        ? `<button type="button" class="ask-source-link" data-source="${escapeHtml(reference.path)}" data-line="${reference.line}" data-end-line="${reference.endLine || reference.line}" data-symbol="${escapeHtml(reference.symbol)}" title="Open current ${escapeHtml(reference.path)} at line ${reference.line}">${label}</button>`
        : label;
    } else html += match[3] !== undefined
      ? `<code class="inline-code">${escapeHtml(match[3])}</code>`
      : `<strong>${escapeHtml(match[4])}</strong>`;
    position = match.index + match[0].length;
  }

  return (html + escapeHtml(answer.slice(position))).replace(/\n/g, '<br>');
}

// Retain recent completed turns within the request-size budget.
export function conversationHistory(messages) {
  const history = [];
  let size = 0;
  for (const message of messages.slice().reverse()) {
    if (!message.answer) continue;
    const pair = [
      { role: 'user', content: `${message.context}\n${message.question}`.slice(0, 8000) },
      { role: 'assistant', content: askAnswerHistory(message).slice(0, 8000) },
    ];
    const length = JSON.stringify(pair).length;
    if (history.length + 2 > 12 || size + length > 16000) break;
    history.unshift(...pair);
    size += length;
  }

  return history;
}

// Decode streamed JSON events even when network chunks split lines or Unicode text.
export async function readAnswerStream(response, receive) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) if (line.trim()) receive(JSON.parse(line));
      if (pending.length > 100000) throw new Error('The response exceeded the chat limit.');
      if (done) break;
    }
    if (pending.trim()) receive(JSON.parse(pending));
  } finally {
    reader.releaseLock();
  }
}

// Capture only visible text, excluding the chat itself and unsent form fields.
export function visibleAskExcerpt(root, widget) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const snippets = [];
  let length = 0;
  let node;
  while ((node = walker.nextNode()) && length < 11000) {
    const parent = node.parentElement;
    if (!parent || widget.contains(parent) ||
        parent.closest('script, style, textarea, input, [hidden]')) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const bounds = range.getBoundingClientRect();
    if (!bounds.width || !bounds.height || bounds.bottom <= 0 ||
        bounds.top >= innerHeight || bounds.right <= 0 || bounds.left >= innerWidth) continue;
    const text = node.textContent.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    snippets.push(text);
    length += text.length;
  }
  const selection = getSelection();
  const selectedText = selection?.anchorNode && !widget.contains(selection.anchorNode)
    ? String(selection).slice(0, 1000) : '';

  return `${selectedText ? `Selected text: ${selectedText}\n` : ''}${snippets.join('\n')}`.slice(0, 12000);
}

// Retain execution milestones under a disclosure once a question finishes.
function renderAskActivity(message) {
  const items = message.progress.map(
    // Public runner summaries stay escaped even when a CLI integration changes.
    (text) => `<li>${escapeHtml(text)}</li>`,
  ).join('');
  if (message.finishedAt) {
    const seconds = Math.max(1, Math.round((message.finishedAt - message.startedAt) / 1000));

    return `<details class="ask-activity"><summary>${message.error ? 'Stopped' : 'Worked'} for ${seconds}s</summary><ul>${items}</ul></details>`;
  }

  return /* HTML */ `
    <div class="ask-progress" role="status">
      <div>
        <span class="loading-dot"></span>Working
        <time id="ask-elapsed">0:00</time>
        ${message.assistant
          ? `<span class="ask-assistant">Using ${escapeHtml(message.assistant)}</span>`
          : ''}
      </div>
      <ul>${items}</ul>
    </div>
  `;
}

// Render a question, its completed answer or error, and its execution activity.
function renderAskTurn(message) {
  const result = message.answer
    ? `<div class="ask-answer"><span class="eyebrow">ANSWER</span><div>${renderAskAnswer(message.answer, message.references)}</div></div>`
    : message.error ? `<p class="ask-error" role="alert">${escapeHtml(message.error)}</p>` : '';

  return `<article class="ask-turn"><p class="ask-turn-context">${escapeHtml(message.context)}</p><div class="ask-user">${formatText(message.question)}</div>${renderAskActivity(message)}${result}</article>`;
}

// Mount one persistent chat with project-specific conversations and live activity.
export function setupAsk(getContext, openSource, dialogStack, blockDemoAction) {
  const widget = document.querySelector('#ask-widget');
  const launcher = document.querySelector('#ask-launcher');
  const panel = document.querySelector('#ask-panel');
  const input = document.querySelector('#ask-question');
  const messages = document.querySelector('#ask-messages');
  const submit = document.querySelector('#ask-send');
  const stop = document.querySelector('#ask-stop');
  const sourceDialog = document.querySelector('#source-dialog');
  const chats = new Map();
  let projectId;
  let chat;
  let open = false;
  let sourceReturnState;
  let savedMessageScrollTop = 0;

  // Keep the launcher usable inside the browser's active modal top layer.
  function attachAskWidget() {
    const host = dialogStack.latestDialog() || document.body;
    // Leave the draft and its focus target behind a modal notice until it is dismissed.
    if (host.getAttribute('role') === 'alertdialog') return;
    if (widget.parentElement !== host) {
      const scrollTop = messages.clientHeight ? messages.scrollTop : savedMessageScrollTop;
      host.append(widget);
      if (!panel.hidden) {
        messages.scrollTop = scrollTop;
        savedMessageScrollTop = messages.scrollTop;
      }
    }
    refreshContext();
  }

  // Update only the elapsed label so progress does not steal the reader's position.
  function updateElapsed() {
    const elapsed = document.querySelector('#ask-elapsed');
    if (!elapsed || !chat?.active) return;
    const seconds = Math.floor((Date.now() - chat.active.startedAt) / 1000);
    elapsed.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  // Render escaped conversation text and the current question's activity history.
  function renderChat() {
    const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 70;
    messages.innerHTML = chat?.messages.length ? chat.messages.map(renderAskTurn).join('')
      : '<div class="ask-empty"><h3>Ask about what you’re viewing</h3><p>Ask about a diagram, a source preview, or anything on this page. The assistant checks the project’s source to answer.</p></div>';
    submit.disabled = !chat || Boolean(chat.active) || !input.value.trim();
    stop.hidden = !chat?.active;
    document.querySelector('#ask-new').disabled = !chat || Boolean(chat.active);
    updateElapsed();
    if (nearBottom) messages.scrollTop = messages.scrollHeight;
    if (messages.clientHeight) savedMessageScrollTop = messages.scrollTop;
  }

  // Follow the current project while preserving each project's conversation and draft.
  function refreshContext() {
    const context = getContext();
    if (context?.projectId !== projectId) {
      if (chat) {
        chat.draft = input.value;
        chat.active?.controller.abort();
      }
      projectId = context?.projectId;
      if (projectId && !chats.has(projectId)) chats.set(projectId, { messages: [], draft: '' });
      chat = chats.get(projectId);
      input.value = chat?.draft || '';
      renderChat();
    }
    launcher.disabled = !context;
    input.disabled = !context;
    document.querySelector('#ask-context').textContent = context?.label || 'Select a project to ask a question';
    if (!context && open) closePanel();
  }

  // Close the panel without cancelling an in-progress answer.
  function closePanel() {
    sourceReturnState = null;
    open = false;
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    dialogStack.remove(panel);
    launcher.focus({ preventScroll: true });
  }

  // Open the chat without moving the underlying page or discarding its selection.
  launcher.addEventListener('click', () => {
    if (open && !panel.hidden) return closePanel();
    sourceReturnState = null;
    refreshContext();
    open = true;
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    renderChat();
    input.focus({ preventScroll: true });
    dialogStack.register(panel, closePanel,
      // Suspending Ask for a source preview preserves its original position in the stack.
      () => open, 'panel');
  });

  // Return focus to the fixed launcher after closing the panel.
  document.querySelector('#ask-close').addEventListener('click', closePanel);

  // Open live source without letting the global source handler open it a second time.
  widget.addEventListener('click', (event) => {
    const reference = event.target.closest('.ask-source-link');
    if (!reference) return;
    event.stopPropagation();
    // Suspend the panel while keeping the conversation open underneath the preview.
    sourceReturnState = { control: reference, scrollTop: messages.scrollTop };
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    openSource(reference.dataset.source, reference.dataset.line, reference.dataset.symbol,
      Number(reference.dataset.endLine));
  });

  // Restore the suspended conversation after any source-preview dismissal.
  sourceDialog.addEventListener('close', () => {
    if (!sourceReturnState || !open) return;
    const { control, scrollTop } = sourceReturnState;
    sourceReturnState = null;
    attachAskWidget();
    if (!open) return;
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    // Reparenting the hidden panel resets scrolling; restore it after layout is available.
    messages.scrollTop = scrollTop;
    savedMessageScrollTop = messages.scrollTop;
    (control.isConnected ? control : input).focus({ preventScroll: true });
  });

  // A closing parent dialog hides Ask before observers run, so retain its visible offset.
  messages.addEventListener('scroll', () => {
    if (!panel.hidden && messages.clientHeight) savedMessageScrollTop = messages.scrollTop;
  });

  // Support the usual Enter/Shift+Enter chat controls without submitting during IME input.
  widget.addEventListener('keydown', (event) => {
    if (event.target === input && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!submit.disabled) document.querySelector('#ask-form').requestSubmit();
    }
  });

  // Enable submission as the user edits their current draft.
  input.addEventListener('input', () => {
    if (chat) chat.draft = input.value;
    submit.disabled = !chat || Boolean(chat.active) || !input.value.trim();
  });

  // Stop the HTTP stream, which cancels its associated Codex process.
  stop.addEventListener('click', () => chat?.active?.controller.abort());

  // Clear the current project's chat while keeping the current screen context.
  document.querySelector('#ask-new').addEventListener('click', () => {
    if (!chat || chat.active) return;
    chat.messages = [];
    renderChat();
    input.focus({ preventScroll: true });
  });

  // Capture the screen at send time and stream progress and the validated answer.
  document.querySelector('#ask-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    refreshContext();
    const context = getContext();
    const question = input.value.trim();
    if (!context || !question || chat?.active) return;
    if (blockDemoAction()) return;
    const target = chat;
    const history = conversationHistory(target.messages);
    const message = { question, context: context.label, progress: ['Preparing your question…'], startedAt: Date.now() };
    const controller = new AbortController();
    target.active = { controller, startedAt: message.startedAt };
    target.messages.push(message);
    const root = dialogStack.latestDialog() || document.querySelector('#view');
    const excerpt = visibleAskExcerpt(root, widget);
    input.value = '';
    target.draft = '';
    renderChat();
    messages.scrollTop = messages.scrollHeight;
    const timer = setInterval(updateElapsed, 1000);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(context.projectId)}/ask`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history, context: { ...context, excerpt } }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Could not get an answer. Try again.');
      }
      // Apply complete stream events while retaining the original project as owner.
      await readAnswerStream(response, (update) => {
        if (update.type === 'progress' && update.assistant) message.assistant = update.assistant;
        if (update.type === 'progress' && message.progress.at(-1) !== update.message)
          message.progress = [...message.progress, update.message].slice(-4);
        if (update.type === 'answer') {
          message.answer = update.answer;
          message.references = update.references || [];
        }
        if (update.type === 'error') throw new Error(update.message);
        if (chat === target) renderChat();
      });
      if (!message.answer) throw new Error('The connection ended before an answer arrived. Try again.');
    } catch (error) {
      message.error = controller.signal.aborted ? 'Question stopped. You can send it again.' : error.message;
      if (chat === target && !input.value) {
        input.value = question;
        target.draft = question;
      }
    } finally {
      clearInterval(timer);
      message.finishedAt = Date.now();
      target.active = null;
      if (chat === target) renderChat();
    }
  });
  dialogStack.subscribe(attachAskWidget);
  attachAskWidget();

  return { refresh: refreshContext };
}

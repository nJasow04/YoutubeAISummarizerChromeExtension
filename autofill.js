// Runs on Claude, Gemini, and ChatGPT pages.
// Reads a pending transcript from storage and pastes it into the chat input.

(async () => {
  try {
    const { pendingTranscript } = await chrome.storage.session.get('pendingTranscript');
    if (!pendingTranscript) return;

    // Clear immediately so a page refresh doesn't re-paste
    await chrome.storage.session.remove('pendingTranscript');

    const input = await waitForInput();
    if (!input) return;

    fillInput(input, pendingTranscript);
  } catch (err) {
    console.error('[YouTube Summarizer] autofill error:', err);
  }
})();

// ─── Find the chat input ──────────────────────────────────────────────────────

function getSelectors() {
  const host = location.hostname;
  if (host.includes('claude.ai'))        return ['div[contenteditable="true"].ProseMirror', 'div[contenteditable="true"]'];
  if (host.includes('gemini.google.com')) return ['div.ql-editor[contenteditable="true"]', 'rich-textarea div[contenteditable="true"]', 'div[contenteditable="true"]'];
  if (host.includes('chatgpt.com'))      return ['div#prompt-textarea', 'div[contenteditable="true"]'];
  return ['div[contenteditable="true"]', 'textarea'];
}

function findVisibleInput() {
  for (const sel of getSelectors()) {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}

function waitForInput(ms = 15000) {
  const found = findVisibleInput();
  if (found) return Promise.resolve(found);

  return new Promise(resolve => {
    const obs = new MutationObserver(() => {
      const el = findVisibleInput();
      if (el) { obs.disconnect(); resolve(el); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); resolve(null); }, ms);
  });
}

// ─── Fill the input ───────────────────────────────────────────────────────────

function fillInput(el, text) {
  el.focus();

  // Method 1: simulate a paste event — React/Vue/Angular all listen to this
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  const pasted = el.dispatchEvent(new ClipboardEvent('paste', {
    bubbles: true, cancelable: true, clipboardData: dt,
  }));

  // Method 2: execCommand — works for ProseMirror, Quill, plain contenteditable
  if (!el.textContent.trim()) {
    document.execCommand('selectAll');
    document.execCommand('insertText', false, text);
  }

  // Method 3: direct assignment + synthetic input event (last resort)
  if (!el.textContent.trim()) {
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }
}

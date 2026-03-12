import {
  SITE_DEFINITIONS,
  SITE_KEYS,
  createEmptyStatus,
  getSiteFromUrl,
  type ImageAttachment,
  type SiteDefinition,
  type SiteKey,
  type SiteStatus,
} from '@/utils/workspace';
import { t } from '@/utils/i18n';

// Module-level state: survives SPA navigations and re-injections within the same page context.
const processedRequests = new Set<string>();
let listenerRegistered = false;
let submitInProgress = false;

export default defineContentScript({
  matches: ['*://claude.ai/*', '*://chatgpt.com/*', '*://gemini.google.com/*'],
  runAt: 'document_idle',
  main() {
    // Only run in the top frame — never in iframes.
    if (window.top !== window.self) {
      return;
    }

    const site = getSiteFromUrl(window.location.href);
    if (!site) {
      return;
    }

    const definition = SITE_DEFINITIONS[site];
    let lastSignature = '';

    const publishStatus = async () => {
      const status = detectStatus(site, definition);
      const signature = JSON.stringify({
        state: status.state,
        inputAvailable: status.inputAvailable,
        sendAvailable: status.sendAvailable,
        loggedIn: status.loggedIn,
        hasAssistantOutput: status.hasAssistantOutput,
        pageUrl: status.pageUrl,
        note: status.note,
      });

      if (signature === lastSignature) {
        return;
      }

      lastSignature = signature;
      try {
        await browser.runtime.sendMessage({
          type: 'site/status',
          site,
          status,
        });
      } catch {
        // Ignore when the background is restarting.
      }
    };

    const observer = new MutationObserver(() => {
      void publishStatus();
    });

    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
    });

    const heartbeat = window.setInterval(() => {
      void publishStatus();
    }, 2500);

    window.addEventListener('focus', () => {
      void publishStatus();
    });

    // Guard: only register the message listener once per page context.
    // If main() is called again (e.g. SPA navigation), skip re-registration.
    if (!listenerRegistered) {
      listenerRegistered = true;
      browser.runtime.onMessage.addListener((message) => {
        const currentSite = getSiteFromUrl(window.location.href);
        if (message?.type !== 'site/submit-prompt' || message.site !== currentSite) {
          return undefined;
        }

        const requestId = message.requestId as string | undefined;
        if (requestId) {
          if (processedRequests.has(requestId)) {
            return Promise.resolve({ ok: true, reason: 'already processed' });
          }
          processedRequests.add(requestId);
          if (processedRequests.size > 200) {
            const first = processedRequests.values().next().value;
            if (first) processedRequests.delete(first);
          }
        }

        const currentDefinition = SITE_DEFINITIONS[currentSite!];
        const attachments = Array.isArray(message.attachments)
          ? (message.attachments as ImageAttachment[])
          : [];

        return submitPrompt(currentDefinition, String(message.prompt ?? ''), attachments).then((result) => {
          void publishStatus();
          return result;
        });
      });
    }

    // Inject forward buttons on chat messages
    injectForwardStyles();
    const scanForMessages = () => injectForwardButtons(site, definition);
    const forwardScanInterval = window.setInterval(scanForMessages, 3000);
    // Also scan on DOM mutations (debounced)
    let forwardScanPending = false;
    const forwardObserver = new MutationObserver(() => {
      if (!forwardScanPending) {
        forwardScanPending = true;
        window.setTimeout(() => {
          forwardScanPending = false;
          scanForMessages();
        }, 600);
      }
    });
    forwardObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
    });

    window.addEventListener('beforeunload', () => {
      observer.disconnect();
      forwardObserver.disconnect();
      window.clearInterval(heartbeat);
      window.clearInterval(forwardScanInterval);
    });

    void publishStatus();
    window.setTimeout(() => void publishStatus(), 1200);
    window.setTimeout(() => void publishStatus(), 4000);
    window.setTimeout(scanForMessages, 2000);
  },
});

function detectStatus(site: SiteKey, definition: SiteDefinition): SiteStatus {
  const status = createEmptyStatus(site);
  const input = findVisibleEditable(definition.inputSelectors);
  const sendButton = findVisibleElement(definition.sendSelectors);
  const hasOutput = hasVisibleOutput(definition.outputSelectors);
  const loginRequired =
    !input &&
    (findVisibleElement(definition.loginSelectors) !== null ||
      hasButtonTextHint(definition.loginTextHints));

  status.pageUrl = window.location.href;
  status.inputAvailable = Boolean(input);
  status.sendAvailable = Boolean(sendButton && !isDisabled(sendButton));
  status.loggedIn = Boolean(input);
  status.hasAssistantOutput = hasOutput;

  if (input) {
    status.state = 'ready';
    status.note = hasOutput ? t('status.inputAndOutput') : t('status.inputReady');
    return status;
  }

  if (loginRequired) {
    status.state = 'login_required';
    status.note = t('status.loginNeeded');
    return status;
  }

  status.state = 'loading';
  status.note = document.readyState === 'complete' ? t('status.waitingInput') : t('status.pageLoading');
  return status;
}

async function submitPrompt(
  definition: SiteDefinition,
  prompt: string,
  attachments: ImageAttachment[],
) {
  // Prevent concurrent submissions on the same page
  if (submitInProgress) {
    return { ok: false, reason: 'submit already in progress' };
  }

  const normalizedPrompt = prompt.trim();
  const imageAttachments = attachments.filter(isImageAttachment);

  if (!normalizedPrompt && imageAttachments.length === 0) {
    return { ok: false, reason: t('submit.emptyContent') };
  }

  const input = findVisibleEditable(definition.inputSelectors);
  if (!input) {
    return { ok: false, reason: t('submit.noInput') };
  }

  submitInProgress = true;
  try {
    if (imageAttachments.length > 0) {
      const uploadResult = await uploadImages(definition, imageAttachments);
      if (!uploadResult.ok) {
        return uploadResult;
      }
    }

    if (normalizedPrompt) {
      const inserted = writePrompt(input, normalizedPrompt);
      if (!inserted) {
        return { ok: false, reason: t('submit.writeFailed') };
      }
      // Give the editor time to process the inserted text and enable the send button.
      await sleep(300);
    }

    return await waitAndSubmit(definition, input, imageAttachments.length > 0);
  } finally {
    submitInProgress = false;
  }
}

async function uploadImages(definition: SiteDefinition, attachments: ImageAttachment[]) {
  const files = attachments.map(createFileFromAttachment);
  const dbg = (msg: string, ...args: unknown[]) => console.log(`[Gosanke:upload] ${msg}`, ...args);

  // Strategy 1 (preferred): paste images via clipboard into the editor.
  // This is the most reliable method — all rich-text editors handle paste natively.
  const editor = findVisibleEditable(definition.inputSelectors);
  if (editor) {
    const pasted = pasteFilesIntoEditor(editor, files);
    dbg('clipboard paste result', pasted);
    if (pasted) {
      await sleep(800 + files.length * 300);
      return { ok: true };
    }
  }

  // Strategy 2: use an existing file input on the page.
  let uploadInput = findFileInput(definition.uploadInputSelectors);
  dbg('existing file input', uploadInput?.outerHTML?.slice(0, 120) ?? 'null');

  if (!uploadInput) {
    // Strategy 3: intercept hidden trigger buttons (Gemini).
    // These buttons call input.click() which opens a native dialog.
    // We intercept .click() to capture the input without opening the dialog.
    uploadInput = await interceptHiddenUploadTrigger(definition, dbg);
  }

  if (!uploadInput) {
    // Strategy 4: click visible attach buttons to reveal a file input.
    uploadInput = await ensureUploadInput(definition, dbg);
  }

  if (uploadInput) {
    const acceptedFiles = uploadInput.multiple ? files : files.slice(0, 1);
    const applied = setFilesOnInput(uploadInput, acceptedFiles);
    dbg('setFilesOnInput result', applied);
    if (applied) {
      await sleep(800 + acceptedFiles.length * 300);
      return { ok: true };
    }
  }

  // Strategy 5: drop files onto the editor area.
  if (editor) {
    const dropped = dropFilesOnElement(editor, files);
    dbg('drop fallback result', dropped);
    if (dropped) {
      await sleep(800 + files.length * 300);
      return { ok: true };
    }
  }

  return { ok: false, reason: t('submit.noUpload') };
}

function pasteFilesIntoEditor(editor: HTMLElement, files: File[]): boolean {
  try {
    editor.focus();

    const dataTransfer = new DataTransfer();
    for (const file of files) {
      dataTransfer.items.add(file);
    }

    const pasteEvent = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dataTransfer,
    });

    editor.dispatchEvent(pasteEvent);
    return pasteEvent.defaultPrevented;
  } catch {
    return false;
  }
}

/**
 * Intercept hidden upload trigger buttons (e.g. Gemini's xapfileselectortrigger).
 * These buttons call input.click() internally which opens a native file dialog.
 * We temporarily override HTMLInputElement.prototype.click to capture the input
 * and prevent the dialog, then set files on it programmatically.
 */
async function interceptHiddenUploadTrigger(
  definition: SiteDefinition,
  dbg: (msg: string, ...args: unknown[]) => void,
): Promise<HTMLInputElement | null> {
  const triggers = definition.hiddenUploadTriggerSelectors;
  if (triggers.length === 0) return null;

  for (const selector of triggers) {
    const trigger = document.querySelector<HTMLElement>(selector);
    if (!trigger) continue;

    dbg('intercepting hidden trigger', selector, trigger.className);

    let capturedInput: HTMLInputElement | null = null;
    const originalClick = HTMLInputElement.prototype.click;

    HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
      if (this.type === 'file') {
        capturedInput = this;
        dbg('intercepted file input click', this.outerHTML?.slice(0, 120));
        return;
      }
      return originalClick.call(this);
    };

    try {
      trigger.click();
      await sleep(50);
    } finally {
      HTMLInputElement.prototype.click = originalClick;
    }

    if (capturedInput) {
      dbg('captured file input via intercept');
      return capturedInput;
    }
  }

  dbg('no file input captured from hidden triggers');
  return null;
}

async function clearExistingAttachments(
  definition: SiteDefinition,
  dbg: (msg: string, ...args: unknown[]) => void,
) {
  const removeButtons = findAllVisibleElements(definition.removeAttachmentSelectors);
  dbg('removeAttachment buttons found', removeButtons.length,
    removeButtons.map((b) => ({ tag: b.tagName, label: b.getAttribute('aria-label'), text: b.innerText?.slice(0, 30) })),
  );
  if (removeButtons.length === 0) {
    return;
  }

  for (const btn of removeButtons) {
    btn.click();
  }

  // Wait for the UI to process the removals
  await sleep(300);
}

async function waitAndSubmit(
  definition: SiteDefinition,
  input: HTMLElement,
  hasAttachments: boolean,
) {
  const maxAttempts = hasAttachments ? 36 : 20;
  const delay = hasAttachments ? 250 : 150;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const sendButton = findVisibleElement(definition.sendSelectors);
    if (sendButton && !isDisabled(sendButton)) {
      sendButton.click();
      return { ok: true };
    }

    await sleep(delay);
  }

  const submittedWithEnter = pressEnter(input);
  return submittedWithEnter
    ? { ok: true }
    : { ok: false, reason: t('submit.sendNotReady') };
}

async function ensureUploadInput(
  definition: SiteDefinition,
  dbg: (msg: string, ...args: unknown[]) => void,
) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    // Check if a file input already exists on the page.
    const existingInput = findFileInput(definition.uploadInputSelectors);
    if (existingInput) {
      dbg(`attempt ${attempt}: found existing file input`);
      return existingInput;
    }

    // Click visible attach/upload button to reveal a file input.
    const attachTrigger =
      findVisibleElement(definition.attachButtonSelectors) ??
      findVisibleActionByTextHint(definition.attachTextHints);

    dbg(`attempt ${attempt}: attach trigger`,
      attachTrigger ? { tag: attachTrigger.tagName, label: attachTrigger.getAttribute('aria-label'), text: attachTrigger.innerText?.slice(0, 30) } : 'null',
    );

    if (attachTrigger) {
      attachTrigger.click();
      await sleep(300 + attempt * 150);

      const inputAfterClick = findFileInput(definition.uploadInputSelectors);
      if (inputAfterClick) {
        dbg(`attempt ${attempt}: found file input after click`);
        return inputAfterClick;
      }
    } else {
      await sleep(200);
    }
  }

  return findFileInput(definition.uploadInputSelectors);
}

/** Find first matching element regardless of visibility (for hidden triggers). */
function findElement(selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  return null;
}

function findVisibleEditable(selectors: string[]) {
  for (const selector of selectors) {
    const elements = document.querySelectorAll<HTMLElement>(selector);
    for (const element of elements) {
      if (!isVisible(element)) {
        continue;
      }

      const contentEditable = element.getAttribute('contenteditable');
      const isEditable =
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLInputElement ||
        contentEditable === '' ||
        contentEditable === 'true';

      if (isEditable) {
        return element;
      }
    }
  }

  return null;
}

function findVisibleElement(selectors: string[]) {
  for (const selector of selectors) {
    const elements = document.querySelectorAll<HTMLElement>(selector);
    for (const element of elements) {
      if (isVisible(element)) {
        return element;
      }
    }
  }

  return null;
}

function findAllVisibleElements(selectors: string[]): HTMLElement[] {
  const results: HTMLElement[] = [];
  for (const selector of selectors) {
    const elements = document.querySelectorAll<HTMLElement>(selector);
    for (const element of elements) {
      if (isVisible(element)) {
        results.push(element);
      }
    }
  }
  return results;
}

function findFileInput(selectors: string[]) {
  // First try specific selectors
  for (const selector of selectors) {
    const elements = document.querySelectorAll<HTMLInputElement>(selector);
    for (const element of elements) {
      if (element.type === 'file' && !element.disabled) {
        return element;
      }
    }
  }

  // Fallback: find ANY file input on the page (Claude/Gemini may not match selectors)
  const allFileInputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
  for (const element of allFileInputs) {
    if (!element.disabled) {
      return element;
    }
  }

  return null;
}

function findVisibleActionByTextHint(hints: string[]) {
  const normalizedHints = hints.map((hint) => hint.toLowerCase());
  const elements = document.querySelectorAll<HTMLElement>('button, a, label, [role="button"]');

  for (const element of elements) {
    if (!isVisible(element)) {
      continue;
    }

    const label = [
      element.innerText,
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (normalizedHints.some((hint) => label.includes(hint))) {
      return element;
    }
  }

  return null;
}

function hasVisibleOutput(selectors: string[]) {
  for (const selector of selectors) {
    const elements = document.querySelectorAll<HTMLElement>(selector);
    for (const element of elements) {
      if (!isVisible(element)) {
        continue;
      }

      const text = element.innerText?.trim() ?? '';
      if (text.length >= 16) {
        return true;
      }
    }
  }

  return false;
}

function hasButtonTextHint(hints: string[]) {
  return Boolean(findVisibleActionByTextHint(hints));
}

function isVisible(element: HTMLElement) {
  const style = window.getComputedStyle(element);
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    Number.parseFloat(style.opacity || '1') === 0
  ) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isDisabled(element: HTMLElement) {
  return (
    element.matches(':disabled') ||
    element.getAttribute('aria-disabled') === 'true' ||
    element.getAttribute('data-disabled') === 'true'
  );
}

function writePrompt(element: HTMLElement, value: string) {
  element.focus();

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    descriptor?.set?.call(element, value);
    if (!descriptor?.set) {
      element.value = value;
    }
    // Native inputs need synthetic events for React/framework state sync.
    dispatchTextEvents(element, value);
    return true;
  }

  // Contenteditable (ProseMirror, Quill, etc.)
  selectAllContent(element);

  // Primary: simulate a paste event — most reliable for rich-text editors.
  // ProseMirror and Quill both intercept paste and update internal state properly.
  if (simulatePaste(element, value)) {
    return true;
  }

  // Fallback 1: execCommand (deprecated but still works in some cases)
  selectAllContent(element);
  let inserted = false;
  try {
    inserted = document.execCommand('insertText', false, value);
  } catch {
    inserted = false;
  }
  if (inserted) {
    return true;
  }

  // Fallback 2: InputEvent with insertText type (ProseMirror listens to beforeinput)
  selectAllContent(element);
  if (simulateBeforeInput(element, value)) {
    return true;
  }

  // Last resort: direct DOM + synthetic events (least reliable — editor state may not sync)
  element.textContent = value;
  dispatchTextEvents(element, value);
  return true;
}

function selectAllContent(element: HTMLElement) {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function simulatePaste(element: HTMLElement, text: string): boolean {
  try {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', text);

    const pasteEvent = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dataTransfer,
    });

    element.dispatchEvent(pasteEvent);

    // If the editor handled the paste it calls preventDefault().
    if (pasteEvent.defaultPrevented) {
      return true;
    }

    // Some editors handle paste without calling preventDefault —
    // check if text actually appeared in the element.
    const current = (element.innerText ?? '').trim();
    if (current.length > 0 && current.includes(text.slice(0, 20))) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function simulateBeforeInput(element: HTMLElement, text: string): boolean {
  try {
    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: text,
      inputType: 'insertText',
    });
    element.dispatchEvent(beforeInput);

    if (beforeInput.defaultPrevented) {
      // Editor handled it via beforeinput
      element.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: text,
          inputType: 'insertText',
        }),
      );
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function dispatchTextEvents(element: HTMLElement, value: string) {
  element.dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: value,
      inputType: 'insertText',
    }),
  );
  element.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      data: value,
      inputType: 'insertText',
    }),
  );
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function pressEnter(element: HTMLElement) {
  element.focus();
  const keyboardConfig = {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
  };

  const down = element.dispatchEvent(new KeyboardEvent('keydown', keyboardConfig));
  element.dispatchEvent(new KeyboardEvent('keypress', keyboardConfig));
  element.dispatchEvent(new KeyboardEvent('keyup', keyboardConfig));
  return down;
}

function setFilesOnInput(input: HTMLInputElement, files: File[]) {
  try {
    // Clear any previous value so the same file can be re-uploaded
    try { input.value = ''; } catch { /* some inputs reject this */ }

    const dataTransfer = new DataTransfer();
    for (const file of files) {
      dataTransfer.items.add(file);
    }

    // Primary: use native property descriptor to set files
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
    if (descriptor?.set) {
      descriptor.set.call(input, dataTransfer.files);
    } else {
      // Fallback: direct assignment (works in some browsers)
      (input as { files: FileList }).files = dataTransfer.files;
    }

    // Dispatch change + input events — React listens to 'change', Angular to both.
    // Do NOT dispatch 'drop' here: it causes duplicate uploads on ChatGPT.
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

    return true;
  } catch {
    return false;
  }
}

function dropFilesOnElement(element: HTMLElement, files: File[]): boolean {
  try {
    const dataTransfer = new DataTransfer();
    for (const file of files) {
      dataTransfer.items.add(file);
    }

    element.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer }));
    element.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    return true;
  } catch {
    return false;
  }
}

function createFileFromAttachment(attachment: ImageAttachment) {
  return new File([Uint8Array.from(attachment.bytes)], attachment.name, {
    type: attachment.type || 'image/png',
    lastModified: attachment.lastModified || Date.now(),
  });
}

function isImageAttachment(attachment: ImageAttachment | undefined): attachment is ImageAttachment {
  return Boolean(
    attachment &&
      attachment.name &&
      attachment.type &&
      attachment.type.startsWith('image/') &&
      attachment.bytes?.length,
  );
}

// --- Forward buttons ---

const FORWARD_MARKER = 'data-gosanke-forward';
let forwardStylesInjected = false;

function injectForwardStyles() {
  if (forwardStylesInjected) return;
  forwardStylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    [${FORWARD_MARKER}] { position: relative !important; }
    .gosanke-forward-bar {
      position: absolute;
      top: 4px;
      right: 4px;
      display: none;
      align-items: center;
      gap: 3px;
      z-index: 99999;
      padding: 3px 4px;
      border-radius: 6px;
      background: rgba(255,255,255,0.92);
      box-shadow: 0 1px 6px rgba(0,0,0,0.13);
    }
    @media (prefers-color-scheme: dark) {
      .gosanke-forward-bar {
        background: rgba(40,40,40,0.92);
      }
    }
    [${FORWARD_MARKER}]:hover > .gosanke-forward-bar {
      display: flex;
    }
    .gosanke-forward-btn {
      all: unset;
      display: inline-flex;
      align-items: center;
      padding: 2px 7px;
      font-size: 11px;
      font-family: system-ui, -apple-system, sans-serif;
      color: #555;
      border: 1px solid rgba(0,0,0,0.12);
      border-radius: 4px;
      background: rgba(245,245,245,0.95);
      cursor: pointer;
      white-space: nowrap;
      line-height: 1.5;
      transition: background 0.15s;
    }
    @media (prefers-color-scheme: dark) {
      .gosanke-forward-btn {
        color: #ccc;
        border-color: rgba(255,255,255,0.12);
        background: rgba(60,60,60,0.95);
      }
    }
    .gosanke-forward-btn:hover {
      background: rgba(220,220,220,0.95);
    }
    @media (prefers-color-scheme: dark) {
      .gosanke-forward-btn:hover {
        background: rgba(80,80,80,0.95);
      }
    }
    .gosanke-forward-btn[data-sending="true"] {
      opacity: 0.45;
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
}

function injectForwardButtons(currentSite: SiteKey, definition: SiteDefinition) {
  const targetSites = SITE_KEYS.filter((s) => s !== currentSite);

  for (const selector of definition.messageSelectors) {
    const messages = document.querySelectorAll<HTMLElement>(selector);
    for (const msg of messages) {
      if (msg.hasAttribute(FORWARD_MARKER)) continue;
      if (!isVisible(msg)) continue;

      // Skip if an ancestor already has forward buttons (prevents duplicates from nested selectors)
      if (msg.closest(`[${FORWARD_MARKER}]`)) {
        msg.setAttribute(FORWARD_MARKER, '');
        continue;
      }

      const text = (msg.innerText ?? '').trim();
      if (text.length < 4) continue;

      msg.setAttribute(FORWARD_MARKER, '');

      const bar = document.createElement('div');
      bar.className = 'gosanke-forward-bar';

      for (const target of targetSites) {
        const btn = document.createElement('button');
        btn.className = 'gosanke-forward-btn';
        btn.textContent = `→ ${SITE_DEFINITIONS[target].shortLabel}`;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          void handleForwardClick(btn, msg, target);
        });
        bar.appendChild(btn);
      }

      msg.appendChild(bar);
    }
  }
}

async function handleForwardClick(btn: HTMLElement, msgElement: HTMLElement, targetSite: SiteKey) {
  const text = (msgElement.innerText ?? '').trim();
  if (!text) return;

  btn.setAttribute('data-sending', 'true');
  const originalText = btn.textContent ?? '';
  btn.textContent = t('forward.sending');

  try {
    const response = (await browser.runtime.sendMessage({
      type: 'site/forward-message',
      text,
      targetSite,
    })) as { ok?: boolean; reason?: string } | undefined;

    btn.textContent = response?.ok ? t('forward.sent') : t('forward.failed');
    window.setTimeout(() => {
      btn.textContent = originalText;
      btn.removeAttribute('data-sending');
    }, 2000);
  } catch {
    btn.textContent = t('forward.failed');
    window.setTimeout(() => {
      btn.textContent = originalText;
      btn.removeAttribute('data-sending');
    }, 2000);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

export default defineContentScript({
  matches: ['*://claude.ai/*', '*://chatgpt.com/*', '*://gemini.google.com/*'],
  runAt: 'document_idle',
  main() {
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

    browser.runtime.onMessage.addListener((message) => {
      if (message?.type !== 'site/submit-prompt' || message.site !== site) {
        return undefined;
      }

      const attachments = Array.isArray(message.attachments)
        ? (message.attachments as ImageAttachment[])
        : [];

      return submitPrompt(definition, String(message.prompt ?? ''), attachments).then((result) => {
        void publishStatus();
        return result;
      });
    });

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
    status.note = hasOutput ? '已检测到聊天输入框与回复内容' : '输入框已就绪，等待发送';
    return status;
  }

  if (loginRequired) {
    status.state = 'login_required';
    status.note = '页面存在登录入口，需先完成登录';
    return status;
  }

  status.state = 'loading';
  status.note = document.readyState === 'complete' ? '等待聊天输入框出现' : '页面仍在加载';
  return status;
}

async function submitPrompt(
  definition: SiteDefinition,
  prompt: string,
  attachments: ImageAttachment[],
) {
  const normalizedPrompt = prompt.trim();
  const imageAttachments = attachments.filter(isImageAttachment);

  if (!normalizedPrompt && imageAttachments.length === 0) {
    return { ok: false, reason: '输入内容和图片都为空' };
  }

  const input = findVisibleEditable(definition.inputSelectors);
  if (!input) {
    return { ok: false, reason: '输入框未找到，可能尚未登录' };
  }

  if (imageAttachments.length > 0) {
    const uploadResult = await uploadImages(definition, input, imageAttachments);
    if (!uploadResult.ok) {
      return uploadResult;
    }
  }

  if (normalizedPrompt) {
    const inserted = writePrompt(input, normalizedPrompt);
    if (!inserted) {
      return { ok: false, reason: '无法写入输入框' };
    }
  }

  return waitAndSubmit(definition, input, imageAttachments.length > 0);
}

async function uploadImages(
  definition: SiteDefinition,
  input: HTMLElement,
  attachments: ImageAttachment[],
) {
  const files = attachments.map(createFileFromAttachment);

  // Strategy 1: Synthetic paste event — dispatches ClipboardEvent on the input.
  // Only counts as success if the site called preventDefault() (meaning it handled the paste).
  // Sites that check event.isTrusted or don't support image paste will NOT call preventDefault(),
  // so we correctly fall through to strategy 2.
  const pasteHandled = pasteImageViaEvent(input, files);
  if (pasteHandled) {
    await sleep(800);
    return { ok: true };
  }

  // Strategy 2: File input injection (reliable fallback)
  const uploadInput = await ensureUploadInput(definition);
  if (!uploadInput) {
    return { ok: false, reason: '未找到图片上传入口' };
  }

  const acceptedFiles = uploadInput.multiple ? files : files.slice(0, 1);
  const applied = setFilesOnInput(uploadInput, acceptedFiles);
  if (!applied) {
    return { ok: false, reason: '无法把图片写入上传控件' };
  }

  await sleep(700);
  return { ok: true };
}

async function waitAndSubmit(
  definition: SiteDefinition,
  input: HTMLElement,
  hasAttachments: boolean,
) {
  const maxAttempts = hasAttachments ? 36 : 12;
  const delay = hasAttachments ? 250 : 120;

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
    : { ok: false, reason: '发送按钮未就绪，请检查页面状态' };
}

function pasteImageViaEvent(input: HTMLElement, files: File[]): boolean {
  try {
    input.focus();
    const dt = new DataTransfer();
    for (const file of files) {
      dt.items.add(file);
    }
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    });
    // dispatchEvent returns false when preventDefault() was called,
    // meaning the site actually handled the paste event.
    // If it returns true (not cancelled), the site ignored it — fall through to file input.
    const notCancelled = input.dispatchEvent(event);
    return !notCancelled;
  } catch {
    return false;
  }
}

async function ensureUploadInput(definition: SiteDefinition) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const existingInput = findFileInput(definition.uploadInputSelectors);
    if (existingInput) {
      return existingInput;
    }

    const attachTrigger =
      findVisibleElement(definition.attachButtonSelectors) ??
      findVisibleActionByTextHint(definition.attachTextHints);

    attachTrigger?.click();
    await sleep(220 + attempt * 120);
  }

  return findFileInput(definition.uploadInputSelectors);
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

function findFileInput(selectors: string[]) {
  for (const selector of selectors) {
    const elements = document.querySelectorAll<HTMLInputElement>(selector);
    for (const element of elements) {
      if (element.type === 'file' && !element.disabled) {
        return element;
      }
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
    dispatchTextEvents(element, value);
    return true;
  }

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection?.removeAllRanges();
  selection?.addRange(range);

  let inserted = false;
  try {
    inserted = document.execCommand('insertText', false, value);
  } catch {
    inserted = false;
  }

  if (!inserted) {
    element.textContent = value;
  }

  dispatchTextEvents(element, value);
  return true;
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
    const dataTransfer = new DataTransfer();
    for (const file of files) {
      dataTransfer.items.add(file);
    }

    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
    descriptor?.set?.call(input, dataTransfer.files);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
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
  btn.textContent = '发送中...';

  try {
    const response = (await browser.runtime.sendMessage({
      type: 'site/forward-message',
      text,
      targetSite,
    })) as { ok?: boolean; reason?: string } | undefined;

    btn.textContent = response?.ok ? '已发送' : `失败`;
    window.setTimeout(() => {
      btn.textContent = originalText;
      btn.removeAttribute('data-sending');
    }, 2000);
  } catch {
    btn.textContent = '失败';
    window.setTimeout(() => {
      btn.textContent = originalText;
      btn.removeAttribute('data-sending');
    }, 2000);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import { t } from './i18n';

export type SiteKey = 'claude' | 'chatgpt' | 'gemini';
export type WorkspaceWindowKey = SiteKey | 'controller';
export type SiteState = 'ready' | 'login_required' | 'loading';

export interface SiteDefinition {
  key: SiteKey;
  label: string;
  shortLabel: string;
  url: string;
  urlPatterns: string[];
  inputSelectors: string[];
  sendSelectors: string[];
  uploadInputSelectors: string[];
  attachButtonSelectors: string[];
  attachTextHints: string[];
  /** Hidden buttons that trigger a file input when clicked (bypass visibility check). */
  hiddenUploadTriggerSelectors: string[];
  removeAttachmentSelectors: string[];
  outputSelectors: string[];
  messageSelectors: string[];
  loginSelectors: string[];
  loginTextHints: string[];
}

export interface SiteStatus {
  site: SiteKey;
  state: SiteState;
  inputAvailable: boolean;
  sendAvailable: boolean;
  loggedIn: boolean;
  hasAssistantOutput: boolean;
  pageUrl: string;
  note: string;
  lastSeen: number;
}

export interface WorkspaceSnapshot {
  order: SiteKey[];
  statuses: Record<SiteKey, SiteStatus>;
}

export interface ImageAttachment {
  name: string;
  type: string;
  size: number;
  lastModified: number;
  bytes: number[];
}

export interface WindowTarget {
  windowId?: number;
  tabId?: number;
}

export interface LayoutRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type WorkspaceWindowRects = Partial<Record<WorkspaceWindowKey, LayoutRect>>;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export const CONTROLLER_PATH = '/controller.html';
export const ORDER_STORAGE_KEY = 'gosanke.workspace.order';
export const LAYOUT_STORAGE_KEY = 'gosanke.workspace.layout';
export const WINDOW_RECTS_STORAGE_KEY = 'gosanke.workspace.windowRects';
export const SITE_KEYS: SiteKey[] = ['claude', 'chatgpt', 'gemini'];
export const DEFAULT_ORDER: SiteKey[] = [...SITE_KEYS];

export const SITE_DEFINITIONS: Record<SiteKey, SiteDefinition> = {
  claude: {
    key: 'claude',
    label: 'Claude',
    shortLabel: 'Claude',
    url: 'https://claude.ai/new',
    urlPatterns: ['*://claude.ai/*'],
    inputSelectors: [
      'div.ProseMirror[contenteditable="true"]',
      'fieldset [contenteditable="true"]',
      'form [contenteditable="true"][data-placeholder]',
      '[contenteditable="true"].is-editor-empty',
      'fieldset div[contenteditable="true"]',
    ],
    sendSelectors: [
      'button[aria-label*="Send"]',
      'button[aria-label*="send"]',
      'button[data-testid="send-button"]',
      'form button[type="submit"]',
      'fieldset button[aria-label*="Send"]',
    ],
    uploadInputSelectors: [
      'input[type="file"][accept*="image"]',
      'input[type="file"]',
    ],
    attachButtonSelectors: [
      'button[aria-label*="Attach"]',
      'button[aria-label*="attach"]',
      'button[aria-label*="Upload"]',
      'button[title*="Attach"]',
      'button[data-testid*="attach"]',
      'button[data-testid*="upload"]',
    ],
    attachTextHints: ['attach', 'upload', 'file', 'image', 'add content'],
    hiddenUploadTriggerSelectors: [],
    removeAttachmentSelectors: [
      'button[aria-label*="Remove"]',
      'button[aria-label*="remove"]',
      'button[aria-label*="Delete"]',
    ],
    outputSelectors: [
      '[data-testid="chat-message"]',
      'div[data-is-streaming]',
      'main article',
    ],
    messageSelectors: [
      '[data-testid="chat-message"]',
      'div[data-is-streaming]',
    ],
    loginSelectors: ['a[href*="/login"]', 'button[data-testid="login-button"]'],
    loginTextHints: ['Log in', 'Sign in', 'Continue with Google'],
  },
  chatgpt: {
    key: 'chatgpt',
    label: 'ChatGPT',
    shortLabel: 'ChatGPT',
    url: 'https://chatgpt.com/',
    urlPatterns: ['*://chatgpt.com/*'],
    inputSelectors: [
      '#prompt-textarea',
      '[data-testid="composer-root"] [contenteditable="true"]',
      'form textarea',
      'form [contenteditable="true"]',
    ],
    sendSelectors: [
      'button[data-testid="send-button"]',
      'button[aria-label*="Send"]',
      'form button[type="submit"]',
    ],
    uploadInputSelectors: [
      'input[type="file"][accept*="image"]',
      'input[type="file"]',
    ],
    attachButtonSelectors: [
      'button[aria-label*="Attach"]',
      'button[aria-label*="attach"]',
      'button[aria-label*="Add photos"]',
      'button[data-testid="composer-plus-button"]',
      'button[data-testid*="attach"]',
    ],
    attachTextHints: ['attach', 'upload', 'photo', 'image', 'file'],
    hiddenUploadTriggerSelectors: [],
    removeAttachmentSelectors: [
      'button[aria-label*="Remove"]',
      'button[aria-label*="remove"]',
      'button[data-testid*="remove"]',
    ],
    outputSelectors: [
      '[data-testid^="conversation-turn-"]',
      '[data-message-author-role="assistant"]',
      'main article',
    ],
    messageSelectors: [
      '[data-testid^="conversation-turn-"]',
    ],
    loginSelectors: ['a[href*="/auth/login"]', 'button[data-testid="login-button"]'],
    loginTextHints: ['Log in', 'Sign up', 'Continue with Google'],
  },
  gemini: {
    key: 'gemini',
    label: 'Gemini',
    shortLabel: 'Gemini',
    url: 'https://gemini.google.com/app',
    urlPatterns: ['*://gemini.google.com/*'],
    inputSelectors: [
      'rich-textarea div.ql-editor[contenteditable="true"]',
      'rich-textarea [contenteditable="true"]',
      'div.ql-editor[contenteditable="true"]',
      '.text-input-field [contenteditable="true"]',
      '.text-input-field_textarea-wrapper [contenteditable="true"]',
      'textarea[aria-label*="prompt"]',
      'textarea[placeholder]',
      'main [contenteditable="true"]',
    ],
    sendSelectors: [
      'button[aria-label*="Send message"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="Submit"]',
      'button[mattooltip*="Send"]',
      'button.send-button',
      '.send-button-container button',
      'input-area-v2 button[aria-label*="Send"]',
    ],
    uploadInputSelectors: [
      'input[type="file"][accept*="image"]',
      'input[type="file"]',
    ],
    attachButtonSelectors: [
      'button[aria-label*="Upload"]',
      'button[aria-label*="upload"]',
      'button[aria-label*="Insert"]',
      'button[aria-label*="Add image"]',
      'button[aria-label*="add image"]',
      'button[mattooltip*="Upload"]',
      'button[title*="Upload"]',
    ],
    attachTextHints: ['upload', 'insert', 'image', 'file', 'add image'],
    hiddenUploadTriggerSelectors: [
      'button.hidden-local-file-image-selector-button',
      'button.hidden-local-upload-button',
      'button[xapfileselectortrigger]',
    ],
    removeAttachmentSelectors: [
      'button[aria-label*="Remove"]',
      'button[aria-label*="remove"]',
      'button[aria-label*="Cancel"]',
      'button[aria-label*="cancel"]',
      'button[aria-label*="Close"]',
      'input-area-v2 button[aria-label*="Remove"]',
      '.input-chip button',
      '.attachment-chip button',
    ],
    outputSelectors: [
      'message-content',
      '.model-response-text',
      'main article',
    ],
    messageSelectors: [
      'message-content',
      '.model-response-text',
    ],
    loginSelectors: ['a[href*="ServiceLogin"]', 'button[aria-label*="Sign in"]'],
    loginTextHints: ['Sign in', '登录', 'Continue to Gemini'],
  },
};

export function createEmptyStatus(site: SiteKey): SiteStatus {
  return {
    site,
    state: 'loading',
    inputAvailable: false,
    sendAvailable: false,
    loggedIn: false,
    hasAssistantOutput: false,
    pageUrl: SITE_DEFINITIONS[site].url,
    note: t('status.waitingConnection'),
    lastSeen: 0,
  };
}

export function createDefaultSnapshot(): WorkspaceSnapshot {
  return {
    order: [...DEFAULT_ORDER],
    statuses: {
      claude: createEmptyStatus('claude'),
      chatgpt: createEmptyStatus('chatgpt'),
      gemini: createEmptyStatus('gemini'),
    },
  };
}

export function sanitizeOrder(order?: SiteKey[] | null): SiteKey[] {
  if (!order?.length) {
    return [...DEFAULT_ORDER];
  }

  const unique = order.filter(
    (site, index) => SITE_KEYS.includes(site) && order.indexOf(site) === index,
  );
  const missing = SITE_KEYS.filter((site) => !unique.includes(site));
  return [...unique, ...missing];
}

export function getSiteFromUrl(url: string): SiteKey | null {
  if (!url) {
    return null;
  }

  const normalized = url.toLowerCase();
  if (normalized.includes('claude.ai')) {
    return 'claude';
  }
  if (normalized.includes('chatgpt.com')) {
    return 'chatgpt';
  }
  if (normalized.includes('gemini.google.com')) {
    return 'gemini';
  }
  return null;
}

export function getControllerUrl() {
  return browser.runtime.getURL(CONTROLLER_PATH);
}

export function getStatusLabel(status: SiteStatus) {
  if (status.state === 'ready') {
    return t('status.loggedIn');
  }
  if (status.state === 'login_required') {
    return t('status.loginRequired');
  }
  return t('status.loading');
}

export function getStatusTone(status: SiteStatus) {
  if (status.state === 'ready') {
    return 'ready';
  }
  if (status.state === 'login_required') {
    return 'warning';
  }
  return 'muted';
}

export function getDefaultLayoutRect(source?: {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}): LayoutRect {
  const viewportLeft = Math.round(source?.left ?? 0);
  const viewportTop = Math.round(source?.top ?? 0);
  const viewportWidth = Math.max(720, Math.round(source?.width ?? 1720));
  const viewportHeight = Math.max(600, Math.round(source?.height ?? 1180));

  // Smaller screens use more available space to maximize site window sizes
  const widthRatio = viewportWidth <= 1440 ? 0.995 : viewportWidth <= 1920 ? 0.99 : 0.985;
  const heightRatio = viewportHeight <= 900 ? 0.985 : viewportHeight <= 1080 ? 0.975 : 0.965;

  const targetWidth = Math.round(viewportWidth * widthRatio);
  const targetHeight = Math.round(viewportHeight * heightRatio);

  return {
    left: viewportLeft + Math.round((viewportWidth - targetWidth) / 2),
    top: viewportTop + Math.round((viewportHeight - targetHeight) / 2),
    width: targetWidth,
    height: targetHeight,
  };
}

export function getWorkspaceLayout(
  bounds: LayoutRect,
  order: SiteKey[],
): Record<WorkspaceWindowKey, LayoutRect> {
  const shortestSide = Math.min(bounds.width, bounds.height);

  // Adaptive padding/gap: smaller screens get tighter spacing
  const padding = clamp(Math.round(shortestSide * 0.012), 6, 28);
  const gap = clamp(Math.round(shortestSide * 0.008), 4, 16);

  // Controller scales with resolution — must stay comfortably usable
  const controllerWidth = clamp(Math.round(bounds.width * 0.45), 640, 1080);
  const controllerHeight = clamp(Math.round(bounds.height * 0.48), 480, 720);

  const innerWidth = bounds.width - padding * 2;
  const innerHeight = bounds.height - padding * 2;

  // On shorter screens give slightly more to top row (where 2 sites live)
  const topRatio = bounds.height <= 900 ? 0.52 : 0.55;
  const topHeight = Math.round(innerHeight * topRatio);
  const bottomHeight = innerHeight - topHeight - gap;
  const topWidth = Math.round((innerWidth - gap) / 2);

  const rects: Record<WorkspaceWindowKey, LayoutRect> = {
    claude: { left: 0, top: 0, width: 0, height: 0 },
    chatgpt: { left: 0, top: 0, width: 0, height: 0 },
    gemini: { left: 0, top: 0, width: 0, height: 0 },
    controller: { left: 0, top: 0, width: controllerWidth, height: controllerHeight },
  };

  rects[order[0]] = {
    left: bounds.left + padding,
    top: bounds.top + padding,
    width: topWidth,
    height: topHeight,
  };
  rects[order[1]] = {
    left: bounds.left + padding + topWidth + gap,
    top: bounds.top + padding,
    width: topWidth,
    height: topHeight,
  };
  rects[order[2]] = {
    left: bounds.left + padding,
    top: bounds.top + padding + topHeight + gap,
    width: innerWidth,
    height: bottomHeight,
  };

  rects.controller = {
    left: Math.round(bounds.left + bounds.width / 2 - controllerWidth / 2),
    top: Math.round(bounds.top + padding + topHeight - controllerHeight / 2),
    width: controllerWidth,
    height: controllerHeight,
  };

  return rects;
}

export function isRectOnScreen(
  rect: LayoutRect,
  displays: Array<{ left: number; top: number; width: number; height: number }>,
): boolean {
  if (displays.length === 0) return true;

  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  return displays.some(
    (d) =>
      centerX >= d.left &&
      centerX < d.left + d.width &&
      centerY >= d.top &&
      centerY < d.top + d.height,
  );
}

export function clampRectToDisplay(
  rect: LayoutRect,
  display: { left: number; top: number; width: number; height: number },
): LayoutRect {
  const maxLeft = display.left + display.width - rect.width;
  const maxTop = display.top + display.height - rect.height;
  return {
    left: Math.round(Math.max(display.left, Math.min(rect.left, maxLeft))),
    top: Math.round(Math.max(display.top, Math.min(rect.top, maxTop))),
    width: Math.min(rect.width, display.width),
    height: Math.min(rect.height, display.height),
  };
}

export function shallowEqualStatus(a: SiteStatus, b: SiteStatus) {
  return (
    a.state === b.state &&
    a.inputAvailable === b.inputAvailable &&
    a.sendAvailable === b.sendAvailable &&
    a.loggedIn === b.loggedIn &&
    a.hasAssistantOutput === b.hasAssistantOutput &&
    a.pageUrl === b.pageUrl &&
    a.note === b.note
  );
}

export function isLayoutRect(value: unknown): value is LayoutRect {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<LayoutRect>;
  return (
    Number.isFinite(candidate.left) &&
    Number.isFinite(candidate.top) &&
    Number.isFinite(candidate.width) &&
    Number.isFinite(candidate.height) &&
    Number(candidate.width) >= 200 &&
    Number(candidate.height) >= 120
  );
}

export function sanitizeWindowRects(value: unknown): WorkspaceWindowRects {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const next: WorkspaceWindowRects = {};
  for (const key of [...SITE_KEYS, 'controller'] as WorkspaceWindowKey[]) {
    const rect = (value as Record<string, unknown>)[key];
    if (isLayoutRect(rect)) {
      next[key] = {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }
  }

  return next;
}

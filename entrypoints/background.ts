import {
  DEFAULT_ORDER,
  LAYOUT_STORAGE_KEY,
  ORDER_STORAGE_KEY,
  SITE_DEFINITIONS,
  SITE_KEYS,
  WINDOW_RECTS_STORAGE_KEY,
  createDefaultSnapshot,
  getControllerUrl,
  getDefaultLayoutRect,
  getSiteFromUrl,
  getWorkspaceLayout,
  sanitizeWindowRects,
  sanitizeOrder,
  shallowEqualStatus,
  type ImageAttachment,
  type LayoutRect,
  type SiteKey,
  type SiteStatus,
  type WindowTarget,
  type WorkspaceSnapshot,
  type WorkspaceWindowKey,
  type WorkspaceWindowRects,
} from '@/utils/workspace';

type PromptDispatchResult = {
  site: SiteKey;
  ok: boolean;
  reason: string;
};

const snapshot = createDefaultSnapshot();
const targets: Partial<Record<WorkspaceWindowKey, WindowTarget>> = {};
let layoutBounds = getDefaultLayoutRect();
let savedWindowRects: WorkspaceWindowRects = {};
let initPromise: Promise<void> | null = null;
let persistBoundsTimer: ReturnType<typeof setTimeout> | undefined;

export default defineBackground(() => {
  void ensureInitialized();

  browser.runtime.onMessage.addListener((message, sender) => {
    if (!message?.type) {
      return undefined;
    }

    switch (message.type) {
      case 'workspace/get-snapshot':
        return ensureInitialized().then(() => getSnapshot());

      case 'workspace/open':
        return openWorkspace('restore');

      case 'workspace/rearrange':
        return handleRearrange(message.order);

      case 'workspace/arrange':
        return openWorkspace('arrange');

      case 'workspace/send-prompt':
        return dispatchPrompt(message.prompt, message.attachments);

      case 'workspace/controller-ready':
        registerTarget('controller', sender);
        return ensureInitialized().then(() => getSnapshot());

      case 'site/forward-message':
        return forwardMessage(String(message.text ?? ''), message.targetSite as SiteKey);

      case 'site/status':
        return handleSiteStatus(message.site, message.status, sender).then(() => ({ ok: true }));

      default:
        return undefined;
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    clearTargetByTabId(tabId);
  });

  browser.windows.onRemoved.addListener((windowId) => {
    clearTargetByWindowId(windowId);
  });

  browser.windows.onBoundsChanged.addListener((windowInfo) => {
    void handleWindowBoundsChanged(windowInfo);
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
      const site = getSiteFromUrl(changeInfo.url);
      if (site && tab.windowId) {
        targets[site] = { tabId, windowId: tab.windowId };
      }
      if (changeInfo.url === getControllerUrl() && tab.windowId) {
        targets.controller = { tabId, windowId: tab.windowId };
      }
    }
  });
});

async function ensureInitialized() {
  if (!initPromise) {
    initPromise = (async () => {
      const stored = (await browser.storage.local.get([
        ORDER_STORAGE_KEY,
        LAYOUT_STORAGE_KEY,
        WINDOW_RECTS_STORAGE_KEY,
      ])) as Record<string, SiteKey[] | LayoutRect | WorkspaceWindowRects | undefined>;

      snapshot.order = sanitizeOrder(stored[ORDER_STORAGE_KEY] as SiteKey[] | undefined);
      layoutBounds = getDefaultLayoutRect(stored[LAYOUT_STORAGE_KEY] as LayoutRect | undefined);
      savedWindowRects = sanitizeWindowRects(stored[WINDOW_RECTS_STORAGE_KEY]);

      const savedBounds = getLayoutBoundsFromRects(savedWindowRects);
      if (savedBounds) {
        layoutBounds = savedBounds;
      }
    })();
  }

  await initPromise;
}

function getSnapshot(): WorkspaceSnapshot {
  return {
    order: [...snapshot.order],
    statuses: {
      claude: { ...snapshot.statuses.claude },
      chatgpt: { ...snapshot.statuses.chatgpt },
      gemini: { ...snapshot.statuses.gemini },
    },
  };
}

async function persistWorkspaceState() {
  await browser.storage.local.set({
    [ORDER_STORAGE_KEY]: snapshot.order,
    [LAYOUT_STORAGE_KEY]: layoutBounds,
    [WINDOW_RECTS_STORAGE_KEY]: savedWindowRects,
  });
}

function schedulePersistWorkspaceState() {
  if (persistBoundsTimer) {
    clearTimeout(persistBoundsTimer);
  }

  persistBoundsTimer = setTimeout(() => {
    persistBoundsTimer = undefined;
    void persistWorkspaceState();
  }, 180);
}

async function broadcastSnapshot() {
  try {
    await browser.runtime.sendMessage({
      type: 'workspace/snapshot',
      snapshot: getSnapshot(),
    });
  } catch {
    // No active UI listener is fine.
  }
}

function registerTarget(key: WorkspaceWindowKey, sender: { tab?: { id?: number; windowId?: number } }) {
  if (!sender.tab?.id || !sender.tab.windowId) {
    return;
  }

  targets[key] = {
    tabId: sender.tab.id,
    windowId: sender.tab.windowId,
  };
}

function clearTargetByTabId(tabId: number) {
  for (const key of [...SITE_KEYS, 'controller'] as WorkspaceWindowKey[]) {
    if (targets[key]?.tabId === tabId) {
      delete targets[key];
    }
  }
}

function clearTargetByWindowId(windowId: number) {
  for (const key of [...SITE_KEYS, 'controller'] as WorkspaceWindowKey[]) {
    if (targets[key]?.windowId === windowId) {
      delete targets[key];
    }
  }
}

async function handleRearrange(order: SiteKey[]) {
  await ensureInitialized();
  snapshot.order = sanitizeOrder(order);
  return openWorkspace('reorder');
}

async function openWorkspace(mode: 'restore' | 'arrange' | 'reorder') {
  await ensureInitialized();
  const layout = await resolveWorkspaceLayout(mode);
  for (const site of DEFAULT_ORDER) {
    await ensureSiteWindow(site, layout[site]);
  }
  await ensureControllerWindow(layout.controller);
  await persistWorkspaceState();
  await broadcastSnapshot();
  return getSnapshot();
}

async function resolveWorkspaceLayout(mode: 'restore' | 'arrange' | 'reorder') {
  if (mode === 'arrange') {
    await refreshLayoutBoundsFromCurrentWindow();
    savedWindowRects = getWorkspaceLayout(layoutBounds, snapshot.order);
    return savedWindowRects as Record<WorkspaceWindowKey, LayoutRect>;
  }

  if (mode === 'reorder') {
    const currentBounds = getLayoutBoundsFromRects(savedWindowRects);
    if (currentBounds) {
      layoutBounds = currentBounds;
    } else {
      await refreshLayoutBoundsFromCurrentWindow();
    }

    savedWindowRects = getWorkspaceLayout(layoutBounds, snapshot.order);
    return savedWindowRects as Record<WorkspaceWindowKey, LayoutRect>;
  }

  if (hasCompleteSavedLayout(savedWindowRects)) {
    return savedWindowRects as Record<WorkspaceWindowKey, LayoutRect>;
  }

  const savedBounds = getLayoutBoundsFromRects(savedWindowRects);
  if (savedBounds) {
    layoutBounds = savedBounds;
  } else {
    await refreshLayoutBoundsFromCurrentWindow();
  }

  const generatedLayout = getWorkspaceLayout(layoutBounds, snapshot.order);
  savedWindowRects = {
    ...generatedLayout,
    ...savedWindowRects,
  };
  return {
    ...generatedLayout,
    ...savedWindowRects,
  };
}

async function refreshLayoutBoundsFromCurrentWindow() {
  try {
    const focused = await browser.windows.getLastFocused();
    const displayBounds = await getDisplayBoundsForWindow(focused);
    if (displayBounds) {
      layoutBounds = getDefaultLayoutRect(displayBounds);
      return;
    }

    if ((focused.width ?? 0) >= 900 && (focused.height ?? 0) >= 700) {
      layoutBounds = getDefaultLayoutRect({
        left: focused.left,
        top: focused.top,
        width: focused.width,
        height: focused.height,
      });
    }
  } catch {
    layoutBounds = getDefaultLayoutRect(layoutBounds);
  }
}

async function getDisplayBoundsForWindow(windowInfo: {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}) {
  try {
    const displays = await browser.system.display.getInfo();
    const activeDisplays = displays.filter((display) => display.isEnabled);
    if (!activeDisplays.length) {
      return undefined;
    }

    const left = windowInfo.left ?? 0;
    const top = windowInfo.top ?? 0;
    const width = Math.max(windowInfo.width ?? 0, 1);
    const height = Math.max(windowInfo.height ?? 0, 1);
    const centerX = left + width / 2;
    const centerY = top + height / 2;

    const currentDisplay =
      activeDisplays.find((display) => isPointInsideBounds(centerX, centerY, display.bounds)) ??
      activeDisplays.find((display) => display.isPrimary) ??
      activeDisplays[0];

    return currentDisplay?.workArea
      ? {
          left: currentDisplay.workArea.left,
          top: currentDisplay.workArea.top,
          width: currentDisplay.workArea.width,
          height: currentDisplay.workArea.height,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

async function handleWindowBoundsChanged(windowInfo: {
  id?: number;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  type?: string;
}) {
  if (!windowInfo.id || windowInfo.type !== 'popup') {
    return;
  }

  const key = getTargetKeyByWindowId(windowInfo.id);
  const rect = toLayoutRect(windowInfo);
  if (!key || !rect) {
    return;
  }

  savedWindowRects[key] = rect;
  const currentBounds = getLayoutBoundsFromRects(savedWindowRects);
  if (currentBounds) {
    layoutBounds = currentBounds;
  }
  schedulePersistWorkspaceState();
}

function getTargetKeyByWindowId(windowId: number) {
  for (const key of [...SITE_KEYS, 'controller'] as WorkspaceWindowKey[]) {
    if (targets[key]?.windowId === windowId) {
      return key;
    }
  }

  return undefined;
}

function toLayoutRect(windowInfo: {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}) {
  if (
    !Number.isFinite(windowInfo.left) ||
    !Number.isFinite(windowInfo.top) ||
    !Number.isFinite(windowInfo.width) ||
    !Number.isFinite(windowInfo.height)
  ) {
    return undefined;
  }

  return {
    left: Math.round(windowInfo.left ?? 0),
    top: Math.round(windowInfo.top ?? 0),
    width: Math.round(windowInfo.width ?? 0),
    height: Math.round(windowInfo.height ?? 0),
  };
}

function getLayoutBoundsFromRects(rects: WorkspaceWindowRects) {
  const values = Object.values(rects);
  if (!values.length) {
    return undefined;
  }

  const left = Math.min(...values.map((rect) => rect.left));
  const top = Math.min(...values.map((rect) => rect.top));
  const right = Math.max(...values.map((rect) => rect.left + rect.width));
  const bottom = Math.max(...values.map((rect) => rect.top + rect.height));

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

function hasCompleteSavedLayout(rects: WorkspaceWindowRects): rects is Record<WorkspaceWindowKey, LayoutRect> {
  return Boolean(
    rects.claude &&
      rects.chatgpt &&
      rects.gemini &&
      rects.controller,
  );
}

function isPointInsideBounds(
  x: number,
  y: number,
  bounds: { left: number; top: number; width: number; height: number },
) {
  return (
    x >= bounds.left &&
    x < bounds.left + bounds.width &&
    y >= bounds.top &&
    y < bounds.top + bounds.height
  );
}

async function resolveControllerTarget() {
  const current = targets.controller;
  if (current?.tabId && current.windowId && (await isTabAlive(current.tabId))) {
    return current;
  }

  const controllerUrl = getControllerUrl();
  const tabs = await browser.tabs.query({ url: controllerUrl });
  const tab = tabs[0];
  if (tab?.id && tab.windowId) {
    targets.controller = { tabId: tab.id, windowId: tab.windowId };
    return targets.controller;
  }

  return undefined;
}

async function resolveSiteTarget(site: SiteKey) {
  const current = targets[site];
  if (current?.tabId && current.windowId && (await isTabAlive(current.tabId))) {
    return current;
  }

  const tabs = await browser.tabs.query({ url: SITE_DEFINITIONS[site].urlPatterns });

  for (const tab of tabs) {
    if (!tab.id || !tab.windowId) {
      continue;
    }

    const nextTarget = { tabId: tab.id, windowId: tab.windowId };
    try {
      const window = await browser.windows.get(tab.windowId);
      if (window.type === 'popup') {
        targets[site] = nextTarget;
        return nextTarget;
      }
    } catch {
      // Skip dead windows.
    }
  }

  return undefined;
}

async function ensureControllerWindow(rect: LayoutRect) {
  const existing = await resolveControllerTarget();
  const controllerUrl = getControllerUrl();

  if (existing?.windowId && existing.tabId) {
    await browser.tabs.update(existing.tabId, { active: true });
    await browser.windows.update(existing.windowId, {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      focused: true,
    });
    savedWindowRects.controller = rect;
    return existing;
  }

  const created = await browser.windows.create({
    url: controllerUrl,
    type: 'popup',
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    focused: true,
  });

  if (!created) {
    return undefined;
  }

  const tabId = created.tabs?.[0]?.id;
  if (created.id && tabId) {
    targets.controller = { windowId: created.id, tabId };
    savedWindowRects.controller = rect;
  }
  return targets.controller;
}

async function ensureSiteWindow(site: SiteKey, rect: LayoutRect) {
  const existing = await resolveSiteTarget(site);

  if (existing?.windowId && existing.tabId) {
    await browser.windows.update(existing.windowId, {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      focused: false,
    });
    savedWindowRects[site] = rect;

    try {
      const tab = await browser.tabs.get(existing.tabId);
      if (getSiteFromUrl(tab.url ?? '') !== site) {
        await browser.tabs.update(existing.tabId, { url: SITE_DEFINITIONS[site].url });
      }
    } catch {
      delete targets[site];
    }

    return existing;
  }

  const created = await browser.windows.create({
    url: SITE_DEFINITIONS[site].url,
    type: 'popup',
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    focused: false,
  });

  if (!created) {
    return undefined;
  }

  const tabId = created.tabs?.[0]?.id;
  if (created.id && tabId) {
    targets[site] = { windowId: created.id, tabId };
    savedWindowRects[site] = rect;
  }
  return targets[site];
}

async function dispatchPrompt(prompt: string, attachments?: ImageAttachment[]) {
  await ensureInitialized();

  const normalized = String(prompt ?? '').trim();
  const safeAttachments = (attachments ?? []).filter((attachment) => attachment?.bytes?.length);
  if (!normalized && safeAttachments.length === 0) {
    return {
      ok: false,
      results: [] as PromptDispatchResult[],
      snapshot: getSnapshot(),
    };
  }

  await openWorkspace('restore');

  const results = await Promise.all(
    DEFAULT_ORDER.map((site) => sendPromptToSite(site, normalized, safeAttachments)),
  );

  await broadcastSnapshot();

  return {
    ok: results.some((result) => result.ok),
    results,
    snapshot: getSnapshot(),
  };
}

async function sendPromptToSite(
  site: SiteKey,
  prompt: string,
  attachments: ImageAttachment[],
): Promise<PromptDispatchResult> {
  const layout = getWorkspaceLayout(layoutBounds, snapshot.order);
  let reason = '页面尚未就绪';

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const target = await ensureSiteWindow(site, layout[site]);
    if (!target?.tabId) {
      await sleep(600);
      continue;
    }

    try {
      const response = (await browser.tabs.sendMessage(target.tabId, {
        type: 'site/submit-prompt',
        prompt,
        attachments,
        site,
      })) as { ok?: boolean; reason?: string } | undefined;

      if (response?.ok) {
        return {
          site,
          ok: true,
          reason: '已发送',
        };
      }

      reason = response?.reason ?? reason;
    } catch {
      reason = '页面连接失败';
    }

    await sleep(attempt === 0 ? 1200 : 700);
  }

  return {
    site,
    ok: false,
    reason,
  };
}

async function forwardMessage(text: string, targetSite: SiteKey) {
  await ensureInitialized();

  const normalized = text.trim();
  if (!normalized || !SITE_KEYS.includes(targetSite)) {
    return { ok: false, reason: '无效的转发请求' };
  }

  const result = await sendPromptToSite(targetSite, normalized, []);
  await broadcastSnapshot();
  return result;
}

async function handleSiteStatus(
  site: SiteKey,
  status: SiteStatus,
  sender: { tab?: { id?: number; windowId?: number } },
) {
  await ensureInitialized();
  registerTarget(site, sender);

  const nextStatus: SiteStatus = {
    ...snapshot.statuses[site],
    ...status,
    site,
    lastSeen: Date.now(),
  };

  if (shallowEqualStatus(snapshot.statuses[site], nextStatus)) {
    snapshot.statuses[site] = nextStatus;
    return;
  }

  snapshot.statuses[site] = nextStatus;
  await broadcastSnapshot();
}

async function isTabAlive(tabId: number) {
  try {
    await browser.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

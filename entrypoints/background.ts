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
  isRectOnScreen,
  clampRectToDisplay,
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
import { t, loadLocale } from '@/utils/i18n';

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
let isRaisingWindows = false;

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
    const wasController = targets.controller?.tabId === tabId;
    clearTargetByTabId(tabId);
    if (wasController) {
      void closeAllSiteWindows();
    }
  });

  browser.windows.onRemoved.addListener((windowId) => {
    const wasController = targets.controller?.windowId === windowId;
    clearTargetByWindowId(windowId);
    if (wasController) {
      void closeAllSiteWindows();
    } else {
      // Check if the closed window was the controller by querying —
      // targets may be empty after a service worker restart.
      void checkAndCloseIfControllerGone();
    }
  });

  browser.windows.onBoundsChanged.addListener((windowInfo) => {
    void handleWindowBoundsChanged(windowInfo);
  });

  browser.windows.onFocusChanged.addListener((windowId) => {
    if (isRaisingWindows || windowId === browser.windows.WINDOW_ID_NONE) {
      return;
    }

    // Check if the focused window belongs to our workspace
    const allKeys = [...SITE_KEYS, 'controller'] as WorkspaceWindowKey[];
    const isOurWindow = allKeys.some((key) => targets[key]?.windowId === windowId);
    if (isOurWindow) {
      void raiseAllWorkspaceWindows(windowId);
    }
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
      await loadLocale();

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
  // Always determine the target display from the focused window.
  const targetDisplay = await getTargetDisplayWorkArea();

  if (mode === 'arrange') {
    layoutBounds = getDefaultLayoutRect(targetDisplay);
    savedWindowRects = getWorkspaceLayout(layoutBounds, snapshot.order);
    return savedWindowRects as Record<WorkspaceWindowKey, LayoutRect>;
  }

  if (mode === 'reorder') {
    layoutBounds = getDefaultLayoutRect(targetDisplay);
    savedWindowRects = getWorkspaceLayout(layoutBounds, snapshot.order);
    return savedWindowRects as Record<WorkspaceWindowKey, LayoutRect>;
  }

  // Restore mode: prefer saved rects, but validate they are on-screen.
  if (hasCompleteSavedLayout(savedWindowRects)) {
    const displays = await getAllDisplayWorkAreas();
    const allOnScreen = Object.values(savedWindowRects).every(
      (rect) => rect && isRectOnScreen(rect, displays),
    );
    if (allOnScreen) {
      return savedWindowRects as Record<WorkspaceWindowKey, LayoutRect>;
    }
    // Saved layout is off-screen (display changed) — regenerate on the target display.
    layoutBounds = getDefaultLayoutRect(targetDisplay);
    savedWindowRects = getWorkspaceLayout(layoutBounds, snapshot.order);
    return savedWindowRects as Record<WorkspaceWindowKey, LayoutRect>;
  }

  // No complete saved layout — generate fresh on the target display.
  layoutBounds = getDefaultLayoutRect(targetDisplay);
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

async function getTargetDisplayWorkArea(): Promise<LayoutRect> {
  try {
    const focused = await browser.windows.getLastFocused();
    const displays = await getAllDisplayWorkAreas();

    if (displays.length > 0) {
      const centerX = (focused.left ?? 0) + Math.max(focused.width ?? 0, 1) / 2;
      const centerY = (focused.top ?? 0) + Math.max(focused.height ?? 0, 1) / 2;

      const match = displays.find(
        (d) => centerX >= d.left && centerX < d.left + d.width && centerY >= d.top && centerY < d.top + d.height,
      );
      if (match) return match;

      // Fallback to primary or first display
      return displays[0];
    }

    // No display API — use the focused window itself if it's large enough
    if ((focused.width ?? 0) >= 900 && (focused.height ?? 0) >= 700) {
      return {
        left: focused.left ?? 0,
        top: focused.top ?? 0,
        width: focused.width ?? 1720,
        height: focused.height ?? 1180,
      };
    }
  } catch {
    // Ignore
  }

  return layoutBounds;
}

async function getAllDisplayWorkAreas(): Promise<LayoutRect[]> {
  try {
    const displays = await browser.system.display.getInfo();
    return displays
      .filter((d) => d.isEnabled && d.workArea)
      .map((d) => ({
        left: d.workArea.left,
        top: d.workArea.top,
        width: d.workArea.width,
        height: d.workArea.height,
      }));
  } catch {
    return [];
  }
}

async function closeWindows(windowIds: number[]) {
  for (const id of windowIds) {
    try {
      await browser.windows.remove(id);
    } catch {
      // Already closed.
    }
  }
}

/**
 * Close all site popup windows by querying tabs with site URLs.
 * Does not rely on in-memory targets — works even after service worker restart.
 */
async function closeAllSiteWindows() {
  const windowIdsToClose = new Set<number>();

  // Collect from in-memory targets first
  for (const site of SITE_KEYS) {
    const wid = targets[site]?.windowId;
    if (wid != null) windowIdsToClose.add(wid);
    delete targets[site];
  }
  delete targets.controller;

  // Also query tabs by URL to catch windows missed after SW restart
  for (const site of SITE_KEYS) {
    try {
      const tabs = await browser.tabs.query({ url: SITE_DEFINITIONS[site].urlPatterns });
      for (const tab of tabs) {
        if (tab.windowId != null) {
          // Only close popup windows (not regular browser windows the user opened)
          try {
            const win = await browser.windows.get(tab.windowId);
            if (win.type === 'popup') {
              windowIdsToClose.add(tab.windowId);
            }
          } catch { /* already closed */ }
        }
      }
    } catch { /* ignore */ }
  }

  await closeWindows([...windowIdsToClose]);
}

/**
 * After a window is closed, check if the controller still exists.
 * If not, close all site windows. Handles cases where targets was lost
 * due to service worker restart.
 */
async function checkAndCloseIfControllerGone() {
  try {
    const controllerUrl = getControllerUrl();
    const tabs = await browser.tabs.query({ url: controllerUrl });
    if (tabs.length === 0) {
      // Controller is gone — close all site windows
      await closeAllSiteWindows();
    }
  } catch { /* ignore */ }
}

async function raiseAllWorkspaceWindows(activeWindowId: number) {
  if (isRaisingWindows) return;
  isRaisingWindows = true;

  try {
    // Collect all workspace window IDs except the one the user clicked
    const allKeys = [...SITE_KEYS, 'controller'] as WorkspaceWindowKey[];
    const otherWindowIds = allKeys
      .map((key) => targets[key]?.windowId)
      .filter((id): id is number => id != null && id !== activeWindowId);

    // Briefly focus each other window to bring it to the foreground
    for (const id of otherWindowIds) {
      try {
        await browser.windows.update(id, { focused: true });
      } catch {
        // Window may have been closed.
      }
    }

    // Re-focus the window the user actually clicked, so it stays on top
    try {
      await browser.windows.update(activeWindowId, { focused: true });
    } catch {
      // Window may have been closed.
    }
  } finally {
    // Cooldown to prevent re-entry from the focus events we just caused
    setTimeout(() => {
      isRaisingWindows = false;
    }, 600);
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

  // Unique ID so content scripts can deduplicate if a message arrives more than once
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const results = await Promise.all(
    DEFAULT_ORDER.map((site) => sendPromptToSite(site, normalized, safeAttachments, requestId)),
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
  requestId: string,
): Promise<PromptDispatchResult> {
  const layout = getWorkspaceLayout(layoutBounds, snapshot.order);

  // First, make sure the window exists. Retry window creation only (not the message).
  let target: WindowTarget | undefined;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    target = await ensureSiteWindow(site, layout[site]);
    if (target?.tabId) break;
    await sleep(800);
  }

  if (!target?.tabId) {
    return { site, ok: false, reason: t('bg.pageNotReady') };
  }

  // Send the message exactly ONCE. No retry after delivery — retrying causes duplicates.
  try {
    const response = (await browser.tabs.sendMessage(
      target.tabId,
      {
        type: 'site/submit-prompt',
        requestId,
        prompt,
        attachments,
        site,
      },
      { frameId: 0 },
    )) as { ok?: boolean; reason?: string } | undefined;

    return {
      site,
      ok: Boolean(response?.ok),
      reason: response?.ok ? t('bg.sent') : (response?.reason ?? t('bg.unknownError')),
    };
  } catch {
    return { site, ok: false, reason: t('bg.connectionFailed') };
  }
}

async function forwardMessage(text: string, targetSite: SiteKey) {
  await ensureInitialized();

  const normalized = text.trim();
  if (!normalized || !SITE_KEYS.includes(targetSite)) {
    return { ok: false, reason: 'Invalid forward request' };
  }

  const requestId = `fwd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const result = await sendPromptToSite(targetSite, normalized, [], requestId);
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

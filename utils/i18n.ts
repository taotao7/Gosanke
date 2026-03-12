export type Locale = 'zh' | 'en';

const LOCALE_STORAGE_KEY = 'gosanke.locale';
let currentLocale: Locale | null = null;
const listeners: Array<(locale: Locale) => void> = [];

function detectLocale(): Locale {
  try {
    const lang = navigator.language || 'en';
    return lang.startsWith('zh') ? 'zh' : 'en';
  } catch {
    return 'en';
  }
}

export function getLocale(): Locale {
  if (currentLocale) return currentLocale;
  currentLocale = detectLocale();
  return currentLocale;
}

export async function loadLocale(): Promise<Locale> {
  try {
    const stored = await browser.storage.local.get(LOCALE_STORAGE_KEY);
    const value = stored[LOCALE_STORAGE_KEY];
    if (value === 'zh' || value === 'en') {
      currentLocale = value;
    }
  } catch {
    // storage not available (e.g. content script context) — use detected locale
  }
  return getLocale();
}

export async function setLocale(locale: Locale): Promise<void> {
  currentLocale = locale;
  try {
    await browser.storage.local.set({ [LOCALE_STORAGE_KEY]: locale });
  } catch {
    // ignore
  }
  for (const fn of listeners) {
    fn(locale);
  }
}

export function onLocaleChange(fn: (locale: Locale) => void): () => void {
  listeners.push(fn);
  return () => {
    const index = listeners.indexOf(fn);
    if (index >= 0) listeners.splice(index, 1);
  };
}

const messages: Record<string, Record<Locale, string>> = {
  // --- Status ---
  'status.loggedIn': { zh: '已登录', en: 'Logged in' },
  'status.loginRequired': { zh: '需要登录', en: 'Login required' },
  'status.loading': { zh: '页面加载中', en: 'Loading' },
  'status.waitingConnection': { zh: '等待页面连接', en: 'Waiting for connection' },
  'status.inputAndOutput': { zh: '已检测到聊天输入框与回复内容', en: 'Chat input and output detected' },
  'status.inputReady': { zh: '输入框已就绪，等待发送', en: 'Input ready' },
  'status.loginNeeded': { zh: '页面存在登录入口，需先完成登录', en: 'Login page detected, please log in first' },
  'status.waitingInput': { zh: '等待聊天输入框出现', en: 'Waiting for chat input' },
  'status.pageLoading': { zh: '页面仍在加载', en: 'Page still loading' },

  // --- Slot labels ---
  'slot.topLeft': { zh: '左上', en: 'Top Left' },
  'slot.topRight': { zh: '右上', en: 'Top Right' },
  'slot.bottom': { zh: '底部', en: 'Bottom' },

  // --- Controller ---
  'workspace.note': {
    zh: '拖拽卡片调整布局，输入后同步发送至三个平台。',
    en: 'Drag cards to rearrange. Input is sent to all three platforms.',
  },
  'action.rearrange': { zh: '重新排版', en: 'Rearrange' },
  'composer.addImage': { zh: '添加图片', en: 'Add Image' },
  'composer.pasteOrAttach': { zh: '可粘贴或选择图片', en: 'Paste or select images' },
  'composer.clearImages': { zh: '清空', en: 'Clear' },
  'composer.selectedN': { zh: '已选 {0} 张图片', en: '{0} image(s) selected' },
  'composer.placeholder': {
    zh: '输入提示词，同时发送给 Claude / ChatGPT / Gemini …',
    en: 'Type a prompt to send to Claude / ChatGPT / Gemini …',
  },
  'composer.idleHint': {
    zh: '暂无回复输出',
    en: 'No replies yet',
  },
  'composer.activeHint': { zh: '已检测到回复输出', en: 'Replies detected' },
  'action.sending': { zh: '发送中…', en: 'Sending…' },
  'action.sendToAll': { zh: '发送', en: 'Send' },

  // --- Send reports ---
  'report.dispatchingWithImages': {
    zh: '正在分发文本和图片…',
    en: 'Dispatching text and images…',
  },
  'report.dispatching': { zh: '正在分发…', en: 'Dispatching…' },
  'report.sent': { zh: '已发', en: 'Sent' },
  'report.failed': { zh: '失败', en: 'Failed' },
  'report.noResult': { zh: '未收到结果', en: 'No response' },
  'report.sendFailed': { zh: '发送失败', en: 'Send failed' },
  'report.pastedN': { zh: '已粘贴 {0} 张图片', en: 'Pasted {0} image(s)' },
  'report.noImage': { zh: '未选择图片', en: 'No images selected' },
  'report.selectedN': { zh: '已选 {0} 张图片', en: '{0} image(s) selected' },
  'report.clearedImages': { zh: '已清空图片', en: 'Images cleared' },
  'report.dragFailed': {
    zh: '顺序已改，后台未响应',
    en: 'Order changed, background not responding',
  },
  'report.arrangeFailed': { zh: '排版失败，请重试', en: 'Rearrange failed' },

  // --- Popup ---
  'popup.subtitle': { zh: '三站并发中控', en: 'Multi-Site Controller' },
  'popup.opening': { zh: '启动中…', en: 'Opening…' },
  'popup.openWorkspace': { zh: '启动工作台', en: 'Open Workspace' },
  'popup.description': {
    zh: 'Claude、ChatGPT、Gemini 以独立窗口排布，中控负责统一输入和布局。',
    en: 'Claude, ChatGPT & Gemini in separate windows. The controller handles unified input and layout.',
  },
  'popup.switchLang': { zh: '切换语言', en: 'Switch language' },

  // --- Controller ---
  'workspace.title': { zh: 'Gosanke 工作台', en: 'Gosanke Workspace' },
  'workspace.slotGrid': { zh: '窗口排布', en: 'Window layout' },
  'workspace.statusStrip': { zh: '站点状态', en: 'Site status' },

  // --- Status chips ---
  'chip.inputOnline': { zh: '输入就绪', en: 'Input ready' },
  'chip.inputMissing': { zh: '输入缺失', en: 'No input' },
  'chip.hasReply': { zh: '有回复', en: 'Has reply' },
  'chip.noReply': { zh: '无回复', en: 'No reply' },

  // --- Forward ---
  'forward.sending': { zh: '发送中…', en: 'Sending…' },
  'forward.sent': { zh: '已发送', en: 'Sent' },
  'forward.failed': { zh: '失败', en: 'Failed' },

  // --- Content script errors ---
  'submit.emptyContent': { zh: '输入内容和图片都为空', en: 'No text or images to send' },
  'submit.noInput': { zh: '输入框未找到', en: 'Input not found' },
  'submit.writeFailed': { zh: '无法写入输入框', en: 'Failed to write to input' },
  'submit.noUpload': { zh: '未找到上传入口', en: 'Upload input not found' },
  'submit.uploadFailed': { zh: '上传失败', en: 'Failed to inject image' },
  'submit.sendNotReady': { zh: '发送按钮未就绪', en: 'Send button not ready' },
  'submit.invalidForward': { zh: '无效的转发请求', en: 'Invalid forward request' },

  // --- Background ---
  'bg.pageNotReady': { zh: '页面尚未就绪', en: 'Page not ready' },
  'bg.sent': { zh: '已发送', en: 'Sent' },
  'bg.unknownError': { zh: '未知错误', en: 'Unknown error' },
  'bg.connectionFailed': { zh: '页面连接失败', en: 'Connection failed' },

  // --- Language ---
  'lang.switchTo': { zh: 'EN', en: '中文' },
};

export function t(key: string, ...args: (string | number)[]): string {
  const locale = getLocale();
  const template = messages[key]?.[locale] ?? messages[key]?.['en'] ?? key;
  if (args.length === 0) return template;
  return template.replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)] ?? ''));
}

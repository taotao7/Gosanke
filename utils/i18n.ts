type Locale = 'zh' | 'en';

let cachedLocale: Locale | null = null;

function getLocale(): Locale {
  if (cachedLocale) return cachedLocale;
  try {
    const lang = navigator.language || 'en';
    cachedLocale = lang.startsWith('zh') ? 'zh' : 'en';
  } catch {
    cachedLocale = 'en';
  }
  return cachedLocale;
}

const messages: Record<string, Record<Locale, string>> = {
  // --- Status ---
  'status.loggedIn': { zh: '已登录', en: 'Logged in' },
  'status.loginRequired': { zh: '需要登录', en: 'Login required' },
  'status.loading': { zh: '页面加载中', en: 'Loading' },
  'status.waitingConnection': { zh: '等待页面连接', en: 'Waiting for connection' },
  'status.inputAndOutput': { zh: '已检测到聊天输入框与回复内容', en: 'Chat input and output detected' },
  'status.inputReady': { zh: '输入框已就绪，等待发送', en: 'Input ready, waiting to send' },
  'status.loginNeeded': { zh: '页面存在登录入口，需先完成登录', en: 'Login page detected, please log in first' },
  'status.waitingInput': { zh: '等待聊天输入框出现', en: 'Waiting for chat input to appear' },
  'status.pageLoading': { zh: '页面仍在加载', en: 'Page still loading' },

  // --- Slot labels ---
  'slot.topLeft': { zh: '左上', en: 'Top Left' },
  'slot.topRight': { zh: '右上', en: 'Top Right' },
  'slot.bottom': { zh: '底部', en: 'Bottom' },

  // --- Controller ---
  'workspace.note': {
    zh: '拖拽槽位可改摆放顺序，文本和图片会同步发到三站。',
    en: 'Drag slots to reorder. Text and images are sent to all three sites.',
  },
  'action.rearrange': { zh: '重新排版', en: 'Rearrange' },
  'composer.addImage': { zh: '添加图片', en: 'Add Image' },
  'composer.pasteOrAttach': { zh: '可粘贴或附带图片', en: 'Paste or attach images' },
  'composer.clearImages': { zh: '清空图片', en: 'Clear Images' },
  'composer.selectedN': { zh: '已选 {0} 张图片', en: '{0} image(s) selected' },
  'composer.placeholder': {
    zh: '把同一条提示词同时发给 Claude / ChatGPT / Gemini，可粘贴或附带图片',
    en: 'Send the same prompt to Claude / ChatGPT / Gemini. You can paste or attach images.',
  },
  'composer.idleHint': {
    zh: '当前没有检测到回复输出，中控输入框保持居中工作。',
    en: 'No reply output detected. Controller input stays centered.',
  },
  'composer.activeHint': { zh: '已检测到部分站点回复输出。', en: 'Reply output detected from some sites.' },
  'action.sending': { zh: '发送中...', en: 'Sending...' },
  'action.sendToAll': { zh: '发送到三站', en: 'Send to all' },

  // --- Send reports ---
  'report.dispatchingWithImages': {
    zh: '正在分发文本和图片到三个站点...',
    en: 'Dispatching text and images to all sites...',
  },
  'report.dispatching': { zh: '正在分发到三个站点...', en: 'Dispatching to all sites...' },
  'report.sent': { zh: '已发', en: 'Sent' },
  'report.failed': { zh: '失败', en: 'Failed' },
  'report.noResult': { zh: '未收到后台结果', en: 'No response from background' },
  'report.sendFailed': { zh: '发送失败，后台暂时不可用', en: 'Send failed, background unavailable' },
  'report.pastedN': { zh: '已粘贴 {0} 张图片', en: 'Pasted {0} image(s)' },
  'report.noImage': { zh: '未选择可发送的图片文件', en: 'No image files selected' },
  'report.selectedN': { zh: '已选择 {0} 张图片', en: 'Selected {0} image(s)' },
  'report.clearedImages': { zh: '已清空待发送图片', en: 'Images cleared' },
  'report.dragFailed': {
    zh: '拖拽顺序已改，但后台暂时未响应',
    en: 'Order changed but background not responding',
  },
  'report.arrangeFailed': { zh: '重新排版失败，请重试', en: 'Rearrange failed, please retry' },

  // --- Popup ---
  'popup.subtitle': { zh: '三站并发中控', en: 'Multi-Site Controller' },
  'popup.opening': { zh: '启动中...', en: 'Opening...' },
  'popup.openWorkspace': { zh: '启动工作台', en: 'Open Workspace' },
  'popup.description': {
    zh: 'Claude、ChatGPT、Gemini 会以 3 个独立窗口排布，中控浮窗负责统一输入和拖拽换位。',
    en: 'Claude, ChatGPT, and Gemini open in 3 separate windows. The controller handles unified input and layout.',
  },

  // --- Status chips ---
  'chip.inputOnline': { zh: '输入框在线', en: 'Input online' },
  'chip.inputMissing': { zh: '输入框缺失', en: 'Input missing' },
  'chip.hasReply': { zh: '有回复', en: 'Has reply' },
  'chip.noReply': { zh: '无回复', en: 'No reply' },

  // --- Forward ---
  'forward.sending': { zh: '发送中...', en: 'Sending...' },
  'forward.sent': { zh: '已发送', en: 'Sent' },
  'forward.failed': { zh: '失败', en: 'Failed' },

  // --- Content script errors ---
  'submit.emptyContent': { zh: '输入内容和图片都为空', en: 'No text or images to send' },
  'submit.noInput': { zh: '输入框未找到，可能尚未登录', en: 'Input not found, may need to log in' },
  'submit.writeFailed': { zh: '无法写入输入框', en: 'Failed to write to input' },
  'submit.noUpload': { zh: '未找到图片上传入口', en: 'Upload input not found' },
  'submit.uploadFailed': { zh: '无法把图片写入上传控件', en: 'Failed to inject image into upload' },
  'submit.sendNotReady': { zh: '发送按钮未就绪，请检查页面状态', en: 'Send button not ready' },
  'submit.invalidForward': { zh: '无效的转发请求', en: 'Invalid forward request' },
};

export function t(key: string, ...args: (string | number)[]): string {
  const locale = getLocale();
  const template = messages[key]?.[locale] ?? messages[key]?.['en'] ?? key;
  if (args.length === 0) return template;
  return template.replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)] ?? ''));
}

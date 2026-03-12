import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Gosanke Workspace',
    description: '同时向 Claude、ChatGPT、Gemini 分发提示词的浏览器扩展。',
    permissions: ['storage', 'tabs', 'system.display', 'clipboardWrite'],
    host_permissions: ['*://claude.ai/*', '*://chatgpt.com/*', '*://gemini.google.com/*'],
    action: {
      default_title: 'Gosanke Workspace',
    },
  },
});

# Gosanke Workspace

一个基于 WXT + React 的浏览器扩展，用来同时把同一条提示词发送到：

- `https://claude.ai`
- `https://chatgpt.com`
- `https://gemini.google.com`

由于这些站点通常禁止被 `iframe` 嵌入，扩展采用的是 `3 个站点独立窗口 + 1 个中控浮窗` 的工作方式。

## 功能

- 中控输入框一次发送到三个站点
- 支持附带图片一起发送到三个站点
- 检测各站输入框是否存在，并显示登录/加载状态
- 拖拽调整 Claude / ChatGPT / Gemini 的窗口摆放顺序
- 按上二下一的布局自动整理三个站点窗口
- 根据当前显示器的可用工作区动态计算窗口大小

## 开发

```bash
bun install
bun run dev
```

## 构建

```bash
bun run build
```

构建产物位于 `.output/chrome-mv3/`，可以在 Chrome 的扩展管理页使用“加载已解压的扩展程序”进行测试。

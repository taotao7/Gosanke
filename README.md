# Gosanke Workspace

<p align="center">
  <img src="public/icon/128.png" alt="Gosanke" width="96" />
</p>

<p align="center">
  A browser extension that sends the same prompt to Claude, ChatGPT, and Gemini simultaneously.
</p>

<p align="center">
  <a href="docs/README_zh.md">中文文档</a>
</p>

## What is Gosanke?

Gosanke opens **Claude**, **ChatGPT**, and **Gemini** in three separate popup windows, with a floating **controller** window for unified input. Since these sites block `iframe` embedding, the multi-window approach is the only viable option.

## Features

### Multi-Site Dispatch
- Send the same text prompt to all three AI sites at once
- Attach images — they are delivered to every site alongside the text
- Paste screenshots directly into the controller (Ctrl/Cmd+V)

### Smart Image Upload
- Synthetic paste event injection (preferred, matches native UX)
- Automatic fallback to file input injection when paste isn't supported
- Per-site upload strategy adapts to each platform's DOM

### Message Forwarding
- Hover over any message on Claude / ChatGPT / Gemini to see forward buttons
- One click forwards that message to either of the other two platforms
- Visual feedback: sending → sent / failed

### Adaptive Layout
- Automatic window sizing based on screen resolution
- Smaller screens use tighter spacing to maximize site window area
- Larger screens get comfortable padding with proportional controller size
- Two-top, one-bottom layout with the controller floating at the center
- Drag-and-drop slot reordering in the controller
- Manual "Rearrange" resets layout to the template
- Window positions are saved and restored across sessions

### Status Detection
- Real-time detection of login state, input availability, and assistant output
- Status broadcast to both the popup launcher and the controller
- Heartbeat + MutationObserver for reliable state tracking

### Internationalization
- English and Chinese (auto-detected from browser language)
- All UI strings, status messages, and error messages are localized

## Architecture

| Window | Role |
|--------|------|
| **Popup** | Toolbar launcher — shows status overview, opens the workspace |
| **Controller** | Floating command center — unified input, drag-to-reorder, image attach |
| **Claude / ChatGPT / Gemini** | Three independent popup windows with injected content scripts |

Communication flows through the background service worker via `browser.runtime.sendMessage`.

## Development

```bash
bun install
bun run dev
```

## Build

```bash
bun run build
```

The build output is in `.output/chrome-mv3/`. Load it in Chrome via **Manage Extensions → Load unpacked**.

## Permissions

| Permission | Why |
|------------|-----|
| `storage` | Save window layout, order, and rects across sessions |
| `tabs` | Create, query, and manage site popup windows |
| `system.display` | Read monitor work area for adaptive layout |
| `clipboardWrite` | Write images to clipboard before dispatch |
| Host permissions | Inject content scripts into Claude, ChatGPT, and Gemini |

## License

Private project.

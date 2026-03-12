# Privacy Policy for Gosanke Workspace

**Last Updated: March 12, 2026**

## Overview

Gosanke Workspace is a browser extension that allows users to simultaneously send prompts to Claude (claude.ai), ChatGPT (chatgpt.com), and Gemini (gemini.google.com) through a multi-window workspace interface.

## Data Collection

Gosanke Workspace does **not** collect, transmit, or share any personal data. All data remains entirely on your device.

## Data Stored Locally

The extension stores the following data locally on your device using the browser's built-in storage API (`browser.storage.local`):

- **Window layout preferences** — positions and sizes of workspace windows so your layout is restored between sessions.
- **Site order preferences** — the arrangement order of the three AI sites within the workspace.

This data never leaves your browser and is not accessible to anyone other than you.

## Website Interactions

The extension injects content scripts into the following websites solely to enable prompt delivery and status detection:

- claude.ai
- chatgpt.com
- gemini.google.com

The content scripts interact with page elements (input fields, buttons) to:

- Detect whether you are logged in and the page is ready.
- Insert text prompts and image attachments you provide.
- Trigger the send action on your behalf.

The extension does **not** read, store, or transmit your conversations, responses, or any other content from these websites.

## Images and Prompts

Text prompts and image attachments you enter in the workspace controller are forwarded directly to the three AI sites through in-browser messaging. They are **not** sent to any external server, and are **not** stored persistently by the extension.

## Permissions

The extension requests the following browser permissions:

| Permission | Purpose |
|---|---|
| `storage` | Save your window layout and site order preferences locally |
| `tabs` | Manage workspace windows (create, position, focus) |
| `system.display` | Detect screen dimensions to calculate optimal window layout |
| Host permissions for the three AI sites | Inject content scripts to enable prompt delivery |

## Third-Party Services

Gosanke Workspace does **not** use any third-party analytics, tracking, advertising, or data collection services.

## Changes to This Policy

If this privacy policy is updated, the changes will be reflected in this document with an updated date.

## Contact

If you have questions about this privacy policy, please open an issue on the project's GitHub repository.

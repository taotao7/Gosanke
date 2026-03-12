import { useEffect, useRef, useState } from 'react';
import './App.css';
import {
  DEFAULT_ORDER,
  SITE_DEFINITIONS,
  SITE_KEYS,
  createDefaultSnapshot,
  getStatusLabel,
  getStatusTone,
  sanitizeOrder,
  type ImageAttachment,
  type SiteKey,
  type WorkspaceSnapshot,
} from '@/utils/workspace';
import { t } from '@/utils/i18n';

const SLOT_LABELS = () => [t('slot.topLeft'), t('slot.topRight'), t('slot.bottom')];

function App() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(createDefaultSnapshot());
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [draggingSite, setDraggingSite] = useState<SiteKey | null>(null);
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendReport, setSendReport] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let mounted = true;

    const handleMessage = (message: { type?: string; snapshot?: WorkspaceSnapshot }) => {
      if (message?.type === 'workspace/snapshot' && message.snapshot && mounted) {
        setSnapshot(message.snapshot);
      }
    };

    browser.runtime.onMessage.addListener(handleMessage);

    browser.runtime
      .sendMessage({ type: 'workspace/controller-ready' })
      .then((nextSnapshot) => {
        if (mounted && nextSnapshot) {
          setSnapshot(nextSnapshot as WorkspaceSnapshot);
        }
      })
      .catch(() => {
        // Ignore startup races while the background is waking up.
      });

    return () => {
      mounted = false;
      browser.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  const order = sanitizeOrder(snapshot.order);
  const allIdle = SITE_KEYS.every((site) => !snapshot.statuses[site].hasAssistantOutput);
  const canSend = Boolean(prompt.trim()) || attachments.length > 0;

  const handleDrop = async (slotIndex: number) => {
    if (!draggingSite) {
      return;
    }

    const currentIndex = order.indexOf(draggingSite);
    if (currentIndex < 0 || currentIndex === slotIndex) {
      setHoveredSlot(null);
      setDraggingSite(null);
      return;
    }

    const nextOrder = [...order];
    const displaced = nextOrder[slotIndex];
    nextOrder[slotIndex] = draggingSite;
    nextOrder[currentIndex] = displaced;

    setSnapshot((current) => ({
      ...current,
      order: nextOrder,
    }));

    setHoveredSlot(null);
    setDraggingSite(null);

    try {
      const nextSnapshot = (await browser.runtime.sendMessage({
        type: 'workspace/rearrange',
        order: nextOrder,
      })) as WorkspaceSnapshot;
      if (nextSnapshot) {
        setSnapshot(nextSnapshot);
      }
    } catch {
      setSendReport(t('report.dragFailed'));
    }
  };

  const handleArrange = async () => {
    try {
      const nextSnapshot = (await browser.runtime.sendMessage({
        type: 'workspace/open',
      })) as WorkspaceSnapshot;
      if (nextSnapshot) {
        setSnapshot(nextSnapshot);
      }
    } catch {
      setSendReport(t('report.arrangeFailed'));
    }
  };

  const handlePaste = async (event: React.ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }

    if (imageFiles.length === 0) return;

    event.preventDefault();
    const newAttachments = await Promise.all(imageFiles.map(toImageAttachment));
    setAttachments((prev) => [...prev, ...newAttachments]);
    setSendReport(t('report.pastedN', newAttachments.length));
  };

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files?.length) {
      return;
    }

    const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (!imageFiles.length) {
      setSendReport(t('report.noImage'));
      return;
    }

    const nextAttachments = await Promise.all(imageFiles.map(toImageAttachment));
    setAttachments(nextAttachments);
    setSendReport(t('report.selectedN', nextAttachments.length));
  };

  const handleSend = async () => {
    const normalized = prompt.trim();
    if ((!normalized && attachments.length === 0) || isSending) {
      return;
    }

    setIsSending(true);
    setSendReport(
      attachments.length > 0 ? t('report.dispatchingWithImages') : t('report.dispatching'),
    );

    let useClipboard = false;
    if (attachments.length > 0) {
      useClipboard = await writeFirstImageToClipboard(attachments[0]);
    }

    try {
      const response = (await browser.runtime.sendMessage({
        type: 'workspace/send-prompt',
        prompt: normalized,
        attachments,
        useClipboard,
      })) as
        | {
            ok: boolean;
            results: Array<{ site: SiteKey; ok: boolean; reason: string }>;
            snapshot?: WorkspaceSnapshot;
          }
        | undefined;

      if (response?.snapshot) {
        setSnapshot(response.snapshot);
      }

      const report =
        response?.results
          ?.map((result) => {
            const prefix = SITE_DEFINITIONS[result.site].shortLabel;
            return `${prefix} ${result.ok ? t('report.sent') : `${t('report.failed')}: ${result.reason}`}`;
          })
          .join(' / ') ?? t('report.noResult');

      setSendReport(report);
      if (response?.ok) {
        setPrompt('');
        setAttachments([]);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    } catch {
      setSendReport(t('report.sendFailed'));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <main className={`workspace-shell ${allIdle ? 'workspace-shell--idle' : ''}`}>
      <section className="workspace-panel">
        <header className="workspace-header">
          <div>
            <h1 className="workspace-title">Gosanke Workspace</h1>
            <p className="workspace-note">{t('workspace.note')}</p>
          </div>
          <div className="workspace-actions">
            <button className="workspace-button" type="button" onClick={handleArrange}>
              {t('action.rearrange')}
            </button>
          </div>
        </header>

        <section className="slot-grid" aria-label="窗口排布">
          {order.map((site, slotIndex) => {
            const status = snapshot.statuses[site];
            const tone = getStatusTone(status);
            const isBottom = slotIndex === 2;
            const isHovered = hoveredSlot === slotIndex;

            return (
              <div
                key={`${site}-${slotIndex}`}
                className={`slot-card ${isBottom ? 'slot-card--bottom' : ''} ${
                  isHovered ? 'slot-card--over' : ''
                }`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setHoveredSlot(slotIndex);
                }}
                onDragLeave={() => {
                  if (hoveredSlot === slotIndex) {
                    setHoveredSlot(null);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  void handleDrop(slotIndex);
                }}>
                <span className="slot-label">{SLOT_LABELS()[slotIndex]}</span>
                <button
                  className="site-pill"
                  draggable
                  type="button"
                  onDragStart={() => setDraggingSite(site)}
                  onDragEnd={() => {
                    setDraggingSite(null);
                    setHoveredSlot(null);
                  }}>
                  <span className="site-pill__name">{SITE_DEFINITIONS[site].label}</span>
                  <span className={`site-pill__status site-pill__status--${tone}`}>
                    {getStatusLabel(status)}
                  </span>
                </button>
              </div>
            );
          })}
        </section>

        <section className="composer">
          <div className="composer-toolbar">
            <button
              className="workspace-button workspace-button--ghost"
              type="button"
              onClick={() => fileInputRef.current?.click()}>
              {t('composer.addImage')}
            </button>
            <input
              ref={fileInputRef}
              className="composer-file-input"
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => void handleFilesSelected(event.target.files)}
            />
            <span className="composer-tip">
              {attachments.length > 0 ? t('composer.selectedN', attachments.length) : t('composer.pasteOrAttach')}
            </span>
            {attachments.length > 0 ? (
              <button
                className="workspace-button workspace-button--ghost"
                type="button"
                onClick={() => {
                  setAttachments([]);
                  setSendReport(t('report.clearedImages'));
                  if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                  }
                }}>
                {t('composer.clearImages')}
              </button>
            ) : null}
          </div>

          {attachments.length > 0 ? (
            <div className="attachment-strip">
              {attachments.map((attachment) => (
                <span className="attachment-chip" key={`${attachment.name}-${attachment.lastModified}`}>
                  {attachment.name}
                </span>
              ))}
            </div>
          ) : null}

          <textarea
            placeholder={t('composer.placeholder')}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void handleSend();
              }
            }}
            onPaste={(event) => void handlePaste(event)}
          />
          <div className="composer-footer">
            <span className="composer-tip">
              {allIdle ? t('composer.idleHint') : t('composer.activeHint')}
            </span>
            <button
              className="workspace-button"
              type="button"
              disabled={isSending || !canSend}
              onClick={handleSend}>
              {isSending ? t('action.sending') : t('action.sendToAll')}
            </button>
          </div>
          <div className="send-report">{sendReport}</div>
        </section>

        <section className="status-strip" aria-label="站点状态">
          {DEFAULT_ORDER.map((site) => {
            const status = snapshot.statuses[site];
            return (
              <article className="status-chip" key={site}>
                <div className="status-chip__meta">
                  <span className="status-chip__title">{SITE_DEFINITIONS[site].label}</span>
                  <span className="status-chip__note">{status.note}</span>
                </div>
                <div className="status-chip__flags">
                  <span className="status-flag">{getStatusLabel(status)}</span>
                  <span className="status-flag">{status.inputAvailable ? t('chip.inputOnline') : t('chip.inputMissing')}</span>
                  <span className="status-flag">{status.hasAssistantOutput ? t('chip.hasReply') : t('chip.noReply')}</span>
                </div>
              </article>
            );
          })}
        </section>
      </section>
    </main>
  );
}

async function writeFirstImageToClipboard(attachment: ImageAttachment): Promise<boolean> {
  try {
    const blob = new Blob([Uint8Array.from(attachment.bytes)], { type: attachment.type });
    await navigator.clipboard.write([new ClipboardItem({ [attachment.type]: blob })]);
    return true;
  } catch {
    return false;
  }
}

async function toImageAttachment(file: File): Promise<ImageAttachment> {
  const buffer = await file.arrayBuffer();
  return {
    name: file.name,
    type: file.type || 'image/png',
    size: file.size,
    lastModified: file.lastModified,
    bytes: Array.from(new Uint8Array(buffer)),
  };
}

export default App;

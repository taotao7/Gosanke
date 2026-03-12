import { useEffect, useState } from 'react';
import './App.css';
import {
  DEFAULT_ORDER,
  SITE_DEFINITIONS,
  createDefaultSnapshot,
  getStatusLabel,
  getStatusTone,
  type WorkspaceSnapshot,
} from '@/utils/workspace';
import { t } from '@/utils/i18n';

function App() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(createDefaultSnapshot());
  const [isOpening, setIsOpening] = useState(false);

  useEffect(() => {
    let mounted = true;

    const handleMessage = (message: { type?: string; snapshot?: WorkspaceSnapshot }) => {
      if (message?.type === 'workspace/snapshot' && message.snapshot && mounted) {
        setSnapshot(message.snapshot);
      }
    };

    browser.runtime.onMessage.addListener(handleMessage);
    browser.runtime
      .sendMessage({ type: 'workspace/get-snapshot' })
      .then((nextSnapshot) => {
        if (mounted && nextSnapshot) {
          setSnapshot(nextSnapshot as WorkspaceSnapshot);
        }
      })
      .catch(() => {
        // Ignore popup boot races.
      });

    return () => {
      mounted = false;
      browser.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  const handleOpenWorkspace = async () => {
    setIsOpening(true);

    try {
      const nextSnapshot = (await browser.runtime.sendMessage({
        type: 'workspace/open',
      })) as WorkspaceSnapshot;
      if (nextSnapshot) {
        setSnapshot(nextSnapshot);
      }
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <main className="popup-shell">
      <section className="popup-card">
        <div className="popup-header">
          <div>
            <p className="popup-kicker">Gosanke</p>
            <h1 className="popup-title">{t('popup.subtitle')}</h1>
          </div>
          <button className="popup-primary" type="button" disabled={isOpening} onClick={handleOpenWorkspace}>
            {isOpening ? t('popup.opening') : t('popup.openWorkspace')}
          </button>
        </div>

        <p className="popup-copy">
          {t('popup.description')}
        </p>

        <section className="popup-statuses">
          {DEFAULT_ORDER.map((site) => {
            const status = snapshot.statuses[site];
            const tone = getStatusTone(status);
            return (
              <article className="popup-status" key={site}>
                <div>
                  <strong>{SITE_DEFINITIONS[site].label}</strong>
                  <p>{status.note}</p>
                </div>
                <span className={`popup-status__badge popup-status__badge--${tone}`}>
                  {getStatusLabel(status)}
                </span>
              </article>
            );
          })}
        </section>
      </section>
    </main>
  );
}

export default App;

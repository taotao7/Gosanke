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
import { t, getLocale, setLocale, loadLocale, onLocaleChange, type Locale } from '@/utils/i18n';

function App() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(createDefaultSnapshot());
  const [isOpening, setIsOpening] = useState(false);
  const [locale, setLocaleState] = useState<Locale>(getLocale());

  useEffect(() => {
    void loadLocale().then(setLocaleState);

    const unsubscribe = onLocaleChange(setLocaleState);

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
      .catch(() => {});

    return () => {
      mounted = false;
      unsubscribe();
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

  const handleToggleLocale = () => {
    void setLocale(locale === 'zh' ? 'en' : 'zh');
  };

  // Force re-render uses locale in key — t() reads the updated global
  void locale;

  return (
    <main className="popup-shell">
      <section className="popup-card">
        <div className="popup-header">
          <div>
            <p className="popup-kicker">Gosanke</p>
            <h1 className="popup-title">{t('popup.subtitle')}</h1>
          </div>
          <div className="popup-header-actions">
            <button
              className="popup-lang-btn"
              type="button"
              title={t('popup.switchLang')}
              onClick={handleToggleLocale}>
              {t('lang.switchTo')}
            </button>
            <button
              className="popup-primary"
              type="button"
              disabled={isOpening}
              onClick={handleOpenWorkspace}>
              {isOpening ? t('popup.opening') : t('popup.openWorkspace')}
            </button>
          </div>
        </div>

        <p className="popup-copy">{t('popup.description')}</p>

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
                <span className={`popup-badge popup-badge--${tone}`}>
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

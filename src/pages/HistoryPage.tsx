import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../hooks/useSettings';
import { HISTORY_PANELS } from '../mock/history';

export function HistoryPage() {
  const { settings, saving, update } = useSettings();
  const [draft, setDraft] = useState('');

  // Seed the draft only once, the first time settings load — re-syncing on
  // every later fetch would clobber an in-progress edit (same race as
  // SettingsPage's array-label draft).
  const initialized = useRef(false);
  useEffect(() => {
    if (settings && !initialized.current) {
      setDraft(settings.grafanaUrl);
      initialized.current = true;
    }
  }, [settings]);

  const grafanaUrl = settings?.grafanaUrl ?? '';

  return (
    <div className="page">
      <div className="history-header">
        <div>
          <div className="page-title">History</div>
          <div className="history-header__desc">
            Array, disk, temperature, CPU, memory and network history — recorded and displayed via Grafana
          </div>
        </div>
        <div className="history-header__controls">
          <input
            className="history-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="https://grafana.example.com/d/nonraid/embed?kiosk"
          />
          <button
            type="button"
            className="btn--primary"
            style={{ padding: '8px 14px' }}
            disabled={saving}
            onClick={() => update({ grafanaUrl: grafanaUrl ? '' : draft.trim() })}
          >
            {grafanaUrl ? 'Disconnect' : 'Connect'}
          </button>
        </div>
      </div>

      {grafanaUrl ? (
        <div className="history-iframe-wrap">
          <iframe src={grafanaUrl} title="Grafana" />
        </div>
      ) : (
        <>
          <div className="history-grid">
            {HISTORY_PANELS.map((panel) => (
              <div className="history-panel" key={panel.name}>
                <div className="history-panel__preview">
                  <span className="history-panel__badge">grafana panel: {panel.name}</span>
                </div>
                <div className="history-panel__desc">{panel.desc}</div>
              </div>
            ))}
          </div>
          <div className="history-hint">Paste a Grafana embed/kiosk URL above to replace these placeholders with live panels.</div>
        </>
      )}
    </div>
  );
}

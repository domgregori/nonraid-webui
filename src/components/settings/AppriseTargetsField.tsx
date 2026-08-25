import { useState } from 'react';
import { settingsApi } from '../../api/settingsApi';
import { APPRISE_SERVICES, describeAppriseUrl, maskAppriseUrl } from '../../selectors/appriseServices';

interface AppriseTargetsFieldProps {
  value: string;
  onChange: (value: string) => void;
}

// Same hash-based swatch tints RemoteBackupSection.tsx uses for rclone providers - reused here
// rather than adding a fourth color just for apprise services.
const SWATCH_COLORS = ['b2', 'gdrive', 'sftp'] as const;
function swatchClass(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return `provider-swatch--${SWATCH_COLORS[hash % SWATCH_COLORS.length]}`;
}

function parseTargets(value: string): string[] {
  return value.split(/\s+/).filter(Boolean);
}

/**
 * Apprise's raw target URLs, built through a per-service form instead of typed by hand - modeled
 * on AddRemoteForm.tsx's provider-dropdown-plus-fields pattern. Still just produces the same
 * space/newline-separated `appriseUrls` string the backend has always taken (settings/types.ts's
 * doc comment: "passed straight through to the apprise CLI"), so no backend change was needed -
 * this only changes how that string gets built.
 */
export function AppriseTargetsField({ value, onChange }: AppriseTargetsFieldProps) {
  const targets = parseTargets(value);
  const [serviceId, setServiceId] = useState(APPRISE_SERVICES[0].id);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [secure, setSecure] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowTest, setRowTest] = useState<{ index: number; pending: boolean; result: string | null } | null>(null);

  const service = APPRISE_SERVICES.find((s) => s.id === serviceId) ?? APPRISE_SERVICES[0];
  const preview = service.buildUrl(fields, service.secure ? secure : true);

  const selectService = (id: string) => {
    const next = APPRISE_SERVICES.find((s) => s.id === id) ?? APPRISE_SERVICES[0];
    setServiceId(id);
    setFields({});
    setSecure(next.secure?.default ?? true);
    setFormError(null);
  };

  const removeTarget = (index: number) => {
    onChange(targets.filter((_, i) => i !== index).join('\n'));
  };

  const addTarget = () => {
    const missing = service.fields.filter((f) => f.required && !fields[f.key]?.trim());
    if (missing.length > 0) {
      setFormError(`${missing.map((f) => f.label).join(', ')} required.`);
      return;
    }
    onChange([...targets, preview].join('\n'));
    setFields({});
    setFormError(null);
  };

  const testTarget = async (index: number) => {
    setRowTest({ index, pending: true, result: null });
    try {
      const result = await settingsApi.testNotification(targets[index]);
      setRowTest({ index, pending: false, result: result.message ?? 'Sent.' });
    } catch (err) {
      setRowTest({ index, pending: false, result: (err as Error).message });
    }
  };

  return (
    <div className="apprise-targets">
      {targets.length > 0 && (
        <div className="remote-list">
          {targets.map((url, i) => (
            <div className="remote-row" key={`${url}-${i}`}>
              <div className={`remote-row__icon ${swatchClass(describeAppriseUrl(url))}`}>{describeAppriseUrl(url).slice(0, 2).toUpperCase()}</div>
              <div className="remote-row__body">
                <div className="remote-row__name">{describeAppriseUrl(url)}</div>
                <div className="remote-row__meta">{maskAppriseUrl(url)}</div>
                {rowTest?.index === i && rowTest.result && <div className="remote-row__meta">{rowTest.result}</div>}
              </div>
              <div className="remote-row__actions">
                <button type="button" className="btn" disabled={rowTest?.index === i && rowTest.pending} onClick={() => testTarget(i)}>
                  {rowTest?.index === i && rowTest.pending ? 'Sending…' : 'Test'}
                </button>
                <button type="button" className="btn btn--danger" onClick={() => removeTarget(i)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="add-remote-panel">
        <div className="add-remote-panel__title">Add a notification target</div>
        <div className="field-grid">
          <label className="field">
            <span>Service</span>
            <select className="history-input" value={serviceId} onChange={(e) => selectService(e.target.value)}>
              {APPRISE_SERVICES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {service.secure && (
            <div className="field">
              <span>Connection</span>
              <label className="apprise-secure-toggle">
                <input type="checkbox" className="round-checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} />
                {secure ? `Secure (${service.secure.secureScheme}://)` : `Not secure (${service.secure.insecureScheme}://)`}
              </label>
            </div>
          )}
        </div>

        <div className="apprise-pattern">{service.pattern}</div>

        <div className="field-grid">
          {service.fields.map((f) => (
            <label className="field" key={f.key}>
              <span>{f.label}</span>
              <input
                className="history-input"
                type={f.password ? 'password' : 'text'}
                value={fields[f.key] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
              />
            </label>
          ))}
        </div>

        <div className="apprise-preview">
          <span>URL:</span> <code>{preview || '…'}</code>
        </div>

        <div className="settings-field__row">
          <button type="button" className="btn btn--primary-sm" onClick={addTarget}>
            Add target
          </button>
        </div>
        {formError && <div className="status-note status-note--error">{formError}</div>}
      </div>
    </div>
  );
}

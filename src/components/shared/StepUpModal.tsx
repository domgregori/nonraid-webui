import { useState } from 'react';
import { useStepUp } from '../../hooks/useStepUp';
import { StepUpFields } from './StepUpFields';

interface StepUpModalProps {
  title: string;
  description?: string;
  confirmLabel?: string;
  /** Throw (or reject) to keep the modal open and show the error inline - same contract as any
   *  other form submit handler in this app. Resolving closes the modal via onClose. */
  onConfirm: (password: string, totpCode: string | undefined) => Promise<void>;
  onClose: () => void;
}

/**
 * Popup re-confirmation of the current admin's identity (password, plus a TOTP/backup code if
 * the account has TOTP enrolled) before a sensitive action proceeds - the modal shell around
 * useStepUp/StepUpFields. First used for adding a trusted SSH key (SshKeysSection.tsx) and
 * changing the account password (SettingsPage.tsx's Security section); any future sensitive
 * action can reuse this the same way rather than building its own confirm dialog.
 */
export function StepUpModal({ title, description, confirmLabel = 'Confirm', onConfirm, onClose }: StepUpModalProps) {
  const stepUp = useStepUp();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!stepUp.password) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(stepUp.password, stepUp.totpCode || undefined);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="detail-overlay" onClick={() => !submitting && onClose()} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">{title}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} disabled={submitting} aria-label="Close">
            &#10005;
          </button>
        </div>
        <div className="dialog__body">
          <StepUpFields
            password={stepUp.password}
            onPasswordChange={stepUp.setPassword}
            totpEnabled={stepUp.totpEnabled}
            totpCode={stepUp.totpCode}
            onTotpCodeChange={stepUp.setTotpCode}
            description={description}
          />
          {error && <div className="status-note status-note--error">{error}</div>}
          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" disabled={submitting || !stepUp.password} onClick={submit}>
              {submitting ? 'Confirming…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

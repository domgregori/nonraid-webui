import { useTranslation } from 'react-i18next';

interface StepUpFieldsProps {
  password: string;
  onPasswordChange: (value: string) => void;
  totpEnabled: boolean;
  totpCode: string;
  onTotpCodeChange: (value: string) => void;
  /** What's being confirmed - defaults to a generic prompt, override per call site
   *  (e.g. "this grants full root shell access") when the stakes are worth spelling out. */
  description?: string;
}

/** Password (+ TOTP code, only if the account has TOTP enrolled) fields for a step-up
 *  confirmation - pair with the useStepUp hook, which owns the state this renders and the
 *  one-time totpEnabled fetch. Purely presentational so any sensitive-action form can drop it in
 *  without re-building the same two inputs. */
export function StepUpFields({ password, onPasswordChange, totpEnabled, totpCode, onTotpCodeChange, description }: StepUpFieldsProps) {
  const { t } = useTranslation('shared');
  return (
    <>
      <div className="toggle-row__desc">{description ?? t('StepUpFields.defaultDescription')}</div>
      <input
        type="password"
        className="history-input"
        value={password}
        onChange={(e) => onPasswordChange(e.target.value)}
        placeholder={t('StepUpFields.passwordPlaceholder')}
        autoComplete="current-password"
      />
      {totpEnabled && (
        <input
          className="history-input"
          value={totpCode}
          onChange={(e) => onTotpCodeChange(e.target.value)}
          placeholder={t('StepUpFields.totpPlaceholder')}
          inputMode="numeric"
          autoComplete="one-time-code"
        />
      )}
    </>
  );
}

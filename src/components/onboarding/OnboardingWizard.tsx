import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { systemApi } from '../../api/systemApi';
import { useSystemStats } from '../../hooks/useSystemStats';
import { useArrayStatus } from '../../state/useArrayStatus';
import type { NmdStatusResponse } from '../../types/nmdApi';
import { ConfigRestoreWizard } from '../settings/ConfigRestoreWizard';
import { ImportArrayWizard } from '../settings/ImportArrayWizard';
import { RestoreFromLocalWizard } from '../settings/RestoreFromLocalWizard';
import { ArrayBuilder } from './ArrayBuilder';
import { RemoteRestoreOnboarding } from './RemoteRestoreOnboarding';

type Step = 'welcome' | 'start' | 'import' | 'restoreConfig' | 'disks' | 'info' | 'done';
// Which of the three sources the 'restoreConfig' step is currently showing - null means "still on
// the chooser", matching Settings → Recovery's own upload/local/remote three-button pattern (see
// SettingsPage.tsx's Recovery card) rather than jumping straight to the upload-only flow this
// wizard used to have.
type RestoreSource = 'upload' | 'local' | 'remote';
type Stage = 0 | 1 | 2;

const STAGE_LABEL_KEYS = ['array', 'tour', 'done'] as const;

function stageForStep(step: Step): Stage {
  if (step === 'info') return 1;
  if (step === 'done') return 2;
  return 0;
}

/**
 * Where to (re)open the wizard for the array's actual current state - used both on the
 * automatic first-run open and on manual "Replay setup tour" (see OnboardingGate). There's
 * deliberately no persisted "which step was I on" pointer: live array/cache state is always
 * authoritative, so a step is recomputed from it fresh every time rather than trusted from a
 * stale save. Both hasAnyDisk and hasDataDisk (see their computation above) read status.disks
 * directly rather than array.total_slots, which only reflects *committed* data disks and stays 0
 * for a disk that's been add-ed but not yet start-ed - exactly the state disks sit in for most of
 * the 'disks' step now that assigning doesn't auto-start after each one. NEW_ARRAY isn't used here
 * either: it means "disks assigned, first parity build still pending," which is already past the
 * disks/import step, not a sign of a blank array.
 *
 * 'welcome' (machine name/timezone) only ever appears here, on a genuinely blank array - it's a
 * one-time first-run convenience, not something worth resurfacing on every "Replay setup tour"
 * once the array's already configured, since Settings → About already covers editing both any
 * time. A second parity disk, more data disks, and a cache mirror are all Disks-page (or Settings
 * → Cache) actions once the array's up - not something this wizard asks about at all, so reaching
 * 'info' only ever depends on hasDataDisk, nothing about cache.
 */
function deriveStartStep(hasAnyDisk: boolean, hasDataDisk: boolean): Step {
  if (!hasAnyDisk) return 'welcome';
  if (!hasDataDisk) return 'disks';
  return 'info';
}

// Checked against status.disks directly, not array.total_slots - total_slots only reflects
// *committed* data disks (see the kernel driver's own sb->num_disks update), staying 0 until a `start`
// commits whatever's been add-ed so far, which ArrayBuilder's whole plan-then-build model
// deliberately defers until the very end (see its own doc comment).
function deriveHasDisks(status: NmdStatusResponse | null): { hasAnyDisk: boolean; hasDataDisk: boolean } {
  return {
    hasAnyDisk: status?.disks.some((d) => d.disk_id) ?? false,
    hasDataDisk: (status?.disks ?? []).some((d) => d.disk_id && d.type === 'data'),
  };
}

const INFO_SLIDE_KEYS = ['apps', 'docker', 'lxc', 'notifications', 'backups'] as const;

interface OnboardingWizardProps {
  /** Always marks the wizard dismissed/completed and unmounts it - fired from every exit point
   *  (Skip, and finishing the tour). There's no separate "finished vs. skipped" outcome to
   *  distinguish: both mean "don't auto-open this again," which is exactly what dismissed=true
   *  represents. */
  onFinish: () => void;
}

export function OnboardingWizard({ onFinish }: OnboardingWizardProps) {
  const { t } = useTranslation('onboarding');
  const { status, refresh } = useArrayStatus();
  const stats = useSystemStats();
  const { hasAnyDisk, hasDataDisk } = deriveHasDisks(status);

  const [step, setStep] = useState<Step>(() => deriveStartStep(hasAnyDisk, hasDataDisk));
  const [infoIndex, setInfoIndex] = useState(0);
  const [importedJustNow, setImportedJustNow] = useState(false);
  const [restoredJustNow, setRestoredJustNow] = useState(false);
  const [restoreSource, setRestoreSource] = useState<RestoreSource | null>(null);

  const [hostnameDraft, setHostnameDraft] = useState('');
  const [timezoneDraft, setTimezoneDraft] = useState('');
  const [timezones, setTimezones] = useState<string[]>([]);
  const [savingWelcome, setSavingWelcome] = useState(false);
  const [welcomeError, setWelcomeError] = useState<string | null>(null);
  const welcomeInitialized = useRef(false);

  useEffect(() => {
    systemApi.getTimezones().then(setTimezones).catch(() => {});
  }, []);
  useEffect(() => {
    if (stats && !welcomeInitialized.current) {
      setHostnameDraft(stats.hostname);
      setTimezoneDraft(stats.timezone);
      welcomeInitialized.current = true;
    }
  }, [stats]);

  // Both fields already show this host's real current values (see the effect above) - Continue
  // just re-saves them (a harmless no-op if the user didn't change anything) rather than needing
  // a separate "skip" path. Same setHostname/setTimezone calls Settings → About uses.
  const saveWelcome = async () => {
    setSavingWelcome(true);
    setWelcomeError(null);
    try {
      await Promise.all([systemApi.setHostname(hostnameDraft.trim()), systemApi.setTimezone(timezoneDraft)]);
      setStep('start');
    } catch (err) {
      setWelcomeError((err as Error).message);
    } finally {
      setSavingWelcome(false);
    }
  };

  // status is still null on the very first render (polls async); once real data has arrived,
  // resolve the actual resume step once - covers reopening mid-setup (a reload, or Replay)
  // landing somewhere other than the very first screen.
  const resolvedOnce = useRef(false);
  useEffect(() => {
    if (resolvedOnce.current || status === null) return;
    resolvedOnce.current = true;
    setStep(deriveStartStep(hasAnyDisk, hasDataDisk));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const stage = stageForStep(step);

  // `status` (and hasAnyDisk/hasDataDisk derived from it) is only as fresh as the last poll tick
  // - up to STATUS_POLL_MS old - so reading it immediately after the wizard just committed a real
  // change would usually still see the pre-change array and wrongly resolve back to 'welcome'
  // (confirmed live: closing a just-finished config restore reliably bounced back to the very
  // start of the wizard instead of resuming past it). Deriving from refresh()'s own return value,
  // not the hasAnyDisk/hasDataDisk already in scope: those were fixed by closure back when this
  // function was created, so awaiting refresh() updates the *context* but can never change what
  // this already-running call sees on its own next line - has to read the fresh value directly.
  const handleImportClose = async () => {
    if (!importedJustNow) {
      setStep('start');
      return;
    }
    const fresh = await refresh();
    const { hasAnyDisk: freshHasAnyDisk, hasDataDisk: freshHasDataDisk } = deriveHasDisks(fresh);
    setStep(deriveStartStep(freshHasAnyDisk, freshHasDataDisk));
  };

  // A successful restore can bring back a fully-configured array (superblock included, when the
  // array was blank) plus shares/users/settings all at once - resolving the same way a successful
  // array import does covers both that case and the config-only case (superblock skipped, array
  // still blank) identically, since deriveStartStep would just land back on 'disks' for the latter
  // on next resolve anyway. Simplest to just re-derive live rather than special-case it here.
  //
  // Shared onClose for all three restore sources (upload/local/remote) mounted under the
  // 'restoreConfig' step - a plain cancel (nothing actually landed) drops back to that step's own
  // upload/local/remote chooser rather than all the way out to 'start', so picking the wrong
  // source doesn't lose the "I'm restoring a config backup" context. A real restore still re-
  // derives the live step exactly like handleImportClose, for the same stale-closure reason.
  const handleRestoreClose = async () => {
    if (!restoredJustNow) {
      setRestoreSource(null);
      return;
    }
    const fresh = await refresh();
    const { hasAnyDisk: freshHasAnyDisk, hasDataDisk: freshHasDataDisk } = deriveHasDisks(fresh);
    setStep(deriveStartStep(freshHasAnyDisk, freshHasDataDisk));
  };

  return (
    <div className="onboarding">
      <div className="onboarding__chrome">
        <div className="onboarding__brand">
          <img src="/logo.png" alt="" className="onboarding__brand-logo" />
          <span className="onboarding__brand-title">{t('OnboardingWizard.brandTitle')}</span>
        </div>
        {step !== 'done' && (
          <button type="button" className="btn onboarding__skip" onClick={onFinish}>
            {t('OnboardingWizard.skipSetup')}
          </button>
        )}
      </div>

      <div className="onboarding-track">
        {STAGE_LABEL_KEYS.map((labelKey, i) => (
          <div key={labelKey} className="onboarding-track__item">
            {i > 0 && <div className="onboarding-rail" />}
            <div className={`onboarding-bay${i === stage ? ' onboarding-bay--active' : i < stage ? ' onboarding-bay--done' : ''}`}>
              <div className="onboarding-bay__glyph" />
              <div className="onboarding-bay__label">{t(`OnboardingWizard.stageLabels.${labelKey}`)}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="onboarding__stage">
        <div className="onboarding__panel">
          {step === 'welcome' && (
            <>
              <div className="eyebrow onboarding-hero__eyebrow">{t('OnboardingWizard.common.firstTimeSetup')}</div>
              <div className="onboarding-hero__title">{t('OnboardingWizard.welcome.title')}</div>
              <div className="onboarding-hero__desc">{t('OnboardingWizard.welcome.desc')}</div>

              <label className="form-field">
                <span className="form-field__label">{t('OnboardingWizard.welcome.hostnameLabel')}</span>
                <input
                  className="history-input"
                  value={hostnameDraft}
                  onChange={(e) => setHostnameDraft(e.target.value)}
                  disabled={savingWelcome}
                />
              </label>

              <label className="form-field">
                <span className="form-field__label">{t('OnboardingWizard.welcome.timezoneLabel')}</span>
                <select
                  className="history-input"
                  value={timezoneDraft}
                  onChange={(e) => setTimezoneDraft(e.target.value)}
                  disabled={savingWelcome}
                >
                  {!timezones.includes(timezoneDraft) && timezoneDraft && <option value={timezoneDraft}>{timezoneDraft}</option>}
                  {timezones.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </label>

              {welcomeError && <div className="status-note status-note--error">{welcomeError}</div>}

              <div className="onboarding__actions">
                <div className="onboarding__actions-right">
                  <button type="button" className="btn btn--primary" disabled={savingWelcome} onClick={saveWelcome}>
                    {savingWelcome ? t('OnboardingWizard.welcome.saving') : t('OnboardingWizard.welcome.continue')}
                  </button>
                </div>
              </div>
            </>
          )}

          {step === 'start' && (
            <>
              <div className="eyebrow onboarding-hero__eyebrow">{t('OnboardingWizard.common.firstTimeSetup')}</div>
              <div className="onboarding-hero__title">{t('OnboardingWizard.start.title')}</div>
              <div className="onboarding-hero__desc">{t('OnboardingWizard.start.desc')}</div>
              <div className="onboarding-choices">
                <button type="button" className="onboarding-choice onboarding-choice--primary" onClick={() => setStep('disks')}>
                  <span className="onboarding-choice__title">{t('OnboardingWizard.start.buildChoiceTitle')}</span>
                  <span className="onboarding-choice__desc">{t('OnboardingWizard.start.buildChoiceDesc')}</span>
                </button>
                <button
                  type="button"
                  className="onboarding-choice"
                  onClick={() => {
                    setImportedJustNow(false);
                    setStep('import');
                  }}
                >
                  <span className="onboarding-choice__title">{t('OnboardingWizard.start.importChoiceTitle')}</span>
                  <span className="onboarding-choice__desc">{t('OnboardingWizard.start.importChoiceDesc')}</span>
                </button>
                <button
                  type="button"
                  className="onboarding-choice"
                  onClick={() => {
                    setRestoredJustNow(false);
                    setRestoreSource(null);
                    setStep('restoreConfig');
                  }}
                >
                  <span className="onboarding-choice__title">{t('OnboardingWizard.start.restoreChoiceTitle')}</span>
                  <span className="onboarding-choice__desc">{t('OnboardingWizard.start.restoreChoiceDesc')}</span>
                </button>
              </div>
            </>
          )}

          {step === 'import' && <ImportArrayWizard onClose={handleImportClose} onImported={() => setImportedJustNow(true)} />}

          {step === 'restoreConfig' && restoreSource === null && (
            <>
              <div className="eyebrow onboarding-hero__eyebrow">{t('OnboardingWizard.common.firstTimeSetup')}</div>
              <div className="onboarding-hero__title">{t('OnboardingWizard.restoreConfig.title')}</div>
              <div className="onboarding-hero__desc">{t('OnboardingWizard.restoreConfig.desc')}</div>
              <div className="settings-field__row">
                <button type="button" className="btn" onClick={() => setRestoreSource('upload')}>
                  {t('OnboardingWizard.restoreConfig.fromUpload')}
                </button>
                <button type="button" className="btn" onClick={() => setRestoreSource('local')}>
                  {t('OnboardingWizard.restoreConfig.fromLocal')}
                </button>
                <button type="button" className="btn" onClick={() => setRestoreSource('remote')}>
                  {t('OnboardingWizard.restoreConfig.fromRemote')}
                </button>
              </div>
              <div className="onboarding__actions">
                <button type="button" className="btn" onClick={() => setStep('start')}>
                  {t('OnboardingWizard.common.back')}
                </button>
              </div>
            </>
          )}
          {step === 'restoreConfig' && restoreSource === 'upload' && <ConfigRestoreWizard onClose={handleRestoreClose} onRestored={() => setRestoredJustNow(true)} />}
          {step === 'restoreConfig' && restoreSource === 'local' && <RestoreFromLocalWizard onClose={handleRestoreClose} onRestored={() => setRestoredJustNow(true)} />}
          {step === 'restoreConfig' && restoreSource === 'remote' && <RemoteRestoreOnboarding onClose={handleRestoreClose} onRestored={() => setRestoredJustNow(true)} />}

          {step === 'disks' && (
            <>
              <div className="eyebrow onboarding-hero__eyebrow">{t('OnboardingWizard.disks.eyebrow')}</div>
              <div className="onboarding-hero__title">{t('OnboardingWizard.disks.title')}</div>
              <div className="onboarding-hero__desc">{t('OnboardingWizard.disks.desc')}</div>

              {status && status.disks.some((d) => d.disk_id) && (
                <div className="onboarding-summary">
                  {/* nmdctl always reports a placeholder slot-0 (parity) row with an empty
                      disk_id even on a totally blank array - filtered out here so this only
                      shows disks actually assigned so far, not an empty template row. */}
                  {status.disks
                    .filter((d) => d.disk_id)
                    .map((d) => (
                      <div key={d.slot} className="onboarding-summary__row">
                        <span>
                          {t('OnboardingWizard.disks.summaryRow', {
                            slot: d.slot,
                            type:
                              d.type === 'P'
                                ? t('OnboardingWizard.disks.parity1')
                                : d.type === 'Q'
                                  ? t('OnboardingWizard.disks.parity2')
                                  : t('OnboardingWizard.disks.dataType'),
                          })}
                        </span>
                        <span>{d.status}</span>
                      </div>
                    ))}
                </div>
              )}

              <ArrayBuilder onBuilt={() => setStep('info')} />

              <div className="onboarding__actions">
                <button type="button" className="btn" onClick={() => setStep('start')}>
                  {t('OnboardingWizard.common.back')}
                </button>
              </div>
            </>
          )}

          {step === 'info' && (
            <>
              <div className="eyebrow onboarding-hero__eyebrow">{t(`OnboardingWizard.infoSlides.${INFO_SLIDE_KEYS[infoIndex]}.eyebrow`)}</div>
              <div className="onboarding-hero__title">{t(`OnboardingWizard.infoSlides.${INFO_SLIDE_KEYS[infoIndex]}.title`)}</div>
              <div className="onboarding-hero__desc">{t(`OnboardingWizard.infoSlides.${INFO_SLIDE_KEYS[infoIndex]}.body`)}</div>

              <div className="onboarding-slide__dots">
                {INFO_SLIDE_KEYS.map((slideKey, i) => (
                  <span key={slideKey} className={`onboarding-slide__dot${i === infoIndex ? ' onboarding-slide__dot--active' : ''}`} />
                ))}
              </div>

              <div className="onboarding__actions">
                <button type="button" className="btn" onClick={() => setInfoIndex((i) => Math.max(0, i - 1))} disabled={infoIndex === 0}>
                  {t('OnboardingWizard.common.back')}
                </button>
                <div className="onboarding__actions-right">
                  {infoIndex < INFO_SLIDE_KEYS.length - 1 ? (
                    <button type="button" className="btn btn--primary" onClick={() => setInfoIndex((i) => i + 1)}>
                      {t('OnboardingWizard.next')}
                    </button>
                  ) : (
                    <button type="button" className="btn btn--primary" onClick={() => setStep('done')}>
                      {t('OnboardingWizard.gotIt')}
                    </button>
                  )}
                </div>
              </div>
            </>
          )}

          {step === 'done' && (
            <>
              <div className="eyebrow onboarding-hero__eyebrow">{t('OnboardingWizard.done.eyebrow')}</div>
              <div className="onboarding-hero__title">{t('OnboardingWizard.done.title')}</div>
              <div className="onboarding-hero__desc">{t('OnboardingWizard.done.desc')}</div>
              <div className="onboarding__actions">
                <div className="onboarding__actions-right">
                  <button type="button" className="btn btn--primary" onClick={onFinish}>
                    {t('OnboardingWizard.done.goToDashboard')}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

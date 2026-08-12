import { useEffect, useRef, useState } from 'react';
import { systemApi } from '../../api/systemApi';
import { useSystemStats } from '../../hooks/useSystemStats';
import { useArrayStatus } from '../../state/useArrayStatus';
import { ConfigRestoreWizard } from '../settings/ConfigRestoreWizard';
import { ImportArrayWizard } from '../settings/ImportArrayWizard';
import { ArrayBuilder } from './ArrayBuilder';

type Step = 'welcome' | 'start' | 'import' | 'restoreConfig' | 'disks' | 'info' | 'done';
type Stage = 0 | 1 | 2;

const STAGE_LABELS = ['Array', 'Tour', 'Done'];

function stageForStep(step: Step): Stage {
  if (step === 'info') return 1;
  if (step === 'done') return 2;
  return 0;
}

/**
 * Where to (re)open the wizard for the array's actual current state — used both on the
 * automatic first-run open and on manual "Replay setup tour" (see OnboardingGate). There's
 * deliberately no persisted "which step was I on" pointer: live array/cache state is always
 * authoritative, so a step is recomputed from it fresh every time rather than trusted from a
 * stale save. Both hasAnyDisk and hasDataDisk (see their computation above) read status.disks
 * directly rather than array.total_slots, which only reflects *committed* data disks and stays 0
 * for a disk that's been add-ed but not yet start-ed — exactly the state disks sit in for most of
 * the 'disks' step now that assigning doesn't auto-start after each one. NEW_ARRAY isn't used here
 * either: it means "disks assigned, first parity build still pending," which is already past the
 * disks/import step, not a sign of a blank array.
 *
 * 'welcome' (machine name/timezone) only ever appears here, on a genuinely blank array — it's a
 * one-time first-run convenience, not something worth resurfacing on every "Replay setup tour"
 * once the array's already configured, since Settings → About already covers editing both any
 * time. A second parity disk, more data disks, and a cache mirror are all Disks-page (or Settings
 * → Cache) actions once the array's up — not something this wizard asks about at all, so reaching
 * 'info' only ever depends on hasDataDisk, nothing about cache.
 */
function deriveStartStep(hasAnyDisk: boolean, hasDataDisk: boolean): Step {
  if (!hasAnyDisk) return 'welcome';
  if (!hasDataDisk) return 'disks';
  return 'info';
}

const INFO_SLIDES = [
  {
    eyebrow: 'Apps',
    title: 'Install ready-made apps',
    body: 'The Apps catalog has one-click installs for common self-hosted services — media servers, downloaders, home automation, and more. Find it any time from the sidebar.',
  },
  {
    eyebrow: 'Docker',
    title: 'Or run your own containers',
    body: "Bringing your own image? The Docker page pulls it, sets ports/volumes/env vars, and shows a live log tail — no app catalog entry needed.",
  },
  {
    eyebrow: 'LXC',
    title: 'Or a full lightweight VM',
    body: "When a container isn't isolated enough, LXC gives you a more complete lightweight VM instead — with its own storage location, separate from Docker's.",
  },
  {
    eyebrow: 'Notifications',
    title: 'Stay in the loop',
    body: 'Turn on notifications in Settings to hear about it — by email, Discord, or anything Apprise supports — when a disk fails, a parity check finishes, or something needs a look.',
  },
] as const;

interface OnboardingWizardProps {
  /** Always marks the wizard dismissed/completed and unmounts it — fired from every exit point
   *  (Skip, and finishing the tour). There's no separate "finished vs. skipped" outcome to
   *  distinguish: both mean "don't auto-open this again," which is exactly what dismissed=true
   *  represents. */
  onFinish: () => void;
}

export function OnboardingWizard({ onFinish }: OnboardingWizardProps) {
  const { status } = useArrayStatus();
  const stats = useSystemStats();
  const hasAnyDisk = status?.disks.some((d) => d.disk_id) ?? false;
  // Checked against status.disks directly, not array.total_slots — total_slots only reflects
  // *committed* data disks (see md_unraid.c's sb->num_disks update), staying 0 until a `start`
  // commits whatever's been add-ed so far, which ArrayBuilder's whole plan-then-build model
  // deliberately defers until the very end (see its own doc comment).
  const hasDataDisk = (status?.disks ?? []).some((d) => d.disk_id && d.type === 'data');

  const [step, setStep] = useState<Step>(() => deriveStartStep(hasAnyDisk, hasDataDisk));
  const [infoIndex, setInfoIndex] = useState(0);
  const [importedJustNow, setImportedJustNow] = useState(false);
  const [restoredJustNow, setRestoredJustNow] = useState(false);

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

  // Both fields already show this host's real current values (see the effect above) — Continue
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
  // resolve the actual resume step once — covers reopening mid-setup (a reload, or Replay)
  // landing somewhere other than the very first screen.
  const resolvedOnce = useRef(false);
  useEffect(() => {
    if (resolvedOnce.current || status === null) return;
    resolvedOnce.current = true;
    setStep(deriveStartStep(hasAnyDisk, hasDataDisk));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const stage = stageForStep(step);

  const handleImportClose = () => {
    setStep(importedJustNow ? deriveStartStep(hasAnyDisk, hasDataDisk) : 'start');
  };

  // A successful restore can bring back a fully-configured array (superblock included, when the
  // array was blank) plus shares/users/settings all at once — resolving the same way a successful
  // array import does covers both that case and the config-only case (superblock skipped, array
  // still blank) identically, since deriveStartStep would just land back on 'disks' for the latter
  // on next resolve anyway. Simplest to just re-derive live rather than special-case it here.
  const handleRestoreClose = () => {
    if (!restoredJustNow) {
      setStep('start');
      return;
    }
    setStep(deriveStartStep(hasAnyDisk, hasDataDisk));
  };

  return (
    <div className="onboarding">
      <div className="onboarding__chrome">
        <div className="onboarding__brand">
          <img src="/logo.png" alt="" className="onboarding__brand-logo" />
          <span className="onboarding__brand-title">nonraid setup</span>
        </div>
        {step !== 'done' && (
          <button type="button" className="btn onboarding__skip" onClick={onFinish}>
            Skip setup
          </button>
        )}
      </div>

      <div className="onboarding-track">
        {STAGE_LABELS.map((label, i) => (
          <div key={label} className="onboarding-track__item">
            {i > 0 && <div className="onboarding-rail" />}
            <div className={`onboarding-bay${i === stage ? ' onboarding-bay--active' : i < stage ? ' onboarding-bay--done' : ''}`}>
              <div className="onboarding-bay__glyph" />
              <div className="onboarding-bay__label">{label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="onboarding__stage">
        <div className="onboarding__panel">
          {step === 'welcome' && (
            <>
              <div className="eyebrow onboarding-hero__eyebrow">First-time setup</div>
              <div className="onboarding-hero__title">Name this machine</div>
              <div className="onboarding-hero__desc">
                A couple of quick basics before the array — both are already set to sensible defaults and can always
                be changed later from Settings &rarr; About.
              </div>

              <label className="form-field">
                <span className="form-field__label">Hostname</span>
                <input
                  className="history-input"
                  value={hostnameDraft}
                  onChange={(e) => setHostnameDraft(e.target.value)}
                  disabled={savingWelcome}
                />
              </label>

              <label className="form-field">
                <span className="form-field__label">Timezone</span>
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
                    {savingWelcome ? 'Saving…' : 'Continue'}
                  </button>
                </div>
              </div>
            </>
          )}

          {step === 'start' && (
            <>
              <div className="eyebrow onboarding-hero__eyebrow">First-time setup</div>
              <div className="onboarding-hero__title">Let's build your array</div>
              <div className="onboarding-hero__desc">
                Every disk that's part of the array — one or two parity disks plus your data disks — needs to be
                assigned before it can start. If this isn't a fresh install, you can bring an existing array's
                configuration in instead of assigning disks by hand.
              </div>
              <div className="onboarding-choices">
                <button type="button" className="onboarding-choice onboarding-choice--primary" onClick={() => setStep('disks')}>
                  <span className="onboarding-choice__title">Build a new array</span>
                  <span className="onboarding-choice__desc">Assign a parity disk and your data disks now. You can always add more later.</span>
                </button>
                <button
                  type="button"
                  className="onboarding-choice"
                  onClick={() => {
                    setImportedJustNow(false);
                    setStep('import');
                  }}
                >
                  <span className="onboarding-choice__title">Import an existing array</span>
                  <span className="onboarding-choice__desc">
                    From Unraid or a previous nonraid install — both save the same superblock file.
                  </span>
                </button>
                <button
                  type="button"
                  className="onboarding-choice"
                  onClick={() => {
                    setRestoredJustNow(false);
                    setStep('restoreConfig');
                  }}
                >
                  <span className="onboarding-choice__title">Restore a full config backup</span>
                  <span className="onboarding-choice__desc">
                    Bring back everything from a previous nonraid-webui install at once — array, shares, users, and
                    settings — from a config backup archive.
                  </span>
                </button>
              </div>
            </>
          )}

          {step === 'import' && <ImportArrayWizard onClose={handleImportClose} onImported={() => setImportedJustNow(true)} />}
          {step === 'restoreConfig' && <ConfigRestoreWizard onClose={handleRestoreClose} onRestored={() => setRestoredJustNow(true)} />}

          {step === 'disks' && (
            <>
              <div className="eyebrow onboarding-hero__eyebrow">First-time setup &middot; Array</div>
              <div className="onboarding-hero__title">Build your array</div>
              <div className="onboarding-hero__desc">
                Pick a parity disk and a data disk, then press Build Array. Initialization — clearing the data disk
                and building parity — happens in the background, so you don't need to wait here. Once it's running,
                add more disks, a second parity disk, or a cache mirror any time from the Disks page.
              </div>

              {status && status.disks.some((d) => d.disk_id) && (
                <div className="onboarding-summary">
                  {/* nmdctl always reports a placeholder slot-0 (parity) row with an empty
                      disk_id even on a totally blank array — filtered out here so this only
                      shows disks actually assigned so far, not an empty template row. */}
                  {status.disks
                    .filter((d) => d.disk_id)
                    .map((d) => (
                      <div key={d.slot} className="onboarding-summary__row">
                        <span>
                          Slot {d.slot} &middot; {d.type === 'P' ? 'Parity 1' : d.type === 'Q' ? 'Parity 2' : 'Data'}
                        </span>
                        <span>{d.status}</span>
                      </div>
                    ))}
                </div>
              )}

              <ArrayBuilder onBuilt={() => setStep('info')} />

              <div className="onboarding__actions">
                <button type="button" className="btn" onClick={() => setStep('start')}>
                  Back
                </button>
              </div>
            </>
          )}

          {step === 'info' && (
            <>
              <div className="eyebrow onboarding-hero__eyebrow">{INFO_SLIDES[infoIndex].eyebrow}</div>
              <div className="onboarding-hero__title">{INFO_SLIDES[infoIndex].title}</div>
              <div className="onboarding-hero__desc">{INFO_SLIDES[infoIndex].body}</div>

              <div className="onboarding-slide__dots">
                {INFO_SLIDES.map((slide, i) => (
                  <span key={slide.eyebrow} className={`onboarding-slide__dot${i === infoIndex ? ' onboarding-slide__dot--active' : ''}`} />
                ))}
              </div>

              <div className="onboarding__actions">
                <button type="button" className="btn" onClick={() => setInfoIndex((i) => Math.max(0, i - 1))} disabled={infoIndex === 0}>
                  Back
                </button>
                <div className="onboarding__actions-right">
                  {infoIndex < INFO_SLIDES.length - 1 ? (
                    <button type="button" className="btn btn--primary" onClick={() => setInfoIndex((i) => i + 1)}>
                      Next
                    </button>
                  ) : (
                    <button type="button" className="btn btn--primary" onClick={() => setStep('done')}>
                      Got it
                    </button>
                  )}
                </div>
              </div>
            </>
          )}

          {step === 'done' && (
            <>
              <div className="eyebrow onboarding-hero__eyebrow">Setup complete</div>
              <div className="onboarding-hero__title">You're all set</div>
              <div className="onboarding-hero__desc">
                Head to the Dashboard to check on the array, or Disks to keep adding storage. You can replay this
                tour any time from Settings &rarr; About.
              </div>
              <div className="onboarding__actions">
                <div className="onboarding__actions-right">
                  <button type="button" className="btn btn--primary" onClick={onFinish}>
                    Go to Dashboard
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

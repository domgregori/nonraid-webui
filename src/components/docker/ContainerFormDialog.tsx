import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { dockerApi } from '../../api/dockerApi';
import { installButtonLabel, useInstallProgress } from '../../hooks/useInstallProgress';
import { PathAutocomplete } from '../shared/PathAutocomplete';
import type {
  ContainerDeviceMapping,
  ContainerEnvVar,
  ContainerPortMapping,
  ContainerVolumeMount,
  HostDevice,
  ManualContainerPlan,
  ManualContainerRequest,
} from '../../types/dockerApi';
import { CA_APP_NAME_LABEL } from '../../types/dockerApi';
import { InstallProgress } from './InstallProgress';

interface ContainerFormDialogProps {
  mode: 'add' | 'edit';
  containerId?: string; // required for mode === 'edit'
  onClose: () => void;
  onDone: () => void; // refetch the container list
}

type Stage = 'loading' | 'editing' | 'reviewed' | 'installing' | 'done' | 'load-error';

// Sentinel for "not one of the curated devices" - same pattern as
// CreateLxcDialog's distro picker (CUSTOM_VALUE). A device path typed by
// hand, or loaded from an existing container that used something outside
// the curated GPU/audio/serial categories, falls back to free text.
const DEVICE_CUSTOM = '__custom__';

// Docker's own network modes, always offered even if the daemon's own listNetworks() doesn't
// happen to include them (host/none aren't real network objects, and a fresh daemon may not
// have re-created "bridge" under an unexpected name).
const BUILTIN_NETWORKS = ['bridge', 'host', 'none'];
const NETWORK_CUSTOM = '__custom_network__';

function updateAt<T>(list: T[], index: number, patch: Partial<T>): T[] {
  return list.map((item, i) => (i === index ? { ...item, ...patch } : item));
}

function removeAt<T>(list: T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

export function ContainerFormDialog({ mode, containerId, onClose, onDone }: ContainerFormDialogProps) {
  const { t } = useTranslation('docker');
  const [stage, setStage] = useState<Stage>(mode === 'edit' ? 'loading' : 'editing');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [caAppName, setCaAppName] = useState<string | null>(null);

  const [containerName, setContainerName] = useState('');
  const [image, setImage] = useState('');
  const [network, setNetwork] = useState('bridge');
  const [privileged, setPrivileged] = useState(false);
  const [env, setEnv] = useState<ContainerEnvVar[]>([]);
  const [ports, setPorts] = useState<ContainerPortMapping[]>([]);
  const [binds, setBinds] = useState<ContainerVolumeMount[]>([]);
  const [devices, setDevices] = useState<ContainerDeviceMapping[]>([]);
  const [privilegedAck, setPrivilegedAck] = useState(false);
  const [autostart, setAutostart] = useState(false);
  const [availableDevices, setAvailableDevices] = useState<HostDevice[]>([]);
  const [availableNetworks, setAvailableNetworks] = useState<string[]>([]);

  useEffect(() => {
    dockerApi.listDevices().then(setAvailableDevices).catch(() => {});
    dockerApi.listNetworks().then(setAvailableNetworks).catch(() => {});
  }, []);

  const networkOptions = [...BUILTIN_NETWORKS, ...availableNetworks.filter((n) => !BUILTIN_NETWORKS.includes(n))];

  const [plan, setPlan] = useState<ManualContainerPlan | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installMessage, setInstallMessage] = useState<string | null>(null);
  const { progress: installProgress, log: pullLog, logRef: pullLogRef, onProgress, reset: resetProgress } = useInstallProgress();

  useEffect(() => {
    if (mode !== 'edit' || !containerId) return;
    let mounted = true;
    dockerApi
      .inspectContainer(containerId)
      .then((detail) => {
        if (!mounted) return;
        setContainerName(detail.name);
        setImage(detail.image);
        setNetwork(detail.network);
        setPrivileged(detail.privileged);
        setEnv(detail.env);
        setPorts(detail.ports);
        setBinds(detail.binds);
        setDevices(detail.devices);
        setAutostart(detail.autostart);
        setCaAppName(detail.labels[CA_APP_NAME_LABEL] ?? null);
        setStage('editing');
      })
      .catch((err) => {
        if (!mounted) return;
        setLoadError((err as Error).message);
        setStage('load-error');
      });
    return () => {
      mounted = false;
    };
  }, [mode, containerId]);

  const invalidate = () => {
    setPlan(null);
    setStage('editing');
  };

  const buildRequest = (): ManualContainerRequest => ({
    containerName,
    image,
    network,
    privileged,
    env: env.filter((e) => e.name.trim()),
    ports: ports.filter((p) => p.containerPort && p.hostPort),
    binds: binds.filter((b) => b.hostPath && b.containerPath),
    devices: devices.filter((d) => d.hostPath && d.containerPath),
    privilegedAck,
    autostart,
  });

  const handleReview = async () => {
    setReviewError(null);
    setStage('loading');
    try {
      const result = await dockerApi.planContainer(buildRequest());
      setPlan(result);
      setStage('reviewed');
    } catch (err) {
      setReviewError((err as Error).message);
      setStage('editing');
    }
  };

  const handleSubmit = async () => {
    setInstallError(null);
    resetProgress();
    setStage('installing');
    try {
      const result =
        mode === 'add'
          ? await dockerApi.createContainer(buildRequest(), onProgress)
          : await dockerApi.recreateContainer(containerId!, buildRequest(), onProgress);
      setInstallMessage(result.message);
      setStage('done');
      onDone();
    } catch (err) {
      setInstallError((err as Error).message);
      setStage('reviewed');
    }
  };

  const locked = stage === 'installing' || stage === 'done';
  const needsElevatedAck = plan ? plan.requiresPrivilegedAck : privileged || network === 'host' || devices.some((d) => d.hostPath.startsWith('/dev/'));

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog apps-install-dialog">
        <div className="dialog__head">
          <div className="dialog__title">
            {mode === 'add' ? t('ContainerFormDialog.addTitle') : t('ContainerFormDialog.editTitle', { name: containerName || t('ContainerFormDialog.containerFallback') })}
          </div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label={t('ContainerFormDialog.close')}>
            &#10005;
          </button>
        </div>

        {stage === 'loading' && !containerName && <div className="status-note">{t('ContainerFormDialog.loadingContainer')}</div>}
        {stage === 'load-error' && <div className="status-note status-note--error">{loadError}</div>}

        {(stage !== 'loading' || containerName) && stage !== 'load-error' && (
          <div className="dialog__body">
            {caAppName && <div className="status-note">{t('ContainerFormDialog.installedViaCA', { name: caAppName })}</div>}

            <label className="form-field">
              <span className="form-field__label">{t('ContainerFormDialog.containerNameLabel')}</span>
              {locked ? (
                <div className="form-field__value">{containerName}</div>
              ) : (
                <input
                  className="history-input"
                  style={{ width: '100%' }}
                  value={containerName}
                  onChange={(e) => {
                    setContainerName(e.target.value);
                    invalidate();
                  }}
                />
              )}
            </label>

            <label className="form-field">
              <span className="form-field__label">{t('ContainerFormDialog.imageLabel')}</span>
              {locked ? (
                <div className="form-field__value">{image}</div>
              ) : (
                <input
                  className="history-input"
                  style={{ width: '100%' }}
                  placeholder={t('ContainerFormDialog.imagePlaceholder')}
                  value={image}
                  onChange={(e) => {
                    setImage(e.target.value);
                    invalidate();
                  }}
                />
              )}
            </label>

            <label className="form-field">
              <span className="form-field__label">{t('ContainerFormDialog.networkLabel')}</span>
              {locked ? (
                <div className="form-field__value">{network}</div>
              ) : (
                <>
                  <select
                    className="history-input"
                    style={{ width: '100%' }}
                    value={networkOptions.includes(network) ? network : NETWORK_CUSTOM}
                    onChange={(e) => {
                      const v = e.target.value;
                      setNetwork(v === NETWORK_CUSTOM ? '' : v);
                      invalidate();
                    }}
                  >
                    {networkOptions.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                    <option value={NETWORK_CUSTOM}>{t('ContainerFormDialog.customOption')}</option>
                  </select>
                  {!networkOptions.includes(network) && (
                    <input
                      className="history-input"
                      style={{ width: '100%', marginTop: 8 }}
                      placeholder={t('ContainerFormDialog.existingNetworkPlaceholder')}
                      value={network}
                      onChange={(e) => {
                        setNetwork(e.target.value);
                        invalidate();
                      }}
                    />
                  )}
                </>
              )}
              <span className="apps-field__hint">{t('ContainerFormDialog.networkHint')}</span>
            </label>

            {!locked && (
              <label className="apps-privileged-banner__ack">
                <input
                  type="checkbox"
                  checked={privileged}
                  onChange={(e) => {
                    setPrivileged(e.target.checked);
                    invalidate();
                  }}
                />
                {t('ContainerFormDialog.privilegedLabel')}
              </label>
            )}

            {!locked && (
              <label className="apps-privileged-banner__ack">
                <input
                  type="checkbox"
                  checked={autostart}
                  onChange={(e) => {
                    setAutostart(e.target.checked);
                    invalidate();
                  }}
                />
                {t('ContainerFormDialog.autostartLabel')}
              </label>
            )}

            {needsElevatedAck && (plan ? plan.elevatedAccessReasons.length > 0 : true) && (
              <div className="apps-privileged-banner">
                <div className="apps-privileged-banner__title">{t('ContainerFormDialog.elevatedAccessTitle')}</div>
                <div className="apps-privileged-banner__body">
                  {plan
                    ? plan.elevatedAccessReasons.map((reason) => <div key={reason}>{reason}</div>)
                    : t('ContainerFormDialog.elevatedAccessFallback')}
                  {t('ContainerFormDialog.elevatedAccessSuffix')}
                </div>
                {!locked && (
                  <label className="apps-privileged-banner__ack">
                    <input
                      type="checkbox"
                      checked={privilegedAck}
                      onChange={(e) => {
                        setPrivilegedAck(e.target.checked);
                        invalidate();
                      }}
                    />
                    {t('ContainerFormDialog.elevatedAccessAck')}
                  </label>
                )}
              </div>
            )}

            <ListField
              label={t('ContainerFormDialog.portsLabel')}
              locked={locked}
              items={ports}
              onAdd={() => setPorts([...ports, { containerPort: 0, hostPort: 0, protocol: 'tcp' }])}
              renderLocked={(p, i) => (
                <div key={i}>
                  {p.hostPort} → {p.containerPort}/{p.protocol}
                </div>
              )}
              renderHeader={
                ports.length > 0 ? (
                  <div className="container-form-row container-form-row--header">
                    <span className="apps-field__hint">{t('ContainerFormDialog.portsHintContainer')}</span>
                    <span className="apps-field__hint">{t('ContainerFormDialog.portsHintHost')}</span>
                  </div>
                ) : null
              }
              renderRow={(p, i) => (
                <div className="container-form-row" key={i}>
                  <input
                    className="history-input"
                    type="number"
                    placeholder={t('ContainerFormDialog.containerPortPlaceholder')}
                    value={p.containerPort || ''}
                    onChange={(e) => {
                      setPorts(updateAt(ports, i, { containerPort: Number(e.target.value) }));
                      invalidate();
                    }}
                  />
                  <input
                    className="history-input"
                    type="number"
                    placeholder={t('ContainerFormDialog.hostPortPlaceholder')}
                    value={p.hostPort || ''}
                    onChange={(e) => {
                      setPorts(updateAt(ports, i, { hostPort: Number(e.target.value) }));
                      invalidate();
                    }}
                  />
                  <select
                    className="history-input"
                    value={p.protocol}
                    onChange={(e) => {
                      setPorts(updateAt(ports, i, { protocol: e.target.value as 'tcp' | 'udp' }));
                      invalidate();
                    }}
                  >
                    <option value="tcp">tcp</option>
                    <option value="udp">udp</option>
                  </select>
                  <button
                    type="button"
                    className="container-form-row__remove"
                    onClick={() => {
                      setPorts(removeAt(ports, i));
                      invalidate();
                    }}
                    aria-label={t('ContainerFormDialog.removePort')}
                  >
                    &#10005;
                  </button>
                </div>
              )}
            />

            <ListField
              label={t('ContainerFormDialog.envLabel')}
              locked={locked}
              items={env}
              onAdd={() => setEnv([...env, { name: '', value: '' }])}
              renderLocked={(e, i) => (
                <div key={i}>
                  {e.name}={e.value}
                </div>
              )}
              renderRow={(e, i) => (
                <div className="container-form-row" key={i}>
                  <input
                    className="history-input"
                    placeholder={t('ContainerFormDialog.namePlaceholder')}
                    value={e.name}
                    onChange={(ev) => {
                      setEnv(updateAt(env, i, { name: ev.target.value }));
                      invalidate();
                    }}
                  />
                  <input
                    className="history-input"
                    placeholder={t('ContainerFormDialog.valuePlaceholder')}
                    value={e.value}
                    onChange={(ev) => {
                      setEnv(updateAt(env, i, { value: ev.target.value }));
                      invalidate();
                    }}
                  />
                  <button
                    type="button"
                    className="container-form-row__remove"
                    onClick={() => {
                      setEnv(removeAt(env, i));
                      invalidate();
                    }}
                    aria-label={t('ContainerFormDialog.removeVariable')}
                  >
                    &#10005;
                  </button>
                </div>
              )}
            />

            <ListField
              label={t('ContainerFormDialog.volumesLabel')}
              locked={locked}
              items={binds}
              onAdd={() => setBinds([...binds, { hostPath: '', containerPath: '', readOnly: false }])}
              renderLocked={(b, i) => (
                <div key={i}>
                  {b.hostPath} → {b.containerPath}
                  {b.readOnly ? t('ContainerFormDialog.readOnlySuffix') : ''}
                </div>
              )}
              renderRow={(b, i) => {
                const issue = plan?.binds[i] && !plan.binds[i].allowed;
                return (
                  <div className="container-form-row" key={i}>
                    <PathAutocomplete
                      scope="binds"
                      className={`history-input${issue ? ' apps-field--error' : ''}`}
                      placeholder={t('ContainerFormDialog.hostPathPlaceholder')}
                      value={b.hostPath}
                      onChange={(v) => {
                        setBinds(updateAt(binds, i, { hostPath: v }));
                        invalidate();
                      }}
                    />
                    <input
                      className="history-input"
                      placeholder={t('ContainerFormDialog.containerPathPlaceholder')}
                      value={b.containerPath}
                      onChange={(e) => {
                        setBinds(updateAt(binds, i, { containerPath: e.target.value }));
                        invalidate();
                      }}
                    />
                    <label className="container-form-row__checkbox">
                      <input
                        type="checkbox"
                        checked={b.readOnly}
                        onChange={(e) => {
                          setBinds(updateAt(binds, i, { readOnly: e.target.checked }));
                          invalidate();
                        }}
                      />
                      {t('ContainerFormDialog.roLabel')}
                    </label>
                    <button
                      type="button"
                      className="container-form-row__remove"
                      onClick={() => {
                        setBinds(removeAt(binds, i));
                        invalidate();
                      }}
                      aria-label={t('ContainerFormDialog.removeVolume')}
                    >
                      &#10005;
                    </button>
                  </div>
                );
              }}
            />

            <ListField
              label={t('ContainerFormDialog.devicesLabel')}
              locked={locked}
              items={devices}
              onAdd={() => setDevices([...devices, { hostPath: '', containerPath: '' }])}
              renderLocked={(d, i) => (
                <div key={i}>
                  {d.hostPath} → {d.containerPath}
                </div>
              )}
              renderRow={(d, i) => {
                const issue = plan?.devices[i] && !plan.devices[i].allowed;
                // Deliberately not keyed on "hostPath === ''" - that would make picking "Custom
                // path…" (which clears hostPath so there's something to type into) collapse
                // straight back to looking unselected, since an empty path also fails the match.
                // Any non-matched value, including empty, means "show the custom field."
                const matched = availableDevices.some((dev) => dev.path === d.hostPath);
                const selectValue = matched ? d.hostPath : DEVICE_CUSTOM;
                return (
                  <div key={i}>
                    <div className="container-form-row">
                      <select
                        className={`history-input${issue ? ' apps-field--error' : ''}`}
                        value={selectValue}
                        onChange={(e) => {
                          const v = e.target.value;
                          setDevices(updateAt(devices, i, { hostPath: v === DEVICE_CUSTOM ? '' : v }));
                          invalidate();
                        }}
                      >
                        {availableDevices.map((dev) => (
                          <option key={dev.path} value={dev.path}>
                            {dev.label}
                          </option>
                        ))}
                        <option value={DEVICE_CUSTOM}>{t('ContainerFormDialog.customPathOption')}</option>
                      </select>
                      <input
                        className="history-input"
                        placeholder={t('ContainerFormDialog.containerPathPlaceholder')}
                        value={d.containerPath}
                        onChange={(e) => {
                          setDevices(updateAt(devices, i, { containerPath: e.target.value }));
                          invalidate();
                        }}
                      />
                      <button
                        type="button"
                        className="container-form-row__remove"
                        onClick={() => {
                          setDevices(removeAt(devices, i));
                          invalidate();
                        }}
                        aria-label={t('ContainerFormDialog.removeDevice')}
                      >
                        &#10005;
                      </button>
                    </div>
                    {selectValue === DEVICE_CUSTOM && (
                      <div className="container-form-row">
                        <input
                          className={`history-input${issue ? ' apps-field--error' : ''}`}
                          placeholder={t('ContainerFormDialog.hostPathDevPlaceholder')}
                          value={d.hostPath}
                          onChange={(e) => {
                            setDevices(updateAt(devices, i, { hostPath: e.target.value }));
                            invalidate();
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              }}
            />

            {reviewError && <div className="status-note status-note--error">{reviewError}</div>}

            {stage === 'reviewed' && plan && (
              <div className="apps-plan-review">
                <div className="apps-plan-review__title">
                  {t('ContainerFormDialog.reviewBeforeTitle', {
                    action: mode === 'add' ? t('ContainerFormDialog.reviewBeforeCreating') : t('ContainerFormDialog.reviewBeforeApplying'),
                  })}
                </div>
                {plan.errors.length > 0 ? (
                  <div className="status-note status-note--error">
                    {plan.errors.map((e) => (
                      <div key={e}>{e}</div>
                    ))}
                  </div>
                ) : (
                  <div className="apps-plan-review__section">
                    <div className="apps-plan-review__kv">
                      <span className="apps-plan-review__kv-label">{t('ContainerFormDialog.imageLabel')}</span>
                      <span className="apps-plan-review__kv-value">{plan.image}</span>
                    </div>
                    <div className="apps-plan-review__kv">
                      <span className="apps-plan-review__kv-label">{t('ContainerFormDialog.networkLabel')}</span>
                      <span className="apps-plan-review__kv-value">
                        {plan.network}
                        {plan.privileged ? t('ContainerFormDialog.privilegedSuffix') : ''}
                        {plan.autostart ? t('ContainerFormDialog.autostartSuffix') : ''}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {stage === 'installing' && <InstallProgress progress={installProgress} log={pullLog} logRef={pullLogRef} />}

            {installError && <div className="status-note status-note--error">{installError}</div>}

            {stage === 'done' && installMessage && <div className="status-note">{installMessage}</div>}

            <div className="dialog__actions">
              <button type="button" className="btn" onClick={onClose}>
                {stage === 'done' ? t('ContainerFormDialog.close') : t('ContainerFormDialog.cancel')}
              </button>
              {stage !== 'done' && stage !== 'reviewed' && stage !== 'installing' && (
                <button type="button" className="btn--primary" disabled={stage === 'loading'} onClick={handleReview}>
                  {stage === 'loading' ? t('ContainerFormDialog.reviewing') : t('ContainerFormDialog.review')}
                </button>
              )}
              {stage === 'reviewed' && (
                <>
                  <button type="button" className="btn" onClick={handleReview}>
                    {t('ContainerFormDialog.recheck')}
                  </button>
                  <button
                    type="button"
                    className="btn--primary"
                    disabled={!plan || plan.errors.length > 0 || (plan.requiresPrivilegedAck && !privilegedAck)}
                    onClick={handleSubmit}
                  >
                    {mode === 'add' ? t('ContainerFormDialog.confirmCreate') : t('ContainerFormDialog.confirmChanges')}
                  </button>
                </>
              )}
              {stage === 'installing' && (
                <button type="button" className="btn--primary" disabled>
                  {installButtonLabel(t, installProgress)}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

interface ListFieldProps<T> {
  label: string;
  locked: boolean;
  items: T[];
  onAdd: () => void;
  renderRow: (item: T, index: number) => ReactNode;
  renderLocked: (item: T, index: number) => ReactNode;
  renderHeader?: ReactNode;
}

function ListField<T>({ label, locked, items, onAdd, renderRow, renderLocked, renderHeader }: ListFieldProps<T>) {
  const { t } = useTranslation('docker');
  return (
    <div className="form-field">
      <span className="form-field__label">{label}</span>
      {locked ? (
        <div className="form-field__value">{items.length === 0 ? '-' : items.map((item, i) => renderLocked(item, i))}</div>
      ) : (
        <>
          {renderHeader}
          {items.map((item, i) => renderRow(item, i))}
          <button type="button" className="container-form-list__add" onClick={onAdd}>
            {t('ContainerFormDialog.addButton')}
          </button>
        </>
      )}
    </div>
  );
}

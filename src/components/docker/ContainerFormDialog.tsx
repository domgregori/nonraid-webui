import { useEffect, useState, type ReactNode } from 'react';
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

// Sentinel for "not one of the curated devices" — same pattern as
// CreateLxcDialog's distro picker (CUSTOM_VALUE). A device path typed by
// hand, or loaded from an existing container that used something outside
// the curated GPU/audio/serial categories, falls back to free text.
const DEVICE_CUSTOM = '__custom__';

function updateAt<T>(list: T[], index: number, patch: Partial<T>): T[] {
  return list.map((item, i) => (i === index ? { ...item, ...patch } : item));
}

function removeAt<T>(list: T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

export function ContainerFormDialog({ mode, containerId, onClose, onDone }: ContainerFormDialogProps) {
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
  const [availableDevices, setAvailableDevices] = useState<HostDevice[]>([]);

  useEffect(() => {
    dockerApi.listDevices().then(setAvailableDevices).catch(() => {});
  }, []);

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
          <div className="dialog__title">{mode === 'add' ? 'Add Container' : `Edit ${containerName || 'container'}`}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        {stage === 'loading' && !containerName && <div className="status-note">Loading container…</div>}
        {stage === 'load-error' && <div className="status-note status-note--error">{loadError}</div>}

        {(stage !== 'loading' || containerName) && stage !== 'load-error' && (
          <div className="dialog__body">
            {caAppName && (
              <div className="status-note">
                Installed via Community Applications as &quot;{caAppName}&quot;. Editing here changes the running container
                directly.
              </div>
            )}

            <label className="form-field">
              <span className="form-field__label">Container name</span>
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
              <span className="form-field__label">Image</span>
              {locked ? (
                <div className="form-field__value">{image}</div>
              ) : (
                <input
                  className="history-input"
                  style={{ width: '100%' }}
                  placeholder="e.g. nginx:latest"
                  value={image}
                  onChange={(e) => {
                    setImage(e.target.value);
                    invalidate();
                  }}
                />
              )}
            </label>

            <label className="form-field">
              <span className="form-field__label">Network</span>
              {locked ? (
                <div className="form-field__value">{network}</div>
              ) : (
                <input
                  className="history-input"
                  style={{ width: '100%' }}
                  placeholder="bridge"
                  value={network}
                  onChange={(e) => {
                    setNetwork(e.target.value || 'bridge');
                    invalidate();
                  }}
                />
              )}
              <span className="apps-field__hint">bridge, host, none, or an existing network's name</span>
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
                Privileged (full host access)
              </label>
            )}

            {needsElevatedAck && (plan ? plan.elevatedAccessReasons.length > 0 : true) && (
              <div className="apps-privileged-banner">
                <div className="apps-privileged-banner__title">Requires extra host access</div>
                <div className="apps-privileged-banner__body">
                  {plan
                    ? plan.elevatedAccessReasons.map((reason) => <div key={reason}>{reason}</div>)
                    : 'Privileged mode, host networking, and device passthrough all grant this container full or partial host access.'}
                  Only proceed if you trust this configuration.
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
                    I understand and want to proceed
                  </label>
                )}
              </div>
            )}

            <ListField
              label="Ports"
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
                    <span className="apps-field__hint">Container port — what the app listens on inside</span>
                    <span className="apps-field__hint">Host port — what you'll actually browse to</span>
                  </div>
                ) : null
              }
              renderRow={(p, i) => (
                <div className="container-form-row" key={i}>
                  <input
                    className="history-input"
                    type="number"
                    placeholder="e.g. 80"
                    value={p.containerPort || ''}
                    onChange={(e) => {
                      setPorts(updateAt(ports, i, { containerPort: Number(e.target.value) }));
                      invalidate();
                    }}
                  />
                  <input
                    className="history-input"
                    type="number"
                    placeholder="e.g. 8080"
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
                    aria-label="Remove port"
                  >
                    &#10005;
                  </button>
                </div>
              )}
            />

            <ListField
              label="Environment Variables"
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
                    placeholder="Name"
                    value={e.name}
                    onChange={(ev) => {
                      setEnv(updateAt(env, i, { name: ev.target.value }));
                      invalidate();
                    }}
                  />
                  <input
                    className="history-input"
                    placeholder="Value"
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
                    aria-label="Remove variable"
                  >
                    &#10005;
                  </button>
                </div>
              )}
            />

            <ListField
              label="Volumes"
              locked={locked}
              items={binds}
              onAdd={() => setBinds([...binds, { hostPath: '', containerPath: '', readOnly: false }])}
              renderLocked={(b, i) => (
                <div key={i}>
                  {b.hostPath} → {b.containerPath}
                  {b.readOnly ? ' (read-only)' : ''}
                </div>
              )}
              renderRow={(b, i) => {
                const issue = plan?.binds[i] && !plan.binds[i].allowed;
                return (
                  <div className="container-form-row" key={i}>
                    <PathAutocomplete
                      scope="binds"
                      className={`history-input${issue ? ' apps-field--error' : ''}`}
                      placeholder="Host path"
                      value={b.hostPath}
                      onChange={(v) => {
                        setBinds(updateAt(binds, i, { hostPath: v }));
                        invalidate();
                      }}
                    />
                    <input
                      className="history-input"
                      placeholder="Container path"
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
                      RO
                    </label>
                    <button
                      type="button"
                      className="container-form-row__remove"
                      onClick={() => {
                        setBinds(removeAt(binds, i));
                        invalidate();
                      }}
                      aria-label="Remove volume"
                    >
                      &#10005;
                    </button>
                  </div>
                );
              }}
            />

            <ListField
              label="Devices"
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
                // Deliberately not keyed on "hostPath === ''" — that would make picking "Custom
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
                        <option value={DEVICE_CUSTOM}>Custom path…</option>
                      </select>
                      <input
                        className="history-input"
                        placeholder="Container path"
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
                        aria-label="Remove device"
                      >
                        &#10005;
                      </button>
                    </div>
                    {selectValue === DEVICE_CUSTOM && (
                      <div className="container-form-row">
                        <input
                          className={`history-input${issue ? ' apps-field--error' : ''}`}
                          placeholder="Host path (/dev/...)"
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
                <div className="apps-plan-review__title">Review before {mode === 'add' ? 'creating' : 'applying changes'}</div>
                {plan.errors.length > 0 ? (
                  <div className="status-note status-note--error">
                    {plan.errors.map((e) => (
                      <div key={e}>{e}</div>
                    ))}
                  </div>
                ) : (
                  <div className="apps-plan-review__section">
                    <div className="apps-plan-review__kv">
                      <span className="apps-plan-review__kv-label">Image</span>
                      <span className="apps-plan-review__kv-value">{plan.image}</span>
                    </div>
                    <div className="apps-plan-review__kv">
                      <span className="apps-plan-review__kv-label">Network</span>
                      <span className="apps-plan-review__kv-value">
                        {plan.network}
                        {plan.privileged ? ' · privileged' : ''}
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
                {stage === 'done' ? 'Close' : 'Cancel'}
              </button>
              {stage !== 'done' && stage !== 'reviewed' && stage !== 'installing' && (
                <button type="button" className="btn--primary" disabled={stage === 'loading'} onClick={handleReview}>
                  {stage === 'loading' ? 'Reviewing…' : 'Review'}
                </button>
              )}
              {stage === 'reviewed' && (
                <>
                  <button type="button" className="btn" onClick={handleReview}>
                    Re-check
                  </button>
                  <button
                    type="button"
                    className="btn--primary"
                    disabled={!plan || plan.errors.length > 0 || (plan.requiresPrivilegedAck && !privilegedAck)}
                    onClick={handleSubmit}
                  >
                    {mode === 'add' ? 'Confirm create' : 'Confirm changes'}
                  </button>
                </>
              )}
              {stage === 'installing' && (
                <button type="button" className="btn--primary" disabled>
                  {installButtonLabel(installProgress)}
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
  return (
    <div className="form-field">
      <span className="form-field__label">{label}</span>
      {locked ? (
        <div className="form-field__value">{items.length === 0 ? '—' : items.map((item, i) => renderLocked(item, i))}</div>
      ) : (
        <>
          {renderHeader}
          {items.map((item, i) => renderRow(item, i))}
          <button type="button" className="container-form-list__add" onClick={onAdd}>
            + Add
          </button>
        </>
      )}
    </div>
  );
}

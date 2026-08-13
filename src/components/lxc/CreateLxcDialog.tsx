import { useEffect, useState } from 'react';
import { lxcApi } from '../../api/lxcApi';
import type { CreateLxcProgress, LxcDistroOption } from '../../types/lxcApi';

interface CreateLxcDialogProps {
  onClose: () => void;
  onDone: () => void;
}

type Stage = 'loading-options' | 'editing' | 'creating' | 'done' | 'load-error';

const CUSTOM_VALUE = '__custom__';

function distroKey(d: LxcDistroOption): string {
  return `${d.distribution}/${d.release}`;
}

export function CreateLxcDialog({ onClose, onDone }: CreateLxcDialogProps) {
  const [stage, setStage] = useState<Stage>('loading-options');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [distros, setDistros] = useState<LxcDistroOption[]>([]);
  const [bridges, setBridges] = useState<string[]>([]);
  const [interfaces, setInterfaces] = useState<string[]>([]);
  const [defaultArch, setDefaultArch] = useState('amd64');

  const [selectedDistroKey, setSelectedDistroKey] = useState<string>(CUSTOM_VALUE);
  const [name, setName] = useState('');
  const [distribution, setDistribution] = useState('');
  const [release, setRelease] = useState('');
  const [arch, setArch] = useState('amd64');
  const [networkType, setNetworkType] = useState<'bridge' | 'macvlan'>('bridge');
  const [bridge, setBridge] = useState('');
  const [autostart, setAutostart] = useState(false);
  const [description, setDescription] = useState('');
  const [webUiUrl, setWebUiUrl] = useState('');

  const [progress, setProgress] = useState<CreateLxcProgress | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([lxcApi.listDistros(), lxcApi.listBridges(), lxcApi.listInterfaces()])
      .then(([distrosRes, bridgesRes, interfacesRes]) => {
        if (!mounted) return;
        setDistros(distrosRes.distros);
        setDefaultArch(distrosRes.defaultArch);
        setArch(distrosRes.defaultArch);
        setBridges(bridgesRes);
        setInterfaces(interfacesRes);
        if (bridgesRes.length > 0) setBridge(bridgesRes[0]);
        if (distrosRes.distros.length > 0) {
          const first = distrosRes.distros[0];
          setSelectedDistroKey(distroKey(first));
          setDistribution(first.distribution);
          setRelease(first.release);
        }
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
  }, []);

  const handleDistroChange = (key: string) => {
    setSelectedDistroKey(key);
    if (key === CUSTOM_VALUE) return;
    const found = distros.find((d) => distroKey(d) === key);
    if (found) {
      setDistribution(found.distribution);
      setRelease(found.release);
    }
  };

  const handleNetworkTypeChange = (type: 'bridge' | 'macvlan') => {
    setNetworkType(type);
    const list = type === 'macvlan' ? interfaces : bridges;
    setBridge(list.length > 0 ? list[0] : '');
  };

  const valid = name.trim() && distribution.trim() && release.trim() && arch.trim() && bridge.trim();

  const handleSubmit = async () => {
    setCreateError(null);
    setProgress(null);
    setLog([]);
    setStage('creating');
    try {
      const result = await lxcApi.createContainer(
        {
          name: name.trim(),
          distribution: distribution.trim(),
          release: release.trim(),
          arch: arch.trim(),
          networkType,
          bridge,
          autostart,
          description,
          webUiUrl,
        },
        (p) => {
          setProgress(p);
          setLog((prev) => [...prev.slice(-49), p.message]);
        },
      );
      setDoneMessage(result.message);
      setStage('done');
      onDone();
    } catch (err) {
      setCreateError((err as Error).message);
      setStage('editing');
    }
  };

  const locked = stage === 'creating' || stage === 'done';

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog lxc-create-dialog">
        <div className="dialog__head">
          <div className="dialog__title">Add LXC Container</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        {stage === 'loading-options' && <div className="status-note">Loading distributions and bridges…</div>}
        {stage === 'load-error' && <div className="status-note status-note--error">{loadError}</div>}

        {stage !== 'loading-options' && stage !== 'load-error' && (
          <div className="dialog__body">
            <label className="form-field">
              <span className="form-field__label">Container name</span>
              <input
                className="history-input"
                style={{ width: '100%' }}
                disabled={locked}
                placeholder="e.g. debian-build"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <label className="form-field">
              <span className="form-field__label">Distribution</span>
              <select
                className="history-input"
                style={{ width: '100%' }}
                disabled={locked}
                value={selectedDistroKey}
                onChange={(e) => handleDistroChange(e.target.value)}
              >
                {distros.map((d) => (
                  <option key={distroKey(d)} value={distroKey(d)}>
                    {d.label}
                  </option>
                ))}
                <option value={CUSTOM_VALUE}>Custom…</option>
              </select>
            </label>

            {selectedDistroKey === CUSTOM_VALUE && (
              <div className="container-form-row">
                <input
                  className="history-input"
                  placeholder="Distribution (e.g. debian)"
                  disabled={locked}
                  value={distribution}
                  onChange={(e) => setDistribution(e.target.value)}
                />
                <input
                  className="history-input"
                  placeholder="Release (e.g. bookworm)"
                  disabled={locked}
                  value={release}
                  onChange={(e) => setRelease(e.target.value)}
                />
              </div>
            )}

            <label className="form-field">
              <span className="form-field__label">Architecture</span>
              <input
                className="history-input"
                style={{ width: '100%' }}
                disabled={locked}
                placeholder={defaultArch}
                value={arch}
                onChange={(e) => setArch(e.target.value)}
              />
            </label>

            <label className="form-field">
              <span className="form-field__label">Network</span>
              <select
                className="history-input"
                style={{ width: '100%' }}
                disabled={locked}
                value={networkType}
                onChange={(e) => handleNetworkTypeChange(e.target.value as 'bridge' | 'macvlan')}
              >
                <option value="bridge">Bridge - IP on the bridge's own subnet</option>
                <option value="macvlan">Direct on a network interface - real IP from your LAN's DHCP</option>
              </select>
            </label>

            <label className="form-field">
              <span className="form-field__label">{networkType === 'macvlan' ? 'Interface' : 'Bridge'}</span>
              {(networkType === 'macvlan' ? interfaces : bridges).length > 0 ? (
                <select className="history-input" style={{ width: '100%' }} disabled={locked} value={bridge} onChange={(e) => setBridge(e.target.value)}>
                  {(networkType === 'macvlan' ? interfaces : bridges).map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="history-input"
                  style={{ width: '100%' }}
                  disabled={locked}
                  placeholder={networkType === 'macvlan' ? 'e.g. eno0' : 'e.g. br0'}
                  value={bridge}
                  onChange={(e) => setBridge(e.target.value)}
                />
              )}
              <span className="apps-field__hint">
                {networkType === 'macvlan'
                  ? "The container's interface rides directly on this NIC and gets its own LAN IP via DHCP. The host itself can't reach the container over this interface - that's a macvlan limitation, not a bug."
                  : "Host bridge the container's veth attaches to"}
              </span>
            </label>

            <label className="form-field">
              <span className="form-field__label">Description</span>
              <input
                className="history-input"
                style={{ width: '100%' }}
                disabled={locked}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>

            <label className="form-field">
              <span className="form-field__label">Web UI link</span>
              <input
                className="history-input"
                style={{ width: '100%' }}
                disabled={locked}
                placeholder="optional, e.g. http://[IP]:8080"
                value={webUiUrl}
                onChange={(e) => setWebUiUrl(e.target.value)}
              />
            </label>

            <label className="apps-privileged-banner__ack">
              <input type="checkbox" disabled={locked} checked={autostart} onChange={(e) => setAutostart(e.target.checked)} />
              Start automatically on boot
            </label>

            {stage === 'creating' && (
              <div className="apps-install-progress">
                <div className="apps-install-progress__status">{progress?.message ?? 'Starting…'}</div>
                <div className="apps-install-progress__bar">
                  <div className="apps-install-progress__bar-fill apps-install-progress__bar-fill--indeterminate" />
                </div>
                {log.length > 0 && (
                  <div className="apps-install-progress__log">
                    {log.map((line, i) => (
                      <div className="apps-install-progress__log-line" key={i}>
                        <span className="apps-install-progress__log-status">{line}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {createError && <div className="status-note status-note--error">{createError}</div>}
            {stage === 'done' && doneMessage && <div className="status-note">{doneMessage}</div>}

            <div className="dialog__actions">
              <button type="button" className="btn" onClick={onClose}>
                {stage === 'done' ? 'Close' : 'Cancel'}
              </button>
              {!locked && (
                <button type="button" className="btn--primary" disabled={!valid} onClick={handleSubmit}>
                  Create
                </button>
              )}
              {stage === 'creating' && (
                <button type="button" className="btn--primary" disabled>
                  Creating…
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

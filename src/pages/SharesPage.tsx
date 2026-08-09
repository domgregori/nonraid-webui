import { useState } from 'react';
import { COLORS } from '../styles/colors';
import { deriveShareViewModel } from '../selectors/shares';
import { ProgressBar } from '../components/shared/ProgressBar';
import { ShareFormModal } from '../components/shares/ShareFormModal';
import { useShares } from '../hooks/useShares';
import type { Share } from '../types/sharesApi';

export function SharesPage() {
  const { shares, status, error, actionError, pendingNames, create, update, remove } = useShares();
  const [editingShare, setEditingShare] = useState<Share | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const views = shares.map(deriveShareViewModel);
  const existingNames = shares.map((s) => s.name);

  const handleDeleteClick = (name: string) => {
    if (confirmingDelete === name) {
      remove(name);
      setConfirmingDelete(null);
    } else {
      setConfirmingDelete(name);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">Shares</div>
        <button type="button" className="btn--primary" onClick={() => setCreating(true)}>
          Add Share
        </button>
      </div>

      {status === 'loading' && <div className="status-note">Loading shares…</div>}
      {error && <div className="status-note status-note--error">{error}</div>}
      {actionError && <div className="status-note status-note--error">{actionError}</div>}

      <div className="list">
        {views.map((share) => (
          <div className="list-card" key={share.name}>
            <div className="list-card__col--name">
              <div className="list-card__title">{share.name}</div>
              <div className="list-card__subtitle">{share.protocolLabel}</div>
              {share.description && <div className="list-card__subtitle">{share.description}</div>}
            </div>
            <div className="list-card__col">
              <div>Allocation: {share.allocationLabel}</div>
              <div style={{ marginTop: 2 }}>{share.disksLabel}</div>
            </div>
            <div className="list-card__progress">
              <ProgressBar pct={share.pct} color={COLORS.blue} />
              <div className="list-card__progress-label">
                {share.usedLabel} / {share.totalLabel}
              </div>
            </div>
            <div className="list-card__actions">
              <button
                type="button"
                className="btn"
                disabled={pendingNames.has(share.name)}
                onClick={() => setEditingShare(shares.find((s) => s.name === share.name) ?? null)}
              >
                Edit
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={pendingNames.has(share.name)}
                onClick={() => handleDeleteClick(share.name)}
              >
                {confirmingDelete === share.name ? 'Confirm?' : 'Delete'}
              </button>
            </div>
          </div>
        ))}
        {status === 'ready' && views.length === 0 && <div className="status-note">No shares yet.</div>}
      </div>

      {creating && (
        <ShareFormModal
          initial={null}
          existingNames={existingNames}
          onCancel={() => setCreating(false)}
          onSubmit={async (input) => {
            const ok = await create(input);
            if (ok) setCreating(false);
            return ok;
          }}
        />
      )}

      {editingShare && (
        <ShareFormModal
          initial={editingShare}
          existingNames={existingNames}
          onCancel={() => setEditingShare(null)}
          onSubmit={async (input) => {
            const ok = await update(editingShare.name, input);
            if (ok) setEditingShare(null);
            return ok;
          }}
        />
      )}
    </div>
  );
}

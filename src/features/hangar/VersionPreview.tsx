// An earlier version of the aircraft, shown in place of the form (read-only, its differing fields
// highlighted by the page): what it was, what differs from the current aircraft, and Restore.
import { useState } from 'react';

import { entryTitle, versionChangeText } from '../../shared/aircraftHistory';
import { fmtLocalDayTime } from '../../shared/format';
import type { AircraftRevisionDetail } from '../../shared/sharing';
import { Chip, ConfirmDialog } from '../../ui';
import { Section } from './fields';
import { splitChanges } from './versions';

export function VersionPreview({
  detail,
  myId,
  canRestore,
  onRestore,
  onClose,
}: {
  detail: AircraftRevisionDetail;
  myId: string;
  /** Editors and the owner. */
  canRestore: boolean;
  onRestore: () => Promise<void>;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const { revision, changes } = detail;
  const when = fmtLocalDayTime(revision.at);
  const { fields, files } = splitChanges(changes);
  return (
    <div className="ac-version card" role="region" aria-label="Earlier version" data-testid="version-preview">
      <div className="ac-version-head">
        <Chip tone="warn">Version of {when}</Chip>
        <span className="ac-version-what">{entryTitle(revision, myId)}</span>
        <span className="spacer" />
        <button type="button" className="ghost sm" onClick={onClose} data-testid="version-close">
          Back to the current version
        </button>
        {canRestore && changes.length > 0 && (
          <button
            type="button"
            className="sm primary"
            onClick={() => setConfirming(true)}
            data-testid="version-restore"
          >
            Restore this version
          </button>
        )}
      </div>
      {changes.length === 0 ? (
        <p className="muted ac-version-same">Same as the current version</p>
      ) : (
        <>
          <span className="muted ac-version-sub">
            {changes.length === 1 ? '1 difference' : `${changes.length} differences`} from the current version
          </span>
          <ul className="ac-version-changes" data-testid="version-changes">
            {[...fields, ...files].map((c) => (
              <li key={c.path}>{versionChangeText(c)}</li>
            ))}
          </ul>
        </>
      )}
      {confirming && (
        <ConfirmDialog
          title={`Restore the version of ${when}?`}
          confirmLabel="Restore"
          danger={false}
          onConfirm={onRestore}
          onClose={() => setConfirming(false)}
          testId="version-confirm"
        >
          The current version stays in the version history.
        </ConfirmDialog>
      )}
    </div>
  );
}

/** The documents of the version, in place of the Documents section while it is shown. */
export function VersionDocuments({ detail }: { detail: AircraftRevisionDetail }) {
  const gone = new Set(
    detail.changes
      .filter((c) => c.summary?.endsWith('no longer stored'))
      .map((c) => c.path.replace(/^documents\./, '')),
  );
  const docs = detail.snapshot.documents;
  return (
    <Section id="documents" title="Documents">
      {docs.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No documents.
        </p>
      ) : (
        <ul className="ac-version-docs" data-testid="version-documents">
          {docs.map((d) => (
            <li key={d.id}>
              {d.title || d.name}
              {gone.has(d.id) && <span className="muted"> (no longer stored)</span>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

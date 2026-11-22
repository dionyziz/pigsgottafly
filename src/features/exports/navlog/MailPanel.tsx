// "E-mail me": the navlog as shown, printed by the server to PDF (src/shared/navlogSheets.ts) and
// e-mailed to the signed-in pilot's own address.
import '../form731/forms.css';

import { useState } from 'react';

import { api, ApiRequestError } from '../../../data/api';
import { useAsync } from '../../../data/useAsync';
import type { NavlogContent } from '../../../shared';
import { fmtLocalDayTime } from '../../../shared/format';
import { Panel } from '../../../ui';

const errText = (e: unknown) =>
  e instanceof ApiRequestError ? (e.offline ? 'Offline: try again when connected.' : e.message) : 'The request failed.';

/** `content`: null while the sheets are loading. */
export function NavlogMailPanel({ flightId, content }: { flightId: string; content: NavlogContent | null }) {
  const q = useAsync(() => api.navlogMail.get(flightId), [flightId], {
    refetchOnFocus: true,
    cache: `navlog-mail:${flightId}`,
  });
  const st = q.data;
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!content) return;
    setBusy(true);
    setErr(null);
    try {
      q.setData(await api.navlogMail.send(flightId, content));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const reason = st && !st.emailEnabled ? st.emailReason : null;
  const loadErr = q.error && !st ? errText(q.error) : null;
  return (
    <Panel
      title="E-mail"
      testId="navlog-mail"
      actions={
        <button
          className="primary"
          data-testid="navlog-mail-button"
          onClick={() => void send()}
          disabled={busy || !content || !st?.emailEnabled}
          title={reason ?? undefined}
        >
          {busy ? 'Sending…' : 'E-mail me'}
        </button>
      }
    >
      {st?.sent && (
        <div className="pgf-note" data-testid="navlog-mail-sent">
          Sent to {st.sent.to} at {fmtLocalDayTime(st.sent.sentAt)}
        </div>
      )}
      {reason && (
        <div className="pgf-note" data-testid="navlog-mail-reason">
          {reason}
        </div>
      )}
      {(err || loadErr) && (
        <div className="form-error" role="alert" data-testid="navlog-mail-error">
          {err || loadErr}
        </div>
      )}
    </Panel>
  );
}

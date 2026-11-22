// The pilot's own autorouter account (api/_lib/routes/autorouter.ts): flight plans are filed, and
// autorouter's NOTAMs read, with it. Shown only when the server can link accounts.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

import { api, autorouterConnectUrl } from '../../data/api';
import type { AutorouterLinkStatus } from '../../shared';
import { errorMessage } from '../../shared/format';
import { CardSection } from '../../ui';

export function AutorouterSection() {
  const [st, setSt] = useState<AutorouterLinkStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [params] = useSearchParams();
  const failed = params.get('autorouter') === 'failed';

  useEffect(() => {
    let live = true;
    api.autorouter.status().then(
      (s) => {
        if (live) setSt(s);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);

  if (!st?.enabled) return null;
  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      setSt(await api.autorouter.disconnect());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card account-card" data-testid="autorouter-section">
      <CardSection id="autorouter" title="autorouter" plain>
        <div className="row">
          <span data-testid="autorouter-state">
            {st.connected
              ? `Connected${st.account ? ` · ${st.account}` : ''}`
              : st.broken
                ? 'Connection refused by autorouter'
                : 'Not connected'}
          </span>
          <span className="spacer" />
          {!st.connected && (
            <a className="btn primary sm" href={autorouterConnectUrl('/profile')} data-testid="autorouter-connect">
              {st.broken ? 'Reconnect' : 'Connect'}
            </a>
          )}
          {(st.connected || st.broken) && (
            <button
              type="button"
              className="ghost sm"
              onClick={() => void disconnect()}
              disabled={busy}
              data-testid="autorouter-disconnect"
            >
              Disconnect
            </button>
          )}
        </div>
        {(error || (failed && !st.connected)) && (
          <span className="issue error" role="alert">
            {error ?? 'autorouter did not connect. Try again.'}
          </span>
        )}
      </CardSection>
    </div>
  );
}

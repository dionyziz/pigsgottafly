// /sign/:token: a passenger signs Form 731 (PLAN-v3 "Form 731: signatures and submission to HCAA").
// No account needed: the link is the key, and it opens this one form only. A read-only view of the
// filled form, built for a phone: the passenger's own row in full, other people's ID and contact
// masked, and a single "Sign" button. The signature is the signer's initial and last name in the
// handwriting font, with the time.
import { Loading } from '../../app/Loading';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiRequestError } from '../../data/api';
import type { SigningView } from '../../shared/forms';
import { Signature } from '../exports/form731/Form731';
import '../exports/form731/forms.css';
import './sign.css';

export function SignPage() {
  const { token = '' } = useParams();
  const [view, setView] = useState<SigningView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    document.title = 'Sign Form 731';
    api.sign.view(token).then(setView, (e) => setErr(e instanceof ApiRequestError ? (e.offline ? 'You are offline. Open the link again when connected.' : e.message) : 'This link could not be opened.'));
  }, [token]);

  const sign = async () => {
    setBusy(true);
    try { setView(await api.sign.sign(token)); } catch (e) { setErr(e instanceof ApiRequestError ? e.message : 'Signing failed. Try again.'); } finally { setBusy(false); }
  };

  if (err && !view) return <main className="sign-page"><div className="sign-card"><h1>Form 731</h1><p className="sign-err" role="alert">{err}</p></div></main>;
  if (!view) return <main className="sign-page"><div className="sign-card"><p><Loading /></p></div></main>;
  const c = view.content;
  const me = c.people.find((p) => p.key === view.me);
  const mySig = view.signatures.find((s) => s.key === view.me);
  return (
    <main className="sign-page" data-testid="sign-page">
      <div className="sign-card">
        <div className="sign-kicker">Form 731 · Hellenic Civil Aviation Authority</div>
        <h1>Official statement of persons boarding private aircraft</h1>
        <dl className="sign-facts">
          <div><dt>Aircraft</dt><dd>{c.registration || '–'}</dd></div>
          <div><dt>Date</dt><dd>{c.date || '–'}</dd></div>
          <div><dt>Route</dt><dd>{c.route || '–'}</dd></div>
          <div><dt>Airport</dt><dd>{c.airport || '–'}</dd></div>
        </dl>
        <p className="sign-decl">
          We, the undersigned, on our own responsibility and being fully aware of the sanctions stipulated by Law 1599/1986, declare solemnly that we are
          fully aware that the flight on which we are boarding, operated by aircraft with registration <b>{c.registration || '–'}</b> and operating the
          route <b>{c.route || '–'}</b>, is not a commercial flight and no fare (fee) has been paid for the aforementioned transport.
        </p>
        <ol className="sign-people">
          {c.people.map((p) => {
            const s = view.signatures.find((x) => x.key === p.key);
            return (
              <li key={p.key} className={p.key === view.me ? 'me' : ''}>
                <div className="sign-name">{p.name || '(no name)'}{p.role === 'PIC' ? <span className="sign-role">Pilot in command</span> : p.key === view.me ? <span className="sign-role">You</span> : null}</div>
                <div className="sign-details">
                  {p.idPassport && <span>{p.idPassport}</span>}
                  {p.contact && <span>{p.contact}</span>}
                </div>
                <div className="sign-sig">{s?.signedAt ? <Signature s={{ name: p.name, signedAt: s.signedAt }} size={6} /> : <span className="muted">not signed yet</span>}</div>
              </li>
            );
          })}
        </ol>
        {err && <p className="sign-err" role="alert">{err}</p>}
        {mySig?.signedAt
          ? <p className="sign-done" data-testid="sign-done">Signed. Thank you{me?.name ? `, ${me.name.split(/\s+/)[0]}` : ''}: you can close this page.</p>
          : <button className="primary sign-button" onClick={sign} disabled={busy} data-testid="sign-button">{busy ? 'Signing…' : `Sign as ${me?.name || 'passenger'}`}</button>}
        <p className="sign-fine">If your details are wrong, tell the pilot in command before signing: any change to the form clears the signatures.</p>
      </div>
    </main>
  );
}

// /sign/:token: a passenger signs Form 731 (PLAN-v3 "Form 731: signatures and submission to HCAA").
// No account needed: the link is the key, and it opens this one form only, so other people's ID and
// contact are masked. The passenger may correct their own row first (the pilot is told when they sign).
import '../exports/form731/forms.css';
import './sign.css';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';

import { api, ApiRequestError } from '../../data/api';
import { EMPTY_PERSON } from '../../shared';
import { type SignerDetails, signerDetailsOf, type SigningView } from '../../shared/forms';
import { Field, Loading } from '../../ui';
import { Signature } from '../exports/form731/Form731';
import { useFormIssues } from '../passengers/formIssues';
import { type PersonField, personForm, personInput, validatePerson } from '../passengers/person';

type Editable = 'fullName' | 'idNumber' | 'phone';
const EDITABLE: readonly PersonField[] = ['fullName', 'idNumber', 'phone'];

/** The signer's own row of the form, editable; validated and normalized as the passenger form does. */
function DetailsEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: SignerDetails;
  onSave: (d: SignerDetails) => Promise<void>;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [f, setF] = useState(() => personForm({ ...EMPTY_PERSON, ...initial }));
  const [busy, setBusy] = useState(false);
  const issues = useFormIssues<PersonField>(ref);
  const set = (k: Editable, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    issues.clear(k);
  };
  const submit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (!issues.check(validatePerson(f).filter((i) => EDITABLE.includes(i.field)))) return;
    const p = personInput(f);
    setBusy(true);
    try {
      await onSave({ fullName: p.fullName, idNumber: p.idNumber, phone: p.phone });
    } finally {
      setBusy(false);
    }
  };
  const input = (k: Editable) => ({
    name: k,
    value: f[k],
    onChange: (e: { target: { value: string } }) => set(k, e.target.value),
  });
  return (
    <form ref={ref} className="sign-edit" onSubmit={submit} noValidate data-testid="sign-edit-form">
      <Field label="Full name" req issues={issues.of('fullName')}>
        <input {...input('fullName')} required autoComplete="name" autoFocus />
      </Field>
      <Field label="ID / passport number" issues={issues.of('idNumber')}>
        <input {...input('idNumber')} autoComplete="off" />
      </Field>
      <Field label="Phone" issues={issues.of('phone')}>
        <input {...input('phone')} type="tel" autoComplete="tel" />
      </Field>
      <div className="sign-edit-actions">
        <button type="button" className="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={busy} data-testid="sign-edit-save">
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

export function SignPage() {
  const { token = '' } = useParams();
  const [view, setView] = useState<SigningView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    document.title = 'Sign Form 731';
    api.sign
      .view(token)
      .then(setView, (e) =>
        setErr(
          e instanceof ApiRequestError
            ? e.offline
              ? 'You are offline. Open the link again when connected.'
              : e.message
            : 'This link could not be opened.',
        ),
      );
  }, [token]);

  const sign = async () => {
    setBusy(true);
    try {
      setView(await api.sign.sign(token));
    } catch (e) {
      setErr(e instanceof ApiRequestError ? e.message : 'Signing failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const saveDetails = async (d: SignerDetails) => {
    setErr(null);
    try {
      setView(await api.sign.details(token, d));
      setEditing(false);
    } catch (e) {
      setErr(e instanceof ApiRequestError ? e.message : 'Your details could not be saved. Try again.');
    }
  };

  if (err && !view)
    return (
      <main className="sign-page">
        <div className="sign-card">
          <h1>Form 731</h1>
          <p className="sign-err" role="alert">
            {err}
          </p>
        </div>
      </main>
    );
  if (!view)
    return (
      <main className="sign-page">
        <div className="sign-card">
          <Loading />
        </div>
      </main>
    );
  const c = view.content;
  const me = c.people.find((p) => p.key === view.me);
  const mySig = view.signatures.find((s) => s.key === view.me);
  return (
    <main className="sign-page" data-testid="sign-page">
      <div className="sign-card">
        <div className="sign-kicker">Form 731 · Hellenic Civil Aviation Authority</div>
        <h1>Official statement of persons boarding private aircraft</h1>
        <dl className="sign-facts">
          <div>
            <dt>Aircraft</dt>
            <dd>{c.registration || '–'}</dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>{c.date || '–'}</dd>
          </div>
          <div>
            <dt>Route</dt>
            <dd>{c.route || '–'}</dd>
          </div>
          <div>
            <dt>Airport</dt>
            <dd>{c.airport || '–'}</dd>
          </div>
        </dl>
        <p className="sign-decl">
          We, the undersigned, on our own responsibility and being fully aware of the sanctions stipulated by Law
          1599/1986, declare solemnly that we are fully aware that the flight on which we are boarding, operated by
          aircraft with registration <b>{c.registration || '–'}</b> and operating the route <b>{c.route || '–'}</b>, is
          not a commercial flight and no fare (fee) has been paid for the aforementioned transport.
        </p>
        <ol className="sign-people">
          {c.people.map((p) => {
            const s = view.signatures.find((x) => x.key === p.key);
            return (
              <li key={p.key} className={p.key === view.me ? 'me' : ''}>
                <div className="sign-name">
                  {p.name || '(no name)'}
                  {p.role === 'PIC' ? (
                    <span className="sign-role">Pilot in command</span>
                  ) : p.key === view.me ? (
                    <span className="sign-role">You</span>
                  ) : null}
                </div>
                {p.key === view.me && editing ? (
                  <DetailsEditor initial={signerDetailsOf(p)} onSave={saveDetails} onCancel={() => setEditing(false)} />
                ) : (
                  <div className="sign-details">
                    {p.idPassport && <span>{p.idPassport}</span>}
                    {p.contact && <span>{p.contact}</span>}
                    {p.key === view.me && (
                      <button
                        type="button"
                        className="ghost sign-edit-button"
                        onClick={() => setEditing(true)}
                        data-testid="sign-edit"
                      >
                        Edit my details
                      </button>
                    )}
                  </div>
                )}
                <div className="sign-sig">
                  {s?.signedAt ? (
                    <Signature s={{ name: p.name, signedAt: s.signedAt }} size={6} />
                  ) : (
                    <span className="muted">not signed yet</span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        {err && (
          <p className="sign-err" role="alert">
            {err}
          </p>
        )}
        {mySig?.signedAt ? (
          <p className="sign-done" data-testid="sign-done">
            Signed. Thank you{me?.name ? `, ${me.name.split(/\s+/)[0]}` : ''}: you can close this page.
          </p>
        ) : (
          <button className="primary sign-button" onClick={sign} disabled={busy || editing} data-testid="sign-button">
            {busy ? 'Signing…' : `Sign as ${me?.name || 'passenger'}`}
          </button>
        )}
      </div>
    </main>
  );
}

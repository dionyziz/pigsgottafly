// Profile: the pilot's details for the forms (name, phone, licence, nationality, ID, aeroclub member
// code for Form 731, weight for W&B), home aerodrome, default aircraft and planning defaults (taxi
// out/in, fuel reserve, final reserve, wind model). With ?welcome=1 it is the first-use onboarding:
// only name, phone, home aerodrome, taxi and reserve are asked. Nothing pilot-specific is prefilled
// (pilot correction #1): unset values show neutral placeholders and are never saved silently.
import { DateInput } from '../../app/DateInput';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Shell } from '../../app/Shell';
import { useSession } from '../../app/session';
import { useToast } from '../../app/toast';
import { api } from '../../data/api';
import { useAsync } from '../../data/useAsync';
import { profileMissing, SETTING_SUGGESTIONS, WIND_MODELS, type Pilot, type PilotUpdate, type WindModel } from '../../shared';
import { AerodromePicker, resolveAerodrome } from './AerodromePicker';
import '../lobby/lists.css';

interface Form {
  fullName: string; phone: string; licenceNo: string; nationality: string; relation: string;
  dateOfBirth: string; weightKg: string; idType: '' | 'ID' | 'PASSPORT'; idNumber: string;
  homeAerodrome: string; defaultAircraftId: string; defaultAlternate: string;
  taxiOutMin: string; taxiInMin: string; reserveMin: string; finalReserveMin: string;
  windModel: WindModel; enrouteAerodromeRadiusNm: string;
}

const s = (v: number | null | undefined) => (v == null ? '' : String(v));

function formOf(p: Pilot): Form {
  return {
    fullName: p.fullName, phone: p.phone, licenceNo: p.licenceNo, nationality: p.nationality, relation: p.relation,
    dateOfBirth: p.dateOfBirth ?? '', weightKg: s(p.weightKg), idType: p.idType, idNumber: p.idNumber,
    homeAerodrome: p.homeAerodrome ?? '', defaultAircraftId: p.defaultAircraftId ?? '', defaultAlternate: p.settings.defaultAlternate ?? '',
    taxiOutMin: s(p.settings.taxiOutMin), taxiInMin: s(p.settings.taxiInMin), reserveMin: s(p.settings.reserveMin),
    finalReserveMin: s(p.settings.finalReserveMin), windModel: p.settings.windModel,
    enrouteAerodromeRadiusNm: s(p.settings.enrouteAerodromeRadiusNm),
  };
}

/** Parses an optional non-negative number field; throws a readable message. */
function num(v: string, label: string, max: number): number | null {
  const t = v.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  if (!isFinite(n) || n < 0 || n > max) throw new Error(`${label} must be a number between 0 and ${max}`);
  return n;
}

export function toUpdate(f: Form, welcome: boolean): PilotUpdate {
  const home = resolveAerodrome(f.homeAerodrome);
  if (!f.fullName.trim()) throw new Error('Please enter your full name');
  if (!f.phone.trim()) throw new Error('Please enter your phone number');
  if (!home) throw new Error(f.homeAerodrome.trim() ? `“${f.homeAerodrome.trim()}” is not an aerodrome in the current AIP` : 'Please choose your home aerodrome');
  const base: PilotUpdate = {
    fullName: f.fullName.trim(), phone: f.phone.trim(), homeAerodrome: home.icao || home.id,
    settings: {
      taxiOutMin: num(f.taxiOutMin, 'Taxi out', 600), taxiInMin: num(f.taxiInMin, 'Taxi in', 600), reserveMin: num(f.reserveMin, 'Fuel reserve', 600),
    },
  };
  if (welcome) return base;
  const altn = resolveAerodrome(f.defaultAlternate);
  if (f.defaultAlternate.trim() && !altn) throw new Error(`“${f.defaultAlternate.trim()}” is not an aerodrome in the current AIP`);
  return {
    ...base,
    licenceNo: f.licenceNo.trim(), nationality: f.nationality.trim().toUpperCase(), relation: f.relation.trim(),
    dateOfBirth: f.dateOfBirth || null, weightKg: num(f.weightKg, 'Weight', 300), idType: f.idType, idNumber: f.idNumber.trim(),
    defaultAircraftId: f.defaultAircraftId || null,
    settings: {
      ...base.settings,
      finalReserveMin: num(f.finalReserveMin, 'Final reserve', 600) ?? 0,
      windModel: f.windModel,
      enrouteAerodromeRadiusNm: num(f.enrouteAerodromeRadiusNm, 'En-route aerodrome radius', 50) ?? 2,
      defaultAlternate: altn ? altn.icao || altn.id : null,
    },
  };
}

function Unit({ unit, children }: { unit: string; children: React.ReactNode }) {
  return <div className="unit-input">{children}<span>{unit}</span></div>;
}

export function ProfilePage() {
  const { pilot, setPilot } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const welcome = params.get('welcome') === '1' || profileMissing(pilot).length > 0;
  const initial = useMemo(() => formOf(pilot), [pilot]);
  const [f, setF] = useState<Form>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: hangar } = useAsync(() => api.aircraft.list(), []);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = <K extends keyof Form>(k: K) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value as Form[K] }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    let patch: PilotUpdate;
    try { patch = toUpdate(f, welcome); } catch (err) { setError((err as Error).message); return; }
    setBusy(true);
    try {
      const p = await api.me.update(patch);
      setPilot(p);
      setF(formOf(p));
      setError(null);
      if (welcome && !profileMissing(p).length) {
        navigate('/', { replace: true });
        if (hangar && hangar.length === 0) toast('Welcome aboard. Add your aircraft to the hangar next.', { label: 'Open hangar', onClick: () => navigate('/hangar') });
        else toast('Welcome aboard.');
      } else {
        toast('Profile saved');
      }
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setBusy(false);
    }
  };

  const notSet = (v: string) => (v.trim() ? null : <span className="notset">Not set</span>);

  return (
    <Shell>
      {welcome ? (
        <div className="welcome card">
          <img src="/icon.svg" alt="" />
          <div>
            <h1 style={{ fontSize: 'var(--fs-xl)' }}>Welcome to Pig's Gotta Fly</h1>
            <p>Before your first flight, tell us who you are, where you fly from and how you plan. You can change all of this later in your profile.</p>
          </div>
        </div>
      ) : (
        <div className="page-head"><h1>Profile</h1></div>
      )}
      <form className="card" style={{ maxWidth: 760 }} onSubmit={save} data-testid="profile-form" noValidate>
        <section className="form-section">
          <header><h2>About you</h2><p>As printed on the navigation log, Form 731, the General Declaration and the flight plan (item 19).</p></header>
          <div className="grid2">
            <label className="field"><span>Full name<span className="req" aria-hidden>*</span></span>
              <input name="fullName" value={f.fullName} onChange={set('fullName')} required autoComplete="name" placeholder="As on your licence" autoFocus={welcome && !f.fullName} />
            </label>
            <label className="field"><span>Phone<span className="req" aria-hidden>*</span></span>
              <input name="phone" type="tel" value={f.phone} onChange={set('phone')} required autoComplete="tel" placeholder="+30 …" />
            </label>
          </div>
          {!welcome && (<>
            <div className="grid2">
              <label className="field">Licence number<input name="licenceNo" value={f.licenceNo} onChange={set('licenceNo')} placeholder="e.g. GR.FCL.PPL.12345" /></label>
              <label className="field">Nationality<input name="nationality" value={f.nationality} onChange={set('nationality')} placeholder="e.g. GREEK" /></label>
            </div>
            <div className="grid3">
              <label className="field">Date of birth<DateInput name="dateOfBirth" value={f.dateOfBirth} onChange={set('dateOfBirth')} /></label>
              <label className="field">Body weight<Unit unit="kg"><input name="weightKg" inputMode="decimal" value={f.weightKg} onChange={set('weightKg')} placeholder="for W&B" /></Unit></label>
              <label className="field">ID / passport number<input name="idNumber" value={f.idNumber} onChange={set('idNumber')} placeholder="e.g. AK 123456" /></label>
            </div>
          </>)}
        </section>

        <section className="form-section">
          <header><h2>Home aerodrome</h2><p>New flights start here and return here{welcome ? '' : ', with the default alternate filled in'}.</p></header>
          <div className="grid2">
            <label className="field"><span>Aerodrome<span className="req" aria-hidden>*</span></span>
              <AerodromePicker name="homeAerodrome" value={f.homeAerodrome} onChange={(v) => setF((x) => ({ ...x, homeAerodrome: v }))} required />
            </label>
            {!welcome && (
              <label className="field">Default aircraft
                {hangar && hangar.length === 0 ? (
                  <div className="muted" style={{ padding: '7px 0' }}>Your hangar is empty. <Link to="/hangar">Add an aircraft</Link></div>
                ) : (
                  <select name="defaultAircraftId" value={f.defaultAircraftId} onChange={set('defaultAircraftId')}>
                    <option value="">None</option>
                    {(hangar || []).map((a) => <option key={a.id} value={a.id}>{a.registration}{a.makeModel ? ` · ${a.makeModel}` : ''}</option>)}
                  </select>
                )}
              </label>
            )}
            {!welcome && (
              <label className="field" data-testid="profile-default-alternate">Default alternate aerodrome
                <AerodromePicker name="defaultAlternate" value={f.defaultAlternate} onChange={(v) => setF((x) => ({ ...x, defaultAlternate: v }))} placeholder="Optional, e.g. LGAV" />
                <span className="hint">Pre-filled as the alternate (FPL item 16) of new flights; change it per flight under Flight plan</span>
              </label>
            )}
          </div>
        </section>

        <section className="form-section">
          <header><h2>Planning defaults</h2><p>Copied into each new flight, where you can still change them. Leave a field empty and flights will ask for it.</p></header>
          <div className="grid3">
            <label className="field"><span>Taxi out {notSet(f.taxiOutMin)}</span>
              <Unit unit="min"><input name="taxiOutMin" inputMode="numeric" value={f.taxiOutMin} placeholder={`e.g. ${SETTING_SUGGESTIONS.taxiOutMin}`} onChange={set('taxiOutMin')} /></Unit>
              <span className="hint">Block off to take-off</span>
            </label>
            <label className="field"><span>Taxi in {notSet(f.taxiInMin)}</span>
              <Unit unit="min"><input name="taxiInMin" inputMode="numeric" value={f.taxiInMin} placeholder={`e.g. ${SETTING_SUGGESTIONS.taxiInMin}`} onChange={set('taxiInMin')} /></Unit>
              <span className="hint">Landing to block on</span>
            </label>
            <label className="field"><span>Fuel reserve {notSet(f.reserveMin)}</span>
              <Unit unit="min"><input name="reserveMin" inputMode="numeric" value={f.reserveMin} placeholder={`e.g. ${SETTING_SUGGESTIONS.reserveMin}`} onChange={set('reserveMin')} /></Unit>
              <span className="hint">Fuel on board defaults to required fuel plus this</span>
            </label>
          </div>
          {!welcome && (
            <div className="grid3">
              <label className="field">Final reserve in required fuel
                <Unit unit="min"><input name="finalReserveMin" inputMode="numeric" value={f.finalReserveMin} onChange={set('finalReserveMin')} placeholder="0" /></Unit>
                <span className="hint">0 = required is allowance + trip, as on the paper navlog</span>
              </label>
              <label className="field">Winds aloft model
                <select name="windModel" value={f.windModel} onChange={set('windModel')}>
                  {(Object.keys(WIND_MODELS) as WindModel[]).map((k) => <option key={k} value={k}>{WIND_MODELS[k]}</option>)}
                </select>
              </label>
              <label className="field">ATC list: aerodromes within
                <Unit unit="NM"><input name="enrouteAerodromeRadiusNm" inputMode="decimal" value={f.enrouteAerodromeRadiusNm} onChange={set('enrouteAerodromeRadiusNm')} placeholder="2" /></Unit>
                <span className="hint">of the route are listed</span>
              </label>
            </div>
          )}
        </section>

        <div className="form-actions">
          {error && <p className="form-error" role="alert">{error}</p>}
          <span className="spacer" />
          {!welcome && dirty && <button type="button" className="ghost" onClick={() => { setF(initial); setError(null); }} disabled={busy}>Discard changes</button>}
          <button className="primary" type="submit" disabled={busy || (!welcome && !dirty)}>{welcome ? 'Continue' : busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Shell>
  );
}

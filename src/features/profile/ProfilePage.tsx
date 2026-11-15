// Profile: name, phone, licence, nationality, home aerodrome, default aircraft, taxi times, reserve,
// wind model. With ?welcome=1 it is the first-use onboarding. PLACEHOLDER quality — the screens
// agent owns and finishes this page (all PilotUpdate fields, validation, aerodrome picker).
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Shell } from '../../app/Shell';
import { useSession } from '../../app/session';
import { api } from '../../data/api';
import { profileMissing, SETTING_SUGGESTIONS } from '../../shared';

export function ProfilePage() {
  const { pilot, setPilot } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const welcome = params.get('welcome') === '1';
  const [f, setF] = useState({
    fullName: pilot.fullName, phone: pilot.phone, homeAerodrome: pilot.homeAerodrome ?? '',
    taxiOutMin: pilot.settings.taxiOutMin ?? '', taxiInMin: pilot.settings.taxiInMin ?? '', reserveMin: pilot.settings.reserveMin ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const n = (v: string | number) => (v === '' ? null : Number(v));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const p = await api.me.update({
        fullName: f.fullName, phone: f.phone, homeAerodrome: String(f.homeAerodrome).trim() || null,
        settings: { taxiOutMin: n(f.taxiOutMin), taxiInMin: n(f.taxiInMin), reserveMin: n(f.reserveMin) },
      });
      setPilot(p);
      setError(null);
      if (welcome && !profileMissing(p).length) navigate('/', { replace: true });
    } catch (err) {
      setError(String((err as Error).message));
    }
  };

  return (
    <Shell>
      <div className="page-head"><h1>{welcome ? 'Welcome — tell us about you' : 'Profile'}</h1></div>
      <form className="card stack" style={{ padding: 24, maxWidth: 520 }} onSubmit={save} data-testid="profile-form">
        <label className="field">Full name<input name="fullName" value={f.fullName} onChange={set('fullName')} required /></label>
        <label className="field">Phone<input name="phone" value={f.phone} onChange={set('phone')} required /></label>
        <label className="field">Home aerodrome (ICAO)<input name="homeAerodrome" value={f.homeAerodrome} onChange={set('homeAerodrome')} required /></label>
        <div className="row">
          <label className="field">Taxi out (min)<input name="taxiOutMin" type="number" min={0} value={f.taxiOutMin} placeholder={String(SETTING_SUGGESTIONS.taxiOutMin)} onChange={set('taxiOutMin')} /></label>
          <label className="field">Taxi in (min)<input name="taxiInMin" type="number" min={0} value={f.taxiInMin} placeholder={String(SETTING_SUGGESTIONS.taxiInMin)} onChange={set('taxiInMin')} /></label>
          <label className="field">Reserve (min)<input name="reserveMin" type="number" min={0} value={f.reserveMin} placeholder={String(SETTING_SUGGESTIONS.reserveMin)} onChange={set('reserveMin')} /></label>
        </div>
        {error && <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
        <div><button className="primary" type="submit">Save</button></div>
      </form>
    </Shell>
  );
}

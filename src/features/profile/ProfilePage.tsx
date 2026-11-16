// Profile: the pilot's details for the forms (the person editor shared with passengers, plus the
// licence number), home aerodrome, default aircraft and planning defaults (taxi out/in, fuel
// reserve, final reserve, ATC list radius) and the map layers of new flights. With ?welcome=1 (or while name, phone or home is
// missing) it is the first-use form: only name, phone, home aerodrome, taxi and reserve are asked.
// Nothing pilot-specific is prefilled: unset values show neutral placeholders.
// The form follows the pilot (another tab, a dialog) until it is edited.
import '../lobby/lists.css';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { useFocusParam } from '../../app/focusParam';
import { useSession } from '../../app/session';
import { Shell } from '../../app/Shell';
import { useToast } from '../../app/toast';
import { api } from '../../data/api';
import { useEntity } from '../../data/entities';
import { resolveAerodrome } from '../../data/ref';
import {
  DEFAULT_MAP_LAYERS,
  type MapLayers,
  mapLayersOf,
  type Pilot,
  type PilotUpdate,
  profileMissing,
  SETTING_SUGGESTIONS,
} from '../../shared';
import { errorMessage } from '../../shared/format';
import { AerodromeTextInput, CardSection, Field, NumberField } from '../../ui';
import { MapLayerToggles } from '../editor/map/MapLayerToggles';
import { type FormIssue, useFormIssues } from '../passengers/formIssues';
import { type PersonField, type PersonForm, personForm, personInput, validatePerson } from '../passengers/person';
import { PersonFields, type SetPerson } from '../passengers/PersonFields';
import { AccountSection } from './AccountSection';

export interface ProfileForm extends PersonForm {
  licenceNo: string;
  homeAerodrome: string;
  defaultAircraftId: string;
  defaultAlternate: string;
  taxiOutMin: number | null;
  taxiInMin: number | null;
  reserveMin: number | null;
  finalReserveMin: number | null;
  enrouteAerodromeRadiusNm: number | null;
  /** Map layers for new flights; null = not chosen (all shown). */
  mapLayers: MapLayers | null;
}

type ProfileField =
  | PersonField
  | 'homeAerodrome'
  | 'defaultAlternate'
  | 'taxiOutMin'
  | 'taxiInMin'
  | 'reserveMin'
  | 'finalReserveMin'
  | 'enrouteAerodromeRadiusNm';

const MINUTES_MAX = 600;
const RADIUS_MAX_NM = 50;

export function formOf(p: Pilot): ProfileForm {
  return {
    ...personForm(p),
    licenceNo: p.licenceNo,
    homeAerodrome: p.homeAerodrome ?? '',
    defaultAircraftId: p.defaultAircraftId ?? '',
    defaultAlternate: p.settings.defaultAlternate ?? '',
    taxiOutMin: p.settings.taxiOutMin,
    taxiInMin: p.settings.taxiInMin,
    reserveMin: p.settings.reserveMin,
    finalReserveMin: p.settings.finalReserveMin,
    enrouteAerodromeRadiusNm: p.settings.enrouteAerodromeRadiusNm,
    mapLayers: mapLayersOf(p.settings.mapLayers),
  };
}

const LABEL: Partial<Record<ProfileField, string>> = {
  taxiOutMin: 'Taxi out',
  taxiInMin: 'Taxi in',
  reserveMin: 'Fuel reserve',
  finalReserveMin: 'Final reserve',
  enrouteAerodromeRadiusNm: 'Radius',
};

/** What is wrong with the profile, field by field (empty when it can be saved). */
export function validateProfile(f: ProfileForm, welcome: boolean): FormIssue<ProfileField>[] {
  const out: FormIssue<ProfileField>[] = validatePerson(f, { pilot: true });
  const unknown = (t: string) => `“${t.trim()}” is not an aerodrome in the current AIP`;
  if (!f.homeAerodrome.trim()) out.push({ field: 'homeAerodrome', message: 'Choose your home aerodrome' });
  else if (!resolveAerodrome(f.homeAerodrome)) out.push({ field: 'homeAerodrome', message: unknown(f.homeAerodrome) });
  const range = (k: ProfileField, v: number | null, max: number) => {
    if (v != null && (!isFinite(v) || v < 0 || v > max))
      out.push({ field: k, message: `${LABEL[k]} must be 0–${max}` });
  };
  range('taxiOutMin', f.taxiOutMin, MINUTES_MAX);
  range('taxiInMin', f.taxiInMin, MINUTES_MAX);
  range('reserveMin', f.reserveMin, MINUTES_MAX);
  if (welcome) return out.filter((i) => !['dateOfBirth', 'weightKg'].includes(i.field));
  if (f.defaultAlternate.trim() && !resolveAerodrome(f.defaultAlternate))
    out.push({ field: 'defaultAlternate', message: unknown(f.defaultAlternate) });
  range('finalReserveMin', f.finalReserveMin, MINUTES_MAX);
  range('enrouteAerodromeRadiusNm', f.enrouteAerodromeRadiusNm, RADIUS_MAX_NM);
  return out;
}

/** The profile update of a form (call validateProfile first). */
export function profileUpdate(f: ProfileForm, welcome: boolean): PilotUpdate {
  const home = resolveAerodrome(f.homeAerodrome);
  const person = personInput(f);
  const base: PilotUpdate = {
    fullName: person.fullName,
    phone: person.phone,
    homeAerodrome: home ? home.icao || home.id : null,
    settings: { taxiOutMin: f.taxiOutMin, taxiInMin: f.taxiInMin, reserveMin: f.reserveMin },
  };
  // taxi left empty at sign-up: 15 min each way
  if (welcome)
    return {
      ...base,
      settings: {
        ...base.settings,
        taxiOutMin: f.taxiOutMin ?? SETTING_SUGGESTIONS.taxiOutMin,
        taxiInMin: f.taxiInMin ?? SETTING_SUGGESTIONS.taxiInMin,
      },
    };
  const altn = resolveAerodrome(f.defaultAlternate);
  return {
    ...base,
    licenceNo: f.licenceNo.trim(),
    nationality: person.nationality,
    relation: person.relation,
    dateOfBirth: person.dateOfBirth,
    weightKg: person.weightKg,
    idType: person.idType,
    idNumber: person.idNumber,
    defaultAircraftId: f.defaultAircraftId || null,
    settings: {
      ...base.settings,
      finalReserveMin: f.finalReserveMin ?? 0,
      enrouteAerodromeRadiusNm: f.enrouteAerodromeRadiusNm ?? 2,
      defaultAlternate: altn ? altn.icao || altn.id : null,
      ...(f.mapLayers ? { mapLayers: f.mapLayers } : {}),
    },
  };
}

/** Form → profile update; throws the first problem's message. */
export function toUpdate(f: ProfileForm, welcome: boolean): PilotUpdate {
  const [first] = validateProfile(f, welcome);
  if (first) throw new Error(first.message);
  return profileUpdate(f, welcome);
}

const sameForm = (a: ProfileForm, b: ProfileForm) => JSON.stringify(a) === JSON.stringify(b);

export function ProfilePage() {
  const { pilot } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const welcome = params.get('welcome') === '1' || profileMissing(pilot).length > 0;
  // The pilot the form was filled from; the form follows a newer pilot unless it has been edited.
  const [base, setBase] = useState<Pilot>(pilot);
  const initial = useMemo(() => formOf(base), [base]);
  const [f, setF] = useState<ProfileForm>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: hangar } = useEntity('aircraft');
  const formRef = useRef<HTMLFormElement>(null);
  const issues = useFormIssues<ProfileField>(formRef);
  const dirty = !sameForm(f, initial);
  // ?focus=<input name>: a warning elsewhere (an export) linked here
  useFocusParam(() => document.querySelector('main') ?? document);

  useEffect(() => {
    if (pilot === base || dirty) return;
    setBase(pilot);
    setF(formOf(pilot));
  }, [pilot, base, dirty]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const put = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    issues.clear(k as ProfileField);
  };
  const setPerson: SetPerson = (k, v) => put(k, v as ProfileForm[typeof k]);
  const text = (k: 'defaultAircraftId') => (e: { target: { value: string } }) => put(k, e.target.value);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!issues.check(validateProfile(f, welcome))) {
      setError(null);
      return;
    }
    setBusy(true);
    try {
      // api.me.update stores the pilot for every page and tab.
      const p = await api.me.update(profileUpdate(f, welcome));
      setBase(p);
      setF(formOf(p));
      setError(null);
      if (welcome && !profileMissing(p).length) {
        void navigate('/', { replace: true });
        if (hangar && hangar.length === 0)
          toast('Welcome aboard. Add your aircraft next.', {
            label: 'Open hangar',
            onClick: () => void navigate('/hangar'),
          });
        else toast('Welcome aboard.');
      } else {
        toast('Profile saved');
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const notSet = (v: number | null) => (v == null ? <span className="notset">Not set</span> : null);
  const minutes = (k: 'taxiOutMin' | 'taxiInMin' | 'reserveMin' | 'finalReserveMin', placeholder?: string) => (
    <NumberField
      name={k}
      value={f[k]}
      onChange={(v) => put(k, v)}
      min={0}
      max={MINUTES_MAX}
      integer
      unit="min"
      placeholder={placeholder}
    />
  );

  return (
    <Shell>
      <div className="page-head">
        <h1>Profile</h1>
      </div>
      <form
        className="card"
        style={{ maxWidth: 760 }}
        onSubmit={save}
        data-testid="profile-form"
        noValidate
        ref={formRef}
      >
        <CardSection id="about" title="About you" plain>
          <PersonFields
            f={f}
            set={setPerson}
            issues={issues.of}
            pilot
            minimal={welcome}
            autoFocus={welcome && !f.fullName}
          />
        </CardSection>

        <CardSection id="home" title="Home aerodrome" plain>
          <div className="grid2">
            <Field label="Aerodrome" req issues={f.homeAerodrome.trim() ? [] : issues.of('homeAerodrome')}>
              <AerodromeTextInput
                name="homeAerodrome"
                value={f.homeAerodrome}
                onChange={(t) => put('homeAerodrome', t)}
                required
                invalid={issues.of('homeAerodrome').length > 0}
              />
            </Field>
            {!welcome && (
              <Field label="Default aircraft">
                {hangar && hangar.length === 0 ? (
                  <div className="muted" style={{ padding: '7px 0' }}>
                    Hangar empty. <Link to="/hangar">Add an aircraft</Link>
                  </div>
                ) : (
                  <select name="defaultAircraftId" value={f.defaultAircraftId} onChange={text('defaultAircraftId')}>
                    <option value="">None</option>
                    {(hangar || []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.registration}
                        {a.makeModel ? ` · ${a.makeModel}` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
            {!welcome && (
              <Field label="Default alternate" testId="profile-default-alternate">
                <AerodromeTextInput
                  name="defaultAlternate"
                  value={f.defaultAlternate}
                  onChange={(t) => put('defaultAlternate', t)}
                  placeholder="Optional"
                  invalid={issues.of('defaultAlternate').length > 0}
                />
              </Field>
            )}
          </div>
        </CardSection>

        <CardSection id="planning" title="Planning defaults" plain>
          <div className="grid3">
            <Field label={<>Taxi out {notSet(f.taxiOutMin)}</>} issues={issues.of('taxiOutMin')}>
              {minutes('taxiOutMin', `e.g. ${SETTING_SUGGESTIONS.taxiOutMin}`)}
            </Field>
            <Field label={<>Taxi in {notSet(f.taxiInMin)}</>} issues={issues.of('taxiInMin')}>
              {minutes('taxiInMin', `e.g. ${SETTING_SUGGESTIONS.taxiInMin}`)}
            </Field>
            <Field label={<>Fuel reserve {notSet(f.reserveMin)}</>} issues={issues.of('reserveMin')}>
              {minutes('reserveMin', `e.g. ${SETTING_SUGGESTIONS.reserveMin}`)}
            </Field>
          </div>
          {!welcome && (
            <div className="grid3">
              <Field label="Final reserve in required fuel" issues={issues.of('finalReserveMin')}>
                {minutes('finalReserveMin', '0')}
              </Field>
              <Field label="ATC list: aerodromes within" issues={issues.of('enrouteAerodromeRadiusNm')}>
                <NumberField
                  name="enrouteAerodromeRadiusNm"
                  value={f.enrouteAerodromeRadiusNm}
                  onChange={(v) => put('enrouteAerodromeRadiusNm', v)}
                  min={0}
                  max={RADIUS_MAX_NM}
                  unit="NM"
                  placeholder="2"
                />
              </Field>
            </div>
          )}
        </CardSection>

        {!welcome && (
          <CardSection id="map-layers" title="Map layers for new flights" plain>
            <div style={{ maxWidth: 320 }} data-testid="profile-map-layers">
              <MapLayerToggles value={f.mapLayers ?? DEFAULT_MAP_LAYERS} onChange={(l) => put('mapLayers', l)} />
            </div>
          </CardSection>
        )}

        <div className="form-actions">
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {issues.issues.length > 0 && !error && (
            <p className="form-error" role="alert">
              {issues.issues.length === 1 ? '1 field to fix' : `${issues.issues.length} fields to fix`}
            </p>
          )}
          <span className="spacer" />
          {!welcome && dirty && (
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setBase(pilot);
                setF(formOf(pilot));
                issues.check([]);
                setError(null);
              }}
              disabled={busy}
            >
              Discard
            </button>
          )}
          <button className="primary" type="submit" disabled={busy || (!welcome && !dirty)}>
            {welcome ? 'Continue' : busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
      {!welcome && <AccountSection />}
    </Shell>
  );
}

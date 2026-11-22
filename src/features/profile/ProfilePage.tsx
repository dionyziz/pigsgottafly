// Edits save on their own (useAutosave, PUT /api/me). Nothing is required: a new account (a passenger,
// say) has only its e-mail, and the flight plan and the forms ask for the PIC's details they lack. The
// form follows the pilot (another tab, a dialog) while it has nothing unsaved.
import '../lobby/lists.css';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { useFocusParam } from '../../app/focusParam';
import { useSession } from '../../app/session';
import { Shell } from '../../app/Shell';
import { api, ApiRequestError, keepalivePut } from '../../data/api';
import { useEntity } from '../../data/entities';
import { resolveAerodrome } from '../../data/ref';
import {
  DEFAULT_MAP_LAYERS,
  type MapLayers,
  mapLayersOf,
  type Pilot,
  type PilotUpdate,
  SETTING_SUGGESTIONS,
} from '../../shared';
import { errorMessage } from '../../shared/format';
import { DEFAULT_CIRCUIT_MIN } from '../../shared/requests';
import { AerodromeTextInput, CardSection, Field, NumberField, SaveStatus, useAutosave } from '../../ui';
import { MapLayerToggles } from '../editor/map/MapLayerToggles';
import type { FormIssue } from '../passengers/formIssues';
import { type PersonField, type PersonForm, personForm, personInput, validatePerson } from '../passengers/person';
import { PersonFields, type SetPerson } from '../passengers/PersonFields';
import { AccountSection } from './AccountSection';
import { PilotDocuments } from './PilotDocuments';

export interface ProfileForm extends PersonForm {
  licenceNo: string;
  homeAerodrome: string;
  defaultAircraftId: string;
  defaultAlternate: string;
  taxiOutMin: number | null;
  taxiInMin: number | null;
  reserveMin: number | null;
  finalReserveMin: number | null;
  circuitMin: number | null;
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
  | 'circuitMin'
  | 'enrouteAerodromeRadiusNm';

const MINUTES_MAX = 600;
const RADIUS_MAX_NM = 50;
const CIRCUIT_MAX = 60;

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
    circuitMin: p.settings.circuitMin ?? null,
    enrouteAerodromeRadiusNm: p.settings.enrouteAerodromeRadiusNm,
    mapLayers: mapLayersOf(p.settings.mapLayers),
  };
}

const LABEL: Partial<Record<ProfileField, string>> = {
  taxiOutMin: 'Taxi out',
  taxiInMin: 'Taxi in',
  reserveMin: 'Fuel reserve',
  finalReserveMin: 'Final reserve',
  circuitMin: 'Circuit',
  enrouteAerodromeRadiusNm: 'Radius',
};

export function validateProfile(f: ProfileForm): FormIssue<ProfileField>[] {
  // an empty name or phone is not an error here: the papers that need them say so
  const out: FormIssue<ProfileField>[] = validatePerson(f, { pilot: true }).filter(
    (i) => i.field !== 'fullName' && i.field !== 'phone',
  );
  const unknown = (t: string) => `“${t.trim()}” is not an aerodrome in the current AIP`;
  if (f.homeAerodrome.trim() && !resolveAerodrome(f.homeAerodrome))
    out.push({ field: 'homeAerodrome', message: unknown(f.homeAerodrome) });
  const range = (k: ProfileField, v: number | null, max: number) => {
    if (v != null && (!isFinite(v) || v < 0 || v > max))
      out.push({ field: k, message: `${LABEL[k]} must be 0–${max}` });
  };
  range('taxiOutMin', f.taxiOutMin, MINUTES_MAX);
  range('taxiInMin', f.taxiInMin, MINUTES_MAX);
  range('reserveMin', f.reserveMin, MINUTES_MAX);
  if (f.defaultAlternate.trim() && !resolveAerodrome(f.defaultAlternate))
    out.push({ field: 'defaultAlternate', message: unknown(f.defaultAlternate) });
  range('finalReserveMin', f.finalReserveMin, MINUTES_MAX);
  if (f.circuitMin != null && (!isFinite(f.circuitMin) || f.circuitMin < 1 || f.circuitMin > CIRCUIT_MAX))
    out.push({ field: 'circuitMin', message: `Circuit must be 1–${CIRCUIT_MAX}` });
  range('enrouteAerodromeRadiusNm', f.enrouteAerodromeRadiusNm, RADIUS_MAX_NM);
  return out;
}

/** The profile update of a form (call validateProfile first). */
export function profileUpdate(f: ProfileForm): PilotUpdate {
  const home = resolveAerodrome(f.homeAerodrome);
  const person = personInput(f);
  const altn = resolveAerodrome(f.defaultAlternate);
  return {
    fullName: person.fullName,
    phone: person.phone,
    homeAerodrome: home ? home.icao || home.id : null,
    licenceNo: f.licenceNo.trim(),
    nationality: person.nationality,
    relation: person.relation,
    dateOfBirth: person.dateOfBirth,
    weightKg: person.weightKg,
    idType: person.idType,
    idNumber: person.idNumber,
    defaultAircraftId: f.defaultAircraftId || null,
    settings: {
      taxiOutMin: f.taxiOutMin,
      taxiInMin: f.taxiInMin,
      reserveMin: f.reserveMin,
      finalReserveMin: f.finalReserveMin ?? 0,
      circuitMin: f.circuitMin ?? DEFAULT_CIRCUIT_MIN,
      enrouteAerodromeRadiusNm: f.enrouteAerodromeRadiusNm ?? 2,
      defaultAlternate: altn ? altn.icao || altn.id : null,
      ...(f.mapLayers ? { mapLayers: f.mapLayers } : {}),
    },
  };
}

/** Form → profile update; throws the first problem's message. */
export function toUpdate(f: ProfileForm): PilotUpdate {
  const [first] = validateProfile(f);
  if (first) throw new Error(first.message);
  return profileUpdate(f);
}

export function ProfilePage() {
  const { pilot } = useSession();
  const [f, setF] = useState<ProfileForm>(() => formOf(pilot));
  const { data: hangar } = useEntity('aircraft');
  // problems show as they arise and hold the save back
  const live = validateProfile(f);
  const issuesOf = (k: ProfileField) => live.filter((i) => i.field === k).map((i) => i.message);
  // ?focus=<input name>: a warning elsewhere (an export) linked here
  useFocusParam(() => document.querySelector('main') ?? document);

  // the pilots this page saved: they are not news to follow
  const ours = useRef<Pilot | null>(null);
  const save = useCallback(async (v: ProfileForm) => {
    // api.me.update stores the pilot for every page and tab.
    ours.current = await api.me.update(profileUpdate(v));
  }, []);
  const autosave = useAutosave({
    value: f,
    enabled: live.length === 0,
    save,
    keepalive: (v) => keepalivePut('me', profileUpdate(v)),
  });
  const blocked = autosave.dirty && live.length > 0;
  const saveError = autosave.status === 'failed' ? autosave.error : null;

  // a newer pilot from elsewhere: the form takes it unless it has unsaved edits
  const { dirty, adopt, flush } = autosave;
  const [seen, setSeen] = useState(pilot);
  if (seen !== pilot) {
    setSeen(pilot);
    if (pilot !== ours.current && !dirty) {
      const next = formOf(pilot);
      adopt(next);
      setF(next);
    }
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        flush();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [flush]);

  const put = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const setPerson: SetPerson = (k, v) => put(k, v as ProfileForm[typeof k]);
  const text = (k: 'defaultAircraftId') => (e: { target: { value: string } }) => put(k, e.target.value);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    flush();
  };

  const notSet = (v: number | null) => (v == null ? <span className="notset">Not set</span> : null);
  const minutes = (
    k: 'taxiOutMin' | 'taxiInMin' | 'reserveMin' | 'finalReserveMin' | 'circuitMin',
    placeholder?: string,
  ) => (
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
        <SaveStatus status={autosave.status} blocked={blocked} />
      </div>
      <form
        className="card"
        style={{ maxWidth: 760 }}
        onSubmit={submit}
        onBlur={() => flush()}
        data-testid="profile-form"
        noValidate
      >
        <CardSection id="about" title="About you" plain>
          <PersonFields f={f} set={setPerson} issues={issuesOf} pilot optional />
        </CardSection>

        <CardSection id="home" title="Home aerodrome" plain>
          <div className="grid2">
            <Field label="Aerodrome">
              <AerodromeTextInput
                name="homeAerodrome"
                value={f.homeAerodrome}
                onChange={(t) => put('homeAerodrome', t)}
                placeholder="Optional"
                invalid={issuesOf('homeAerodrome').length > 0}
              />
            </Field>
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
            <Field label="Default alternate" testId="profile-default-alternate">
              <AerodromeTextInput
                name="defaultAlternate"
                value={f.defaultAlternate}
                onChange={(t) => put('defaultAlternate', t)}
                placeholder="Optional"
                invalid={issuesOf('defaultAlternate').length > 0}
              />
            </Field>
          </div>
        </CardSection>

        <CardSection id="planning" title="Planning defaults" plain>
          <div className="grid3">
            <Field label={<>Taxi out {notSet(f.taxiOutMin)}</>} issues={issuesOf('taxiOutMin')}>
              {minutes('taxiOutMin', `e.g., ${SETTING_SUGGESTIONS.taxiOutMin}`)}
            </Field>
            <Field label={<>Taxi in {notSet(f.taxiInMin)}</>} issues={issuesOf('taxiInMin')}>
              {minutes('taxiInMin', `e.g., ${SETTING_SUGGESTIONS.taxiInMin}`)}
            </Field>
            <Field label={<>Fuel reserve {notSet(f.reserveMin)}</>} issues={issuesOf('reserveMin')}>
              {minutes('reserveMin', `e.g., ${SETTING_SUGGESTIONS.reserveMin}`)}
            </Field>
          </div>
          <div className="grid3">
            <Field label="Final reserve in required fuel" issues={issuesOf('finalReserveMin')}>
              {minutes('finalReserveMin', '0')}
            </Field>
            <Field label="Circuit" issues={issuesOf('circuitMin')}>
              {minutes('circuitMin', String(DEFAULT_CIRCUIT_MIN))}
            </Field>
            <Field label="ATC list: aerodromes within" issues={issuesOf('enrouteAerodromeRadiusNm')}>
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
        </CardSection>

        <CardSection id="map-layers" title="Map layers for new flights" plain>
          <div style={{ maxWidth: 320 }} data-testid="profile-map-layers">
            <MapLayerToggles value={f.mapLayers ?? DEFAULT_MAP_LAYERS} onChange={(l) => put('mapLayers', l)} />
          </div>
        </CardSection>

        {saveError ? (
          <div className="form-actions" role="alert" data-testid="problem-bar">
            <p className="form-error">
              {saveError instanceof ApiRequestError && saveError.offline
                ? 'Offline: changes not saved yet'
                : `Not saved: ${errorMessage(saveError)}`}
            </p>
            <span className="spacer" />
            <button type="button" className="sm" onClick={autosave.retry} data-testid="save-retry">
              Retry
            </button>
          </div>
        ) : (
          <button type="submit" hidden />
        )}
      </form>
      <PilotDocuments />
      <AccountSection />
    </Shell>
  );
}

// Add/edit a passenger in a dialog. Exported for reuse: the editor's manifest can create a passenger
// on the spot with <PassengerDialog passenger={null} initialName="…" onSaved={…} />.
// The pilot is a passenger too: <PilotDetailsDialog /> edits the pilot's own person details (plus the
// licence number) with the same form, saved to the profile (PUT /api/me).
import { DateInput } from '../../app/DateInput';
import { useState } from 'react';
import { api } from '../../data/api';
import { EMPTY_PERSON, type Passenger, type PassengerInput, type Pilot } from '../../shared';
import { useSession } from '../../app/session';
import { Dialog } from '../lobby/ui';

export interface PassengerForm {
  fullName: string; phone: string; dateOfBirth: string; weightKg: string;
  idType: '' | 'ID' | 'PASSPORT'; idNumber: string; nationality: string; relation: string; notes: string;
  /** Pilot only. */
  licenceNo?: string;
}

type SetField = <K extends keyof PassengerForm>(k: K) => (e: { target: { value: string } }) => void;

/** The person form shared by passengers and the pilot (pilot: licence number instead of notes). */
function PersonFields({ f, set, onSubmit, pilot = false }: { f: PassengerForm; set: SetField; onSubmit: (e?: React.FormEvent) => void; pilot?: boolean }) {
  return (
  <form className="stack" onSubmit={onSubmit}>
      <div className="grid2">
        <label className="field"><span>Full name<span className="req" aria-hidden>*</span></span>
          <input name="fullName" value={f.fullName} onChange={set('fullName')} required data-autofocus placeholder={pilot ? 'As on your licence' : 'As on their ID'} />
        </label>
        <label className="field">Phone<input name="phone" type="tel" value={f.phone} onChange={set('phone')} placeholder="+30 …" /></label>
      </div>
      <div className="grid3">
        <label className="field">Date of birth<DateInput name="dateOfBirth" value={f.dateOfBirth} onChange={set('dateOfBirth')} /></label>
        <label className="field">Weight
          <div className="unit-input"><input name="weightKg" inputMode="decimal" value={f.weightKg} onChange={set('weightKg')} placeholder="for W&B" /><span>kg</span></div>
        </label>
        <label className="field">Nationality<input name="nationality" value={f.nationality} onChange={set('nationality')} placeholder="e.g. GREEK" /></label>
      </div>
      <div className="grid2">
        <label className="field">ID / passport number<input name="idNumber" value={f.idNumber} onChange={set('idNumber')} placeholder="e.g. AK 123456" /></label>
        {pilot && <label className="field">Licence number<input name="licenceNo" value={f.licenceNo ?? ''} onChange={set('licenceNo')} placeholder="e.g. GR.FCL.PPL.12345" /></label>}
      </div>
      {!pilot && <label className="field">Notes<textarea name="notes" rows={2} value={f.notes} onChange={set('notes')} /></label>}
      <button type="submit" hidden />
    </form>
  );
}

export function passengerForm(p: Passenger | null, initialName = ''): PassengerForm {
  const b = p ?? { ...EMPTY_PERSON, notes: '' };
  return {
    fullName: p ? b.fullName : initialName, phone: b.phone, dateOfBirth: b.dateOfBirth ?? '', weightKg: b.weightKg == null ? '' : String(b.weightKg),
    idType: b.idType, idNumber: b.idNumber, nationality: b.nationality, relation: b.relation, notes: b.notes,
  };
}

/** Form → API input; throws a readable message on invalid values. */
export function passengerInputOf(f: PassengerForm): PassengerInput {
  const fullName = f.fullName.trim().replace(/\s+/g, ' ');
  if (!fullName) throw new Error('Please enter the full name');
  let weightKg: number | null = null;
  const w = f.weightKg.trim().replace(',', '.');
  if (w) {
    weightKg = Number(w);
    if (!isFinite(weightKg) || weightKg <= 0 || weightKg > 300) throw new Error('Weight must be between 1 and 300 kg');
  }
  if (f.dateOfBirth) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.dateOfBirth)) throw new Error('Date of birth is not a valid date');
    if (f.dateOfBirth > new Date().toISOString().slice(0, 10)) throw new Error('Date of birth is in the future');
  }
  return {
    fullName, phone: f.phone.trim(), dateOfBirth: f.dateOfBirth || null, weightKg,
    idType: f.idType, idNumber: f.idNumber.trim(), nationality: f.nationality.trim().toUpperCase(), relation: f.relation.trim(), notes: f.notes.trim(),
  };
}

export function PassengerDialog({ passenger, initialName, onClose, onSaved }: {
  passenger: Passenger | null;
  initialName?: string;
  onClose: () => void;
  onSaved: (p: Passenger, created: boolean) => void;
}) {
  const [f, setF] = useState<PassengerForm>(() => passengerForm(passenger, initialName));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set: SetField = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    let input: PassengerInput;
    try { input = passengerInputOf(f); } catch (err) { setError((err as Error).message); return; }
    setBusy(true);
    try {
      const p = passenger ? await api.passengers.update(passenger.id, input) : await api.passengers.create(input);
      onSaved(p, !passenger);
    } catch (err) {
      setError(String((err as Error).message || err));
      setBusy(false);
    }
  };

  return (
    <Dialog title={passenger ? 'Edit passenger' : 'New passenger'} onClose={onClose} busy={busy} wide testId="passenger-dialog" footer={<>
      {error && <p className="form-error" role="alert" style={{ marginRight: 'auto', alignSelf: 'center' }}>{error}</p>}
      <button type="button" className="ghost" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="primary" onClick={() => void submit()} disabled={busy}>{passenger ? 'Save' : 'Add passenger'}</button>
    </>}>
      <PersonFields f={f} set={set} onSubmit={submit} />
    </Dialog>
  );
}

/** The pilot's own person details (as on the forms and for W&B), edited like a passenger's. */
export function PilotDetailsDialog({ onClose, onSaved }: { onClose: () => void; onSaved?: (p: Pilot) => void }) {
  const { pilot, setPilot } = useSession();
  const [f, setF] = useState<PassengerForm>(() => ({ ...passengerForm({ ...pilot, id: pilot.id, notes: '', created: 0, updated: 0 }), licenceNo: pilot.licenceNo }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set: SetField = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    let input: PassengerInput;
    try { input = passengerInputOf(f); } catch (err) { setError((err as Error).message); return; }
    if (!input.phone) { setError('Please enter your phone number'); return; }
    setBusy(true);
    try {
      const { notes: _notes, ...person } = input;
      const p = await api.me.update({ ...person, licenceNo: (f.licenceNo ?? '').trim() });
      setPilot(p);
      onSaved?.(p);
    } catch (err) {
      setError(String((err as Error).message || err));
      setBusy(false);
    }
  };

  return (
    <Dialog title="Your details" onClose={onClose} busy={busy} wide testId="pilot-dialog" footer={<>
      {error && <p className="form-error" role="alert" style={{ marginRight: 'auto', alignSelf: 'center' }}>{error}</p>}
      <button type="button" className="ghost" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="primary" onClick={() => void submit()} disabled={busy}>Save</button>
    </>}>
      <PersonFields f={f} set={set} onSubmit={submit} pilot />
    </Dialog>
  );
}

// Add/edit a passenger in a dialog. Exported for reuse: the editor's manifest can create a passenger
// on the spot with <PassengerDialog passenger={null} initialName="…" onSaved={…} />.
import { useState } from 'react';
import { api } from '../../data/api';
import { EMPTY_PERSON, type Passenger, type PassengerInput } from '../../shared';
import { Dialog } from '../lobby/ui';

export interface PassengerForm {
  fullName: string; phone: string; dateOfBirth: string; weightKg: string;
  idType: '' | 'ID' | 'PASSPORT'; idNumber: string; nationality: string; relation: string; notes: string;
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
  const set = <K extends keyof PassengerForm>(k: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value as PassengerForm[K] }));

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
      <form className="stack" onSubmit={submit}>
        <div className="grid2">
          <label className="field"><span>Full name<span className="req" aria-hidden>*</span></span>
            <input name="fullName" value={f.fullName} onChange={set('fullName')} required data-autofocus placeholder="As on their ID" />
          </label>
          <label className="field">Phone<input name="phone" type="tel" value={f.phone} onChange={set('phone')} placeholder="+30 …" /></label>
        </div>
        <div className="grid3">
          <label className="field">Date of birth<input name="dateOfBirth" type="date" value={f.dateOfBirth} onChange={set('dateOfBirth')} /></label>
          <label className="field">Weight
            <div className="unit-input"><input name="weightKg" inputMode="decimal" value={f.weightKg} onChange={set('weightKg')} placeholder="for W&B" /><span>kg</span></div>
          </label>
          <label className="field">Nationality<input name="nationality" value={f.nationality} onChange={set('nationality')} placeholder="e.g. GREEK" /></label>
        </div>
        <div className="grid2">
          <label className="field">Identity document
            <div className="row" style={{ gap: 6 }}>
              <select name="idType" value={f.idType} onChange={set('idType')} style={{ width: 'auto' }} aria-label="Document type">
                <option value="">—</option><option value="ID">ID card</option><option value="PASSPORT">Passport</option>
              </select>
              <input name="idNumber" value={f.idNumber} onChange={set('idNumber')} placeholder="Number" aria-label="Document number" />
            </div>
          </label>
          <label className="field">Relation
            <input name="relation" value={f.relation} onChange={set('relation')} placeholder="Aeroclub member code, FRIEND, FAMILY…" />
          </label>
        </div>
        <label className="field">Notes<textarea name="notes" rows={2} value={f.notes} onChange={set('notes')} /></label>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

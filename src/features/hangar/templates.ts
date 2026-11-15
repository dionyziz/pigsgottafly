// Aircraft type templates offered by "Add aircraft". Each builds a blank airframe of the type from
// its AFM data file (src/shared/templates.ts → aircraftFromTypeJson). Add a type by adding its JSON
// file under data/aircraft/ and a line here.
import { aircraftFromTypeJson, blankAircraft, type AircraftTypeTemplate } from '../../shared/templates';
import type { AircraftInput } from '../../shared/types';
import reimsF172m from '../../../data/aircraft/reims-f172m.json';

export interface HangarTemplate extends AircraftTypeTemplate {
  /** One line about what the template fills in. */
  description: string;
}

export const TYPE_TEMPLATES: HangarTemplate[] = [
  {
    id: 'reims-f172m',
    label: 'Reims/Cessna F172M',
    description: 'AFM 1972: fuel system (AVGAS), four seats and baggage stations, normal and utility envelopes, take-off and landing tables, stall speeds. Planning factors start at Aeroclub Mesogeion’s values (safety × 1.33 / 1.43, grass and RWYCC 5 factors, crosswind 20 / 15 kt): edit them under Performance.',
    build: () => aircraftFromTypeJson(reimsF172m),
  },
];

export function buildFromTemplate(id: string | null): AircraftInput {
  const t = TYPE_TEMPLATES.find((x) => x.id === id);
  return t ? t.build() : blankAircraft();
}

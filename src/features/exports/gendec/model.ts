// General Declaration (ICAO Annex 9 Appendix 1, club form MD 4.7): what goes in each field. The
// content is src/shared/forms.ts genDecContent (shared with the PDF e-mailed to HCAA); here it is
// bound to the client's reference data, with what is missing as warnings.
import { aerodrome } from '../../../data/ref';
import {
  type AerodromeLookup,
  GENDEC_ROUTING_ROWS,
  type GenDecContent,
  genDecContent,
  routePlacesWith,
} from '../../../shared/forms';
import type { FormExportProps } from '../form731/common';
import type { FormFix } from '../form731/FormWarnings';

export const ROUTING_ROWS = GENDEC_ROUTING_ROWS;

export interface GenDecModel extends GenDecContent {
  warnings: string[];
  fixes: Record<string, FormFix>;
}

export function genDecModel(props: FormExportProps): GenDecModel {
  return genDecModelWith(props, aerodrome);
}

/** genDecModel with other reference data (the native core's GET /api/ref/bundle). */
export function genDecModelWith(props: FormExportProps, find: AerodromeLookup): GenDecModel {
  const { flight, aircraft, pilot, passengers } = props;
  const c = genDecContent(flight, aircraft, pilot, passengers, find);
  const places = routePlacesWith(flight.route, find);
  const warnings: string[] = [];
  const fixes: Record<string, FormFix> = {};
  const warn = (text: string, fix: FormFix | null) => {
    warnings.push(text);
    if (fix) fixes[text] = fix;
  };
  if (!aircraft)
    warn('No aircraft is selected: operator and registration are blank.', { kind: 'flight', focus: 'aircraft' });
  else if (!aircraft.operator.trim())
    warn(`${aircraft.registration} has no operator in the hangar: the PIC is printed as operator.`, {
      kind: 'aircraft',
      id: aircraft.id,
      focus: 'operator',
    });
  if (!flight.date) warn('The flight has no date.', { kind: 'flight', focus: 'date' });
  if (places.length < 2) warn('The route needs a departure and a destination.', { kind: 'flight' });
  if (!c.picName) warn('Your full name is not set.', { kind: 'person', key: 'PIC', fields: ['fullName'] });
  return { ...c, warnings, fixes };
}

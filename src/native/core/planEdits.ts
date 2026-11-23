// The Plan sections' edits that are more than setting one field: choosing the aircraft
// (AircraftSection) and typing the fuel on board (FuelSection).
import { setAircraft as setAircraftOf } from '../../features/editor/panels/aircraftChoice';
import { withFuel, withTypedFuel } from '../../features/editor/panels/fuelEdit';
import type { Aircraft, FlightDoc, FuelSpec, FuelType } from '../../shared';
import { arg, type Json, plain } from './shared';

type AircraftDoc = Pick<FlightDoc, 'aircraftId' | 'crew' | 'baggageKg' | 'options'>;

/** The flight's aircraft, crew seats, baggage and options after choosing `aircraft` (null: none). */
export function setAircraft(input: Json<{ doc: AircraftDoc; aircraft?: Aircraft | null }>) {
  const i = arg(input);
  const d = setAircraftOf(i.doc as FlightDoc, i.aircraft ?? null);
  return plain({ aircraftId: d.aircraftId, crew: d.crew, baggageKg: d.baggageKg, options: d.options });
}

type FuelDoc = Pick<FlightDoc, 'fobL' | 'options'>;

/**
 * The flight's fobL and options after a fuel edit: `type` litres of one fuel typed (null: cleared),
 * `total` the fuel on board of a single-fuel aircraft (null: required + reserve), `default` back to
 * required + reserve.
 */
export function fuelEdit(
  input: Json<
    { doc: FuelDoc } & (
      | { op: 'type'; fuel: Pick<FuelSpec, 'types'>; type: FuelType; litres: number | null }
      | { op: 'total'; litres: number | null }
      | { op: 'default' }
    )
  >,
) {
  const i = arg(input);
  const d =
    i.op === 'type'
      ? withTypedFuel(i.doc, i.fuel, i.type, i.litres)
      : withFuel(i.doc, i.op === 'total' ? i.litres : null, null);
  return plain({ fobL: d.fobL, options: d.options });
}

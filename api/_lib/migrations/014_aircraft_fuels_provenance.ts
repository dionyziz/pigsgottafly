// Aircraft fuels and seeded provenance texts.
//
// 1. Fuel: one fuel type per aircraft ({type, densityKgPerL}) becomes a list of approved fuels
//    ({types: [{type, densityKgPerL}]}), for every aircraft. The owner's SX-ASV and SX-ASG (matched
//    like 003/011, by the SHA-256 of the e-mail) take AVGAS and MOGAS: MOGAS 0.75 kg/L is added after
//    their AVGAS, so a flight that gives only a total keeps meaning AVGAS. Flights need no change: a
//    flight without fuel by type (FlightOptions.fuelL) carries the aircraft's first fuel.
// 2. Texts 003 seeded that are no use in the hangar, cleared or shortened only where they still
//    equal the seeded text (the pilot may have edited them): the owner's aircraft notes (weighing
//    remarks), the internal file paths in the weighing report reference and the compass cards'
//    reference (file names), the seat-arm clause of SX-ASV's utility note; and, on every aircraft
//    made from the F172M template, the fixed planning-factors caption ('Aeroclub Mesogeion MD 4.4
//    performance log') and the bracketed units of the AFM table sources.
const OWNER_HASH = '0f8a30628c0ec410f2ea9ec36e004bf15fea39d4a69e8cf1011e0a3b560486c6';

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const j = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;
const NOW = '(extract(epoch FROM clock_timestamp()) * 1000)::BIGINT';

const SEEDED_NOTES: Record<string, string> = {
  'SX-ASV': 'Report prints 103.97 cm in the SUM row and 104.03 cm as the C.G.; 71911.59 / 691.20 = 104.04 cm.\nUtility: no rear passengers, no baggage; front seats set forward to 0.90 m (club W&B calculator).',
  'SX-ASG': "Weighed with fuel tanks and fuel system empty, oil full (8 qt), 4 life vests, fire extinguisher, flight manual. Unusable fuel (15 L) must be added. CG 113.98 cm is ~10 cm aft of SX-ASV's.",
};
const WEIGHING: Record<string, [string, string]> = {
  'SX-ASV': ['DAS (EL.145.0078) weight and balance report, 14-11-2024 (trn-docs/SXASV_WB_FORM_2024.pdf)', 'DAS (EL.145.0078) weight and balance report, 14-11-2024'],
  'SX-ASG': ['Weight and balance report signed 28 FEB 2024, scales calibrated 22-JAN-24 (trn-docs/SXASG_WB_FORM_2024.pdf)', 'Weight and balance report signed 28 FEB 2024, scales calibrated 22-JAN-24'],
};
const UTILITY_NOTE: [string, string] = ['Utility: no rear passengers, no baggage; front seats set forward to 0.90 m (club W&B calculator).', 'No rear passengers, no baggage.'];
const CARD_FILES = ['SXASV_COMPASS_SWING_exp20280205.pdf', 'SXASG_COMPASS_SWING_exp20270206.pdf'];
const TAKEOFF_SOURCE: [string, string] = [
  'AFM 5-8 Table 5: take-off distance, flaps retracted, hard surface runway. Distances in m: [ground run, total to clear 15 m obstacle].',
  'AFM 5-8 Table 5: take-off distance, flaps retracted, hard surface runway',
];
const LANDING_SOURCE: [string, string] = [
  'AFM 5-9 Table 6: landing distance, flaps 40°, power off, zero wind, hard surface runway. Distances in m: [ground roll, total to clear 15 m obstacle].',
  'AFM 5-9 Table 6: landing distance, flaps 40°, power off, zero wind, hard surface runway',
];
const FACTORS_SOURCE = 'Aeroclub Mesogeion MD 4.4 performance log';

/** The migration's SQL for the owner account with this e-mail hash (tests pass their own). */
export function migrationSql(ownerHash: string = OWNER_HASH): string {
  const owner = `encode(sha256(convert_to(lower(btrim(p.email)), 'UTF8')), 'hex') = ${q(ownerHash)}`;
  const ownerAc = (reg: string) => `a.pilot_id = p.id AND a.registration = ${q(reg)} AND ${owner}`;
  const out: string[] = [];

  // 1. approved fuels
  out.push(`UPDATE aircraft SET fuel = (fuel - 'type' - 'densityKgPerL')
  || jsonb_build_object('types', jsonb_build_array(jsonb_build_object(
       'type', COALESCE(fuel->'type', '"AVGAS"'::jsonb),
       'densityKgPerL', COALESCE(fuel->'densityKgPerL', '0.72'::jsonb))))
WHERE NOT (fuel ? 'types');`);
  for (const reg of ['SX-ASV', 'SX-ASG']) {
    out.push(`UPDATE aircraft a SET fuel = jsonb_set(a.fuel, '{types}', (a.fuel->'types') || ${j([{ type: 'MOGAS', densityKgPerL: 0.75 }])}), updated = ${NOW}
FROM pilots p WHERE ${ownerAc(reg)} AND NOT ((a.fuel->'types') @> ${j([{ type: 'MOGAS' }])});`);
  }

  // 2. the owner's seeded texts
  for (const [reg, text] of Object.entries(SEEDED_NOTES)) {
    out.push(`UPDATE aircraft a SET notes = '', updated = ${NOW} FROM pilots p WHERE ${ownerAc(reg)} AND a.notes = ${q(text)};`);
  }
  for (const [reg, [from, to]] of Object.entries(WEIGHING)) {
    out.push(`UPDATE aircraft a SET mass_balance = jsonb_set(a.mass_balance, '{weighingSource}', to_jsonb(${q(to)}::text)), updated = ${NOW}
FROM pilots p WHERE ${ownerAc(reg)} AND a.mass_balance->>'weighingSource' = ${q(from)};`);
  }
  out.push(`UPDATE aircraft a SET mass_balance = jsonb_set(a.mass_balance, '{envelopes,utility,notes}', to_jsonb(${q(UTILITY_NOTE[1])}::text)), updated = ${NOW}
FROM pilots p WHERE ${ownerAc('SX-ASV')} AND a.mass_balance #>> '{envelopes,utility,notes}' = ${q(UTILITY_NOTE[0])};`);
  const files = `(${CARD_FILES.map(q).join(', ')})`;
  out.push(`UPDATE aircraft a SET compass_cards = (
    SELECT jsonb_agg(CASE WHEN c->>'source' IN ${files} THEN jsonb_set(c, '{source}', '""'::jsonb) ELSE c END ORDER BY i)
    FROM jsonb_array_elements(a.compass_cards) WITH ORDINALITY AS t(c, i)), updated = ${NOW}
FROM pilots p WHERE a.pilot_id = p.id AND a.registration IN ('SX-ASV', 'SX-ASG') AND ${owner}
  AND jsonb_typeof(a.compass_cards) = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.compass_cards) c WHERE c->>'source' IN ${files});`);

  // 3. template captions, on every aircraft
  out.push(`UPDATE aircraft SET performance = jsonb_set(performance, '{factors,source}', '""'::jsonb)
WHERE performance #>> '{factors,source}' = ${q(FACTORS_SOURCE)};`);
  out.push(`UPDATE aircraft SET performance = jsonb_set(performance, '{takeoff,source}', to_jsonb(${q(TAKEOFF_SOURCE[1])}::text))
WHERE performance #>> '{takeoff,source}' = ${q(TAKEOFF_SOURCE[0])};`);
  out.push(`UPDATE aircraft SET performance = jsonb_set(performance, '{landing,source}', to_jsonb(${q(LANDING_SOURCE[1])}::text))
WHERE performance #>> '{landing,source}' = ${q(LANDING_SOURCE[0])};`);
  return out.join('\n');
}

const sql: string = migrationSql();
export default sql;

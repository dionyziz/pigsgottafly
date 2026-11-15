// The owner's SX-ASV and SX-ASG flight-plan data, as filed for both aircraft in the club's EuroFPL
// profiles (15 Nov 2026): item 10 SBDFGRY/EB1; item 18 PBN/B2C2D2O2S1 NAV/SBAS RMK/GARMIN GNS430W
// (OPR/ comes from the aircraft's operator); item 19 R/E, J/LF, N/OPR TEL …, A/ colours.
// Only the owner's aircraft (matched like 003, by the SHA-256 of the e-mail) are changed.
const OWNER = "encode(sha256(convert_to(lower(btrim(p.email)), 'UTF8')), 'hex') = '0f8a30628c0ec410f2ea9ec36e004bf15fea39d4a69e8cf1011e0a3b560486c6'";
export const equipment = {
  item10a: 'SBDFGRY',
  item10b: 'EB1',
  pbn: 'B2C2D2O2S1',
  item18Extras: 'NAV/SBAS RMK/GARMIN GNS430W',
  emergencyRadio: { uhf: false, vhf: false, elt: true },
  survival: { polar: false, desert: false, maritime: false, jungle: false },
  jackets: { present: true, light: true, fluorescein: true, uhf: false, vhf: false },
  dinghies: null,
  remarks: 'OPR TEL +302108169910 +306974776230',
};
export const colours: Record<string, string> = { 'SX-ASV': 'WHITE WITH BLUE STRIPES', 'SX-ASG': 'WHITE WITH BLACK RED STRIPES' };
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const sql: string = Object.entries(colours).map(([reg, col]) => `UPDATE aircraft a SET
  equipment = a.equipment || ${q(JSON.stringify(equipment))}::jsonb,
  colours = ${q(col)},
  updated = (extract(epoch FROM clock_timestamp()) * 1000)::BIGINT
FROM pilots p WHERE a.pilot_id = p.id AND a.registration = ${q(reg)} AND ${OWNER};`).join('\n');
export default sql;

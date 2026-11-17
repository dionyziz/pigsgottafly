// A passenger's e-mail address, where their Form 731 is sent (api/_lib/routes/forms.ts). Existing
// passengers: NULL (no address yet; the passenger list shows it as missing).
const sql = `
ALTER TABLE passengers ADD COLUMN email TEXT;
`;
export default sql;

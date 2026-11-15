// A signing link is bound to the person it was given to (api/_lib/routes/forms.ts personHash), not
// only to the manifest key: a passenger without a saved record is keyed by seat ('seat:<id>'), and
// the next person put in that seat must not be reachable through the earlier person's link.
// Links created before this migration have no binding; seat-keyed ones among them stop working.
const sql: string = String.raw`
ALTER TABLE form_links ADD COLUMN person_hash TEXT;
`;
export default sql;

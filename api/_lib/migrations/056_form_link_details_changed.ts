// A passenger's corrections of their own details on the signing page (PUT /sign/:token/details,
// routes/forms.ts), kept with their link until they sign: the pilot's "signed" e-mail lists them.
// {fields: {<key>: {from, to}}, resign: [person keys whose signatures the change invalidated]}; NULL = none.
const sql = `ALTER TABLE form_links ADD COLUMN details_changed JSONB;`;
export default sql;

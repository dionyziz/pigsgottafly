// Sign in with Apple (POST /login/apple): Apple's stable user id ('sub') of a pilot, unique when set.
// google_sub is already nullable (the local pilot has none), so a pilot may sign in with Apple only.
const sql = `
ALTER TABLE pilots ADD COLUMN apple_sub TEXT UNIQUE;
`;
export default sql;

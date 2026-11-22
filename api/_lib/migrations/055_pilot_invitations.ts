// Inviting pilots to the app by e-mail (routes/invitations.ts). A pilot invites an address no account
// uses yet, optionally sharing some aircraft they may share (owner or editor) with it; when someone
// signs in with that verified address the invitation is accepted and the aircraft are shared
// (routes/session.ts). An accepted invitation is kept: it admits its address past ALLOWED_EMAILS.
//
// pilot_invitations.pilot_id is the inviter (named so that deleting their account removes what they
// sent, like every other pilot_id row). One open or accepted invitation per inviter and address.
// pilot_invitation_aircraft: the aircraft still to share when it is accepted; removing one cancels
// that aircraft only, the invitation stays. Rows are deleted once the invitation is accepted.
const sql = `
CREATE TABLE pilot_invitations (
  id TEXT PRIMARY KEY,
  pilot_id TEXT NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
  email TEXT NOT NULL CHECK (email = lower(email) AND email <> ''),
  message TEXT NOT NULL DEFAULT '',
  created BIGINT NOT NULL,
  accepted_at BIGINT,
  UNIQUE (pilot_id, email)
);
CREATE INDEX pilot_invitations_email ON pilot_invitations (email);

CREATE TABLE pilot_invitation_aircraft (
  invitation_id TEXT NOT NULL REFERENCES pilot_invitations(id) ON DELETE CASCADE,
  aircraft_id TEXT NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('view', 'edit')),
  created BIGINT NOT NULL,
  PRIMARY KEY (invitation_id, aircraft_id)
);
CREATE INDEX pilot_invitation_aircraft_aircraft ON pilot_invitation_aircraft (aircraft_id);
`;
export default sql;

// Route registry. Each module exports `routes: Route[]`; the dispatcher (api/_lib/app.ts) matches
// them in this order. Static imports keep every module in the Vercel function bundle.
import type { Route } from '../http.js';
import { routes as account } from './account.js';
import { routes as admin } from './admin.js';
import { routes as aircraft } from './aircraft.js';
import { routes as appLogin } from './appLogin.js';
import { routes as attachments } from './attachments.js';
import { routes as declarations } from './declarations.js';
import { routes as files } from './files.js';
import { routes as filing } from './filing.js';
import { routes as flights } from './flights.js';
import { routes as flightShares } from './flightShares.js';
import { routes as forms } from './forms.js';
import { routes as invitations } from './invitations.js';
import { routes as me } from './me.js';
import { routes as monitoring } from './monitoring.js';
import { routes as notams } from './notams.js';
import { routes as operators } from './operators.js';
import { routes as passengers } from './passengers.js';
import { routes as ref } from './ref.js';
import { routes as session } from './session.js';
import { routes as shares } from './shares.js';
import { routes as waypoints } from './waypoints.js';
import { routes as weather } from './weather.js';
import { routes as weatherGrid } from './weatherGrid.js';

export const ROUTES: Route[] = [
  ...session,
  ...appLogin,
  ...me,
  ...account,
  ...aircraft,
  ...attachments,
  ...files,
  ...shares,
  ...invitations,
  ...passengers,
  ...waypoints,
  ...flights,
  ...flightShares,
  ...ref,
  ...weather,
  ...weatherGrid,
  ...notams,
  ...filing,
  ...forms,
  ...operators,
  ...declarations,
  ...admin,
  ...monitoring,
];

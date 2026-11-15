// Router. Routes:
//   /                              lobby (flights)
//   /flights/new                   creates a flight, then → /flights/:id
//   /flights/:id                   flight editor (map)
//   /flights/:id/export/:kind      print-ready export (kind: navlog | form731 | gendec | fpl | wbperf | briefing; /wb and /performance redirect to wbperf)
//   /profile  /hangar  /hangar/:id  /operators  /operators/:id  /passengers  /waypoints
//   /admin                         every pilot (ADMIN_EMAILS only)
//   /sign/:token                   Form 731 signing page for a passenger (no sign-in)
//   /privacy  /terms               privacy policy, terms of service (no sign-in)
// v2 links (/#/f/<id>) are redirected to /flights/<id>.
import { Loading } from './Loading';
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AuthGate } from './AuthGate';
import { ErrorBoundary } from './ErrorBoundary';
import { ToastProvider } from './toast';
import { useSession } from './session';
import { profileMissing } from '../shared';
import { LobbyPage } from '../features/lobby';
import { NewFlightPage } from '../features/lobby/NewFlightPage';
import { ProfilePage } from '../features/profile';
import { HangarPage, AircraftPage } from '../features/hangar';
import { PassengersPage } from '../features/passengers';

// The map (MapLibre) and the export sheets are loaded on demand, so the lobby and lists load fast.
const EditorPage = lazy(() => import('../features/editor').then((m) => ({ default: m.EditorPage })));
const ExportPage = lazy(() => import('../features/exports').then((m) => ({ default: m.ExportPage })));
// The Form 731 signing page: public (no sign-in), outside the AuthGate.
const SignPage = lazy(() => import('../features/sign/SignPage').then((m) => ({ default: m.SignPage })));
const OperatorsPage = lazy(() => import('../features/operators').then((m) => ({ default: m.OperatorsPage })));
const OperatorPage = lazy(() => import('../features/operators').then((m) => ({ default: m.OperatorPage })));
const AdminPage = lazy(() => import('../features/admin/AdminPage').then((m) => ({ default: m.AdminPage })));
const PrivacyPage = lazy(() => import('../features/legal').then((m) => ({ default: m.PrivacyPage })));
const TermsPage = lazy(() => import('../features/legal').then((m) => ({ default: m.TermsPage })));
const WaypointsPage = lazy(() => import('../features/waypoints').then((m) => ({ default: m.WaypointsPage })));

function LegacyHashRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    const m = /^#\/f\/([\w-]+)$/.exec(window.location.hash);
    if (m) navigate(`/flights/${m[1]}`, { replace: true });
    else if (window.location.hash === '#/new') navigate('/flights/new', { replace: true });
  }, [navigate]);
  return null;
}

/** First use: until name, phone and home aerodrome are set, the profile page (welcome mode) comes first. */
function Onboarding({ children }: { children: ReactNode }) {
  const { pilot } = useSession();
  const loc = useLocation();
  if (profileMissing(pilot).length && !loc.pathname.startsWith('/profile')) return <Navigate to="/profile?welcome=1" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <ToastProvider>
        <Routes>
        <Route path="/sign/:token" element={<Suspense fallback={<Loading screen />}><SignPage /></Suspense>} />
        <Route path="/privacy" element={<Suspense fallback={<Loading screen />}><PrivacyPage /></Suspense>} />
        <Route path="/terms" element={<Suspense fallback={<Loading screen />}><TermsPage /></Suspense>} />
        <Route path="*" element={
        <AuthGate>
          <LegacyHashRedirect />
          <Onboarding>
            <Suspense fallback={<Loading screen />}>
            <Routes>
              <Route path="/" element={<LobbyPage />} />
              <Route path="/flights/new" element={<NewFlightPage />} />
              <Route path="/flights/:id" element={<EditorPage />} />
              <Route path="/flights/:id/export/:kind" element={<ExportPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/hangar" element={<HangarPage />} />
              <Route path="/hangar/:id" element={<AircraftPage />} />
              <Route path="/operators" element={<OperatorsPage />} />
              <Route path="/operators/:id" element={<OperatorPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/passengers" element={<PassengersPage />} />
              <Route path="/waypoints" element={<WaypointsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
          </Onboarding>
        </AuthGate>
        } />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
    </ErrorBoundary>
  );
}

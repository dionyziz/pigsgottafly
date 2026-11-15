// Router. Routes:
//   /                              lobby (flights)
//   /flights/new                   creates a flight, then → /flights/:id
//   /flights/:id                   flight editor (map)
//   /flights/:id/export/:kind      print-ready export (kind: navlog | form731 | gendec | fpl | wb | performance)
//   /profile  /hangar  /hangar/:id  /passengers  /waypoints
// v2 links (/#/f/<id>) are redirected to /flights/<id>.
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
        <AuthGate>
          <LegacyHashRedirect />
          <Onboarding>
            <Suspense fallback={<div className="loading-screen">Loading…</div>}>
            <Routes>
              <Route path="/" element={<LobbyPage />} />
              <Route path="/flights/new" element={<NewFlightPage />} />
              <Route path="/flights/:id" element={<EditorPage />} />
              <Route path="/flights/:id/export/:kind" element={<ExportPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/hangar" element={<HangarPage />} />
              <Route path="/hangar/:id" element={<AircraftPage />} />
              <Route path="/passengers" element={<PassengersPage />} />
              <Route path="/waypoints" element={<WaypointsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
          </Onboarding>
        </AuthGate>
      </ToastProvider>
    </BrowserRouter>
    </ErrorBoundary>
  );
}

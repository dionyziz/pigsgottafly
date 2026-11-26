// The /admin pages are for ADMIN_EMAILS only. v2 links (/#/f/<id>) still work (LegacyHashRedirect).
import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router';

import { SubscriptionPage } from '../features/billing/SubscriptionPage';
import { AircraftPage, HangarPage } from '../features/hangar';
import { LobbyPage } from '../features/lobby';
import { NewFlightPage } from '../features/lobby/NewFlightPage';
import { PassengersPage } from '../features/passengers';
import { ProfilePage } from '../features/profile';
import { Loading } from '../ui';
import { AboutPage } from './AboutPage';
import { AiracWatch } from './AiracWatch';
import { AuthGate } from './AuthGate';
import { ErrorBoundary } from './ErrorBoundary';
import { RouteTitle } from './title';
import { ToastProvider } from './toast';

// The map (MapLibre) and the export sheets are loaded on demand, so the lobby and lists load fast.
// The map editor and the exports are the big chunks: fetched as soon as the app is idle after it
// starts, so opening a flight or an export never waits for code.
const loadEditor = () => import('../features/editor');
const loadExports = () => import('../features/exports');
const EditorPage = lazy(() => loadEditor().then((m) => ({ default: m.EditorPage })));
const ExportPage = lazy(() => loadExports().then((m) => ({ default: m.ExportPage })));
if (typeof window !== 'undefined') {
  const warm = () => {
    void loadEditor().catch(() => undefined);
    void loadExports().catch(() => undefined);
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(warm);
  else setTimeout(warm, 1500);
}
const SignPage = lazy(() => import('../features/sign/SignPage').then((m) => ({ default: m.SignPage })));
const OperatorsPage = lazy(() => import('../features/operators').then((m) => ({ default: m.OperatorsPage })));
const OperatorPage = lazy(() => import('../features/operators').then((m) => ({ default: m.OperatorPage })));
const AdminPage = lazy(() => import('../features/admin/AdminPage').then((m) => ({ default: m.AdminPage })));
const PrivacyPage = lazy(() => import('../features/legal').then((m) => ({ default: m.PrivacyPage })));
const TermsPage = lazy(() => import('../features/legal').then((m) => ({ default: m.TermsPage })));
const SupportPage = lazy(() => import('../features/legal').then((m) => ({ default: m.SupportPage })));
const MailPage = lazy(() => import('../features/admin/AdminPage').then((m) => ({ default: m.MailPage })));
const ErrorsPage = lazy(() => import('../features/admin/ErrorsPage').then((m) => ({ default: m.ErrorsPage })));
const LicensesPage = lazy(() => import('./LicensesPage').then((m) => ({ default: m.LicensesPage })));
const WaypointsPage = lazy(() => import('../features/waypoints').then((m) => ({ default: m.WaypointsPage })));

function LegacyHashRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    const m = /^#\/f\/([\w-]+)$/.exec(window.location.hash);
    if (m) void navigate(`/flights/${m[1]}`, { replace: true });
    else if (window.location.hash === '#/new') void navigate('/flights/new', { replace: true });
  }, [navigate]);
  return null;
}

export function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <AiracWatch />
          <RouteTitle />
          <Routes>
            <Route
              path="/sign/:token"
              element={
                <Suspense fallback={<Loading variant="screen" />}>
                  <SignPage />
                </Suspense>
              }
            />
            <Route
              path="/privacy"
              element={
                <Suspense fallback={<Loading variant="screen" />}>
                  <PrivacyPage />
                </Suspense>
              }
            />
            <Route
              path="/terms"
              element={
                <Suspense fallback={<Loading variant="screen" />}>
                  <TermsPage />
                </Suspense>
              }
            />
            <Route
              path="/support"
              element={
                <Suspense fallback={<Loading variant="screen" />}>
                  <SupportPage />
                </Suspense>
              }
            />
            <Route
              path="*"
              element={
                <AuthGate>
                  <LegacyHashRedirect />
                  <Suspense fallback={<Loading variant="screen" />}>
                    <Routes>
                      <Route path="/" element={<LobbyPage />} />
                      <Route path="/flights/new" element={<NewFlightPage />} />
                      <Route path="/flights/:id" element={<EditorPage />} />
                      <Route path="/flights/:id/export/:kind" element={<ExportPage />} />
                      <Route path="/profile" element={<ProfilePage />} />
                      <Route path="/subscription" element={<SubscriptionPage />} />
                      <Route path="/hangar" element={<HangarPage />} />
                      <Route path="/hangar/:id" element={<AircraftPage />} />
                      <Route path="/operators" element={<OperatorsPage />} />
                      <Route path="/operators/:id" element={<OperatorPage />} />
                      <Route path="/admin" element={<AdminPage />} />
                      <Route path="/admin/errors" element={<ErrorsPage />} />
                      <Route path="/admin/mail" element={<MailPage />} />
                      <Route path="/passengers" element={<PassengersPage />} />
                      <Route path="/waypoints" element={<WaypointsPage />} />
                      <Route path="/about" element={<AboutPage />} />
                      <Route path="/about/licenses" element={<LicensesPage />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </Suspense>
                </AuthGate>
              }
            />
          </Routes>
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

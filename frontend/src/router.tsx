import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Loading } from './components/ui';
import { useAuth } from './providers/AuthProvider';

import { LoginPage } from './pages/LoginPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { DashboardPage } from './pages/DashboardPage';
import { CalendarPage } from './pages/CalendarPage';
import { PlansPage } from './pages/PlansPage';
import { PlanDetailPage } from './pages/PlanDetailPage';
import { SongsPage } from './pages/SongsPage';
import { SongDetailPage } from './pages/SongDetailPage';
import { TeamsPage } from './pages/TeamsPage';
import { PeoplePage } from './pages/PeoplePage';
import { MySchedulePage } from './pages/MySchedulePage';
import { SettingsPage } from './pages/SettingsPage';
import { ImportsPage } from './pages/ImportsPage';

/**
 * Gate for every authenticated route. Anyone signed in but not yet in an
 * organization is sent to onboarding rather than an empty dashboard.
 */
const RequireAuth = () => {
  const { session, user, organizationId, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading label="Signing you in…" />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user && !organizationId && location.pathname !== '/welcome') {
    return <Navigate to="/welcome" replace />;
  }
  return <Outlet />;
};

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/welcome', element: <OnboardingPage /> },
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <DashboardPage /> },
          { path: '/calendar', element: <CalendarPage /> },
          { path: '/plans', element: <PlansPage /> },
          { path: '/plans/:planId', element: <PlanDetailPage /> },
          { path: '/songs', element: <SongsPage /> },
          { path: '/songs/:songId', element: <SongDetailPage /> },
          { path: '/teams', element: <TeamsPage /> },
          { path: '/people', element: <PeoplePage /> },
          { path: '/my-schedule', element: <MySchedulePage /> },
          { path: '/settings', element: <SettingsPage /> },
          { path: '/imports', element: <ImportsPage /> },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);

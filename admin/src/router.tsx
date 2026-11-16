import { createBrowserRouter } from 'react-router-dom';
import { AuthGate } from './components/AuthGate';
import { AdminLayout } from './components/AdminLayout';
import { RouteErrorPage, NotFoundPage } from './pages/RouteErrorPage';
import { OverviewPage } from './pages/OverviewPage';
import { ChurchesPage } from './pages/ChurchesPage';
import { ChurchDetailPage } from './pages/ChurchDetailPage';
import { ApplicationsPage } from './pages/ApplicationsPage';
import { ApplicationDetailPage } from './pages/ApplicationDetailPage';
import { ActivityPage } from './pages/ActivityPage';
import { SettingsPage } from './pages/SettingsPage';

/**
 * Every route sits behind the gate, which shows sign-in, two-factor or
 * "not authorized" in place until the session is a super admin at `aal2`.
 * The URL is kept meanwhile, so an emailed /applications/:id link lands on
 * that application after signing in.
 */
export const router = createBrowserRouter([
  {
    element: <AuthGate />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          { index: true, element: <OverviewPage /> },
          { path: 'churches', element: <ChurchesPage /> },
          { path: 'churches/:id', element: <ChurchDetailPage /> },
          { path: 'applications', element: <ApplicationsPage /> },
          { path: 'applications/:id', element: <ApplicationDetailPage /> },
          { path: 'activity', element: <ActivityPage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);

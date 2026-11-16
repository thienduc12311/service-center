import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { ApiError } from '@service-center/shared';
import { AdminAuthProvider } from './providers/AdminAuthProvider';
import { reportAccessProblem } from './lib/access-events';
import { applyDesignTokens } from './lib/design-tokens';
import { router } from './router';
import './index.css';

applyDesignTokens();

const queryClient = new QueryClient({
  // A refusal from any call can send the admin back to two-factor login or out.
  queryCache: new QueryCache({ onError: reportAccessProblem }),
  mutationCache: new MutationCache({ onError: reportAccessProblem }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Auth, permission and validation failures never succeed on retry.
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AdminAuthProvider>
        <RouterProvider router={router} />
      </AdminAuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);

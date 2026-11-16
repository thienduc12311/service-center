import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom';
import { buttonClasses, EmptyState } from '../components/ui';

/** A render error anywhere under the router. */
export const RouteErrorPage = () => {
  const error = useRouteError();
  const description = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : 'The page hit an unexpected error. Reload to try again.';
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <EmptyState
        icon="alert"
        title="Something went wrong"
        description={description}
        action={
          <button type="button" className={buttonClasses('secondary')} onClick={() => window.location.reload()}>
            Reload
          </button>
        }
      />
    </main>
  );
};

export const NotFoundPage = () => (
  <EmptyState
    icon="search"
    title="Page not found"
    description="There is nothing at this address."
    action={
      <Link to="/" className={buttonClasses('secondary')}>
        Go to Overview
      </Link>
    }
  />
);

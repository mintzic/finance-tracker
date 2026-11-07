import { createHashRouter, RouterProvider, useRouteError, isRouteErrorResponse, Link } from 'react-router';
import Home, { loader as homeLoader, action as homeAction } from './routes/home';
import Settings, { loader as settingsLoader, action as settingsAction } from './routes/settings';
import { errorMessage } from './lib/bridge';
import './App.css';

function RouteError() {
  const error = useRouteError();
  return (
    <main className="profile-page">
      <h1>Unable to open Folio</h1>
      <p className="error" role="alert">
        {isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : errorMessage(error)}
      </p>
      <Link to="/settings">Open settings</Link>
      {' · '}
      <button onClick={() => window.location.reload()}>Try again</button>
    </main>
  );
}
const router = createHashRouter([
  { path: '/', Component: Home, loader: homeLoader, action: homeAction, ErrorBoundary: RouteError },
  { path: '/settings', Component: Settings, loader: settingsLoader, action: settingsAction, ErrorBoundary: RouteError },
]);
export default function App() {
  return <RouterProvider router={router} />;
}

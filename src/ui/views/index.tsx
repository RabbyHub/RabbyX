import React, { lazy, Suspense } from 'react';
import { HashRouter as Router, Route } from 'react-router-dom';
import { WalletProvider } from 'ui/utils';
import { PrivateRoute } from 'ui/component';
import Dashboard from './Dashboard';
import Unlock from './Unlock';
import SortHat from './SortHat';
const AsyncMainRoute = lazy(() => import('./MainRoute'));

export default function Views() {
  return (
    <Router>
      <Route exact path="/">
        <SortHat />
      </Route>

      <Route exact path="/unlock">
        <Unlock />
      </Route>

      <PrivateRoute exact path="/dashboard">
        <Dashboard />
      </PrivateRoute>
      <Suspense fallback={null}>
        <AsyncMainRoute />
      </Suspense>
    </Router>
  );
}

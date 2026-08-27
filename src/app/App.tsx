import { lazy, Suspense, useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, CssBaseline, LinearProgress, ThemeProvider } from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { ruRU } from '@mui/x-date-pickers/locales';
import { ru } from 'date-fns/locale';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ensureSeedData } from '../infrastructure/database/seed';
import { appTheme } from '../shared/design-system/theme';
import { AppShell } from '../widgets/app-shell/AppShell';
import { AppErrorBoundary } from './AppErrorBoundary';
import { tokens } from '../shared/design-system/tokens';
import { requestPersistentStorage } from '../shared/lib/storage';

const BoardPage = lazy(() => import('../pages/board/BoardPage').then((module) => ({ default: module.BoardPage })));
const CallsPage = lazy(() => import('../pages/calls/CallsPage').then((module) => ({ default: module.CallsPage })));
const ContactsPage = lazy(() => import('../pages/contacts/ContactsPage').then((module) => ({ default: module.ContactsPage })));
const ImportPage = lazy(() => import('../pages/import/ImportPage').then((module) => ({ default: module.ImportPage })));
const ReportsPage = lazy(() => import('../pages/reports/ReportsPage').then((module) => ({ default: module.ReportsPage })));
const SettingsPage = lazy(() => import('../pages/settings/SettingsPage').then((module) => ({ default: module.SettingsPage })));

function PageLoader() {
  return <Box sx={{ minHeight: tokens.size.appLoader, display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>;
}

export function App() {
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState('');

  useEffect(() => {
    async function initialize() {
      try {
        await ensureSeedData();
        await requestPersistentStorage();
        setReady(true);
      } catch {
        setStartupError('Не удалось открыть локальную базу данных. Перезапустите приложение.');
      }
    }
    void initialize();
  }, []);

  return (
    <ThemeProvider theme={appTheme}>
      <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={ru} localeText={ruRU.components.MuiLocalizationProvider.defaultProps.localeText}>
        <CssBaseline />
        {startupError ? <Box sx={{ p: 4, maxWidth: tokens.size.startupContent }}><Alert severity="error" action={<Button color="inherit" onClick={() => window.location.reload()}>Повторить</Button>}>{startupError}</Alert></Box> : !ready ? <LinearProgress /> : (
          <AppErrorBoundary>
            <HashRouter>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route element={<AppShell />}>
                    <Route path="/board" element={<BoardPage />} />
                    <Route path="/calls" element={<CallsPage />} />
                    <Route path="/contacts" element={<ContactsPage />} />
                    <Route path="/import" element={<ImportPage />} />
                    <Route path="/reports" element={<ReportsPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="*" element={<Navigate to="/board" replace />} />
                  </Route>
                </Routes>
              </Suspense>
            </HashRouter>
          </AppErrorBoundary>
        )}
      </LocalizationProvider>
    </ThemeProvider>
  );
}

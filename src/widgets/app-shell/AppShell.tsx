import { useEffect, useMemo, useState } from 'react';
import type { SyntheticEvent } from 'react';
import {
  AssessmentOutlined,
  CalendarTodayOutlined,
  DashboardOutlined,
  FileUploadOutlined,
  GroupsOutlined,
  NotificationsNoneOutlined,
  Search,
  SettingsOutlined,
} from '@mui/icons-material';
import {
  AppBar,
  Badge,
  Box,
  Button,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import { useLiveQuery } from 'dexie-react-hooks';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { db } from '../../infrastructure/database/database';
import { tokens } from '../../shared/design-system/tokens';
import { isOverdue } from '../../shared/lib/dates';
import type { CallTask } from '../../shared/model/domain';
import { exportBackup } from '../../features/backup/model/backup-service';
import { useClock } from '../../shared/lib/useClock';
import { hasPersistentStorage } from '../../shared/lib/storage';
import { Toast } from '../../shared/ui/Toast';

// Уведомления о состоянии висят дольше обычных: в них есть кнопка действия,
// и на её прочтение нужно время.
const STATE_NOTICE_MS = 12_000;

const navigation = [
  { to: '/board', label: 'Канбан', icon: DashboardOutlined },
  { to: '/calls', label: 'Звонки', icon: CalendarTodayOutlined },
  { to: '/contacts', label: 'Все контакты', icon: GroupsOutlined },
  { to: '/import', label: 'Импорт', icon: FileUploadOutlined },
  { to: '/reports', label: 'Отчёты', icon: AssessmentOutlined },
  { to: '/settings', label: 'Настройки', icon: SettingsOutlined },
];

const titles = Object.fromEntries(navigation.map((item) => [item.to, item.label]));
const EMPTY_CALLS: CallTask[] = [];

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const calls = useLiveQuery(() => db.calls.filter((call) => !call.completedAt).toArray(), []) ?? EMPTY_CALLS;
  const contactsCount = useLiveQuery(() => db.contacts.count(), []) ?? 0;
  const preferences = useLiveQuery(() => db.preferences.get('preferences'), []);
  const [storagePersistent, setStoragePersistent] = useState(true);
  const [shellMessage, setShellMessage] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  // Состояние закрытых уведомлений живёт в AppShell: он остаётся смонтированным
  // при навигации (страницы меняются внутри Outlet), поэтому закрытый тост
  // не появляется заново при переходе между разделами.
  const [storageNoticeClosed, setStorageNoticeClosed] = useState(false);
  const [dismissedCallsCount, setDismissedCallsCount] = useState(0);
  const clock = useClock();
  const notifyBefore = preferences?.notifyMinutesBefore ?? 15;
  const overdueCount = useMemo(() => calls.filter((call) => isOverdue(call.dueAt, new Date(clock))).length, [calls, clock]);
  const notificationCount = useMemo(() => {
    const threshold = clock + notifyBefore * 60_000;
    return calls.filter((call) => new Date(call.dueAt).getTime() <= threshold).length;
  }, [calls, notifyBefore, clock]);
  const lastBackup = localStorage.getItem('last-external-backup');
  const backupDue = contactsCount > 0 && (!lastBackup || clock - new Date(lastBackup).getTime() > 7 * 86_400_000);
  const storageNotice = (!storagePersistent || backupDue) && contactsCount > 0 && !storageNoticeClosed;
  const callsNotice = notificationCount > dismissedCallsCount;

  useEffect(() => {
    void hasPersistentStorage().then(setStoragePersistent).catch(() => setStoragePersistent(false));
  }, []);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (event.ctrlKey && event.key.toLowerCase() === 'i') { event.preventDefault(); void navigate('/import'); }
      if (event.ctrlKey && event.key.toLowerCase() === 'k') { event.preventDefault(); document.getElementById('global-search')?.focus(); }
    }
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [navigate]);

  function submitSearch(event: SyntheticEvent) {
    event.preventDefault();
    void navigate(`/contacts?q=${encodeURIComponent(search.trim())}`);
  }

  async function downloadBackup() {
    setBackupBusy(true); setShellMessage('');
    try { await exportBackup(); setStorageNoticeClosed(true); setShellMessage('Резервная копия скачана.'); }
    catch { setShellMessage('Не удалось скачать резервную копию.'); }
    finally { setBackupBusy(false); }
  }

  return (
    <Box sx={{ display: 'flex', minHeight: tokens.size.viewport }}>
      <Box component="aside" sx={{ width: { xs: tokens.size.navCompactWidth, md: tokens.size.navWidth }, p: 2, bgcolor: 'background.paper', borderRight: 1, borderColor: 'divider', position: 'fixed', inset: '0 auto 0 0', zIndex: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, height: tokens.size.topbarHeight - 16 }}>
          <Box sx={{ width: tokens.size.logo, height: tokens.size.logo, borderRadius: tokens.radiusCss.md, bgcolor: 'primary.main', color: 'primary.contrastText', display: 'grid', placeItems: 'center', fontWeight: tokens.fontWeight.logo }}>К</Box>
          <Box sx={{ display: { xs: 'none', md: 'block' } }}>
            <Typography variant="subtitle1">Контакты</Typography>
            <Typography variant="body2" color="text.secondary">Рабочая доска</Typography>
          </Box>
        </Box>
        <List sx={{ display: 'grid', gap: 0.5, mt: 2 }}>
          {navigation.map(({ to, label, icon: Icon }) => (
            <ListItem key={to} disablePadding>
            <ListItemButton aria-label={label} component={NavLink} to={to} sx={{ borderRadius: tokens.radiusCss.md, minHeight: tokens.size.navItem, color: 'text.secondary', '&.active': { bgcolor: 'primary.light', color: 'primary.dark' } }}>
              <ListItemIcon sx={{ minWidth: tokens.size.navIconSlot, color: 'inherit' }}><Icon fontSize="small" /></ListItemIcon>
              <ListItemText sx={{ display: { xs: 'none', md: 'block' } }} primary={label} slotProps={{ primary: { variant: 'body2', fontWeight: tokens.fontWeight.navigation } }} />
              {to === '/calls' && notificationCount > 0 && <Badge badgeContent={notificationCount} color="error" />}
            </ListItemButton>
            </ListItem>
          ))}
        </List>
        <Box sx={{ display: { xs: 'none', md: 'block' }, position: 'absolute', bottom: tokens.inset.navigationFooter, left: tokens.inset.navigationFooter, right: tokens.inset.navigationFooter, p: 1.5, borderRadius: tokens.radiusCss.md, bgcolor: 'background.default' }}>
          <Typography variant="body2" fontWeight={tokens.fontWeight.semibold}>Данные на этом устройстве</Typography>
          <Typography variant="body2" color="text.secondary">Работает без интернета</Typography>
        </Box>
      </Box>
      <Box sx={{ ml: { xs: `${tokens.size.navCompactWidth}px`, md: `${tokens.size.navWidth}px` }, flex: 1, minWidth: tokens.size.zero }}>
        <AppBar position="sticky" color="transparent" sx={{ boxShadow: 'none', borderBottom: 1, borderColor: 'divider', backdropFilter: tokens.effect.glassBlur, bgcolor: tokens.color.surfaceGlass }}>
          <Toolbar sx={{ height: tokens.size.topbarHeight, gap: 2 }}>
            <Typography variant="h2" sx={{ display: { xs: 'none', lg: 'block' }, minWidth: tokens.size.titleSlot }}>{titles[location.pathname] ?? 'Контакты'}</Typography>
            <Box component="form" onSubmit={submitSearch} sx={{ flex: 1, maxWidth: tokens.size.searchGlobal }}>
              <TextField id="global-search" fullWidth placeholder="Найти контакт...  Ctrl K" value={search} onChange={(event) => setSearch(event.target.value)} slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }, htmlInput: { 'aria-label': 'Глобальный поиск контактов' } }} />
            </Box>
            <Tooltip title={overdueCount ? `Просрочено звонков: ${overdueCount}` : 'Нет просроченных звонков'}>
              <IconButton aria-label="Уведомления" onClick={() => { void navigate('/calls'); }}><Badge badgeContent={notificationCount} color="error"><NotificationsNoneOutlined /></Badge></IconButton>
            </Tooltip>
            <Button sx={{ display: { xs: 'none', lg: 'inline-flex' } }} variant="contained" startIcon={<FileUploadOutlined />} onClick={() => { void navigate('/import'); }}>Импортировать Excel</Button>
          </Toolbar>
        </AppBar>
        <Box component="main">
          <Outlet />
        </Box>
      </Box>
      {/* Тосты показываются по одному: у Snackbar общий якорь, и одновременные уведомления перекрыли бы друг друга.
          Уведомления о состоянии тоже скрываются сами: висящий тост занимал бы угол и перекрывал сообщения о действиях.
          Закрытие запоминается на сессию, предупреждение вернётся при следующем запуске. */}
      {shellMessage ? (
        <Toast open severity={shellMessage.startsWith('Не удалось') ? 'error' : 'success'} message={shellMessage} onClose={() => setShellMessage('')} />
      ) : storageNotice ? (
        <Toast
          open
          severity="warning"
          autoHideDuration={STATE_NOTICE_MS}
          message={!storagePersistent ? 'Браузер может очистить данные приложения' : 'Резервная копия старше недели'}
          onClose={() => setStorageNoticeClosed(true)}
          action={<Button size="small" color="inherit" disabled={backupBusy} onClick={() => void downloadBackup()}>{backupBusy ? 'Скачивание…' : 'Скачать копию'}</Button>}
        />
      ) : callsNotice ? (
        <Toast
          open
          severity={overdueCount > 0 ? 'error' : 'info'}
          autoHideDuration={STATE_NOTICE_MS}
          message={overdueCount > 0 ? `Просрочено звонков: ${overdueCount}` : `Скоро звонков: ${notificationCount}`}
          onClose={() => setDismissedCallsCount(notificationCount)}
          action={<Button size="small" color="inherit" onClick={() => { void navigate('/calls'); }}>Открыть</Button>}
        />
      ) : null}
    </Box>
  );
}

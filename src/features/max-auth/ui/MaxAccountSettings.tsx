import { useCallback, useEffect, useRef, useState } from 'react';
import { QrCode2 } from '@mui/icons-material';
import { Alert, Box, Button, CircularProgress, LinearProgress, Stack, TextField, Typography } from '@mui/material';
import {
  describeBridgeError,
  cancelAuth,
  fetchAuthState,
  logoutMax,
  qrImageSource,
  startAuth,
  submitAuthPassword,
  type MaxAuthSnapshot,
} from '../../max-bridge/model/max-bridge';
import { tokens } from '../../../shared/design-system/tokens';

const POLL_MS = 2_000;

/**
 * Вынесено из `MaxAccountSettings`: обработка отсутствующего SVG добавляла
 * ветвления и выводила основной компонент за лимит цикломатической сложности.
 */
function QrPanel({ qrSvg, qrLink }: { qrSvg?: string; qrLink?: string }) {
  if (qrSvg !== undefined && qrSvg !== '') {
    return (
      <Box
        component="img"
        src={qrImageSource(qrSvg)}
        alt="QR-код для входа в MAX"
        sx={{ width: tokens.size.qrCode, height: tokens.size.qrCode, p: 1, border: 1, borderColor: 'divider', borderRadius: tokens.radiusCss.md, bgcolor: 'common.white' }}
      />
    );
  }
  const hint = qrLink !== undefined && qrLink !== '' ? qrLink : 'ссылка не получена, отмените вход и повторите';
  return <Alert severity="warning">Мост не смог нарисовать QR-код. Откройте эту ссылку в MAX вручную: {hint}</Alert>;
}

export function MaxAccountSettings() {
  const [snapshot, setSnapshot] = useState<MaxAuthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  // Refs, а не состояние: guard от наложения опросов и от записи состояния
  // после размонтирования не должен менять идентичность `refresh`.
  const inFlight = useRef(false);
  const alive = useRef(true);

  const refresh = useCallback(async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await fetchAuthState();
      if (alive.current) { setSnapshot(next); setError(''); }
    } catch (stateError) {
      if (!alive.current) return;
      setSnapshot(null);
      setError(describeBridgeError(stateError));
    } finally {
      inFlight.current = false;
      if (alive.current) setLoading(false);
    }
  }, []);

  // Первый запрос ставится в очередь, а не выполняется в теле эффекта: React не
  // получает каскад рендеров прямо на коммите, а повторное монтирование в
  // строгом режиме отменяет таймер и не отправляет второй запрос.
  useEffect(() => {
    alive.current = true;
    const timer = setTimeout(() => { void refresh(); });
    return () => { alive.current = false; clearTimeout(timer); };
  }, [refresh]);

  const state = snapshot?.state;
  // Опрос идёт только пока вход не завершён. Состояние `password` тоже входит
  // сюда: без опроса оператор не увидит, что мост принял пароль. На
  // `connected` и `error` опрос прекращается сам.
  const polling = state === 'connecting' || state === 'qr' || state === 'password';

  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => { void refresh(); }, POLL_MS);
    return () => { clearInterval(timer); };
  }, [polling, refresh]);

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); }
    catch (actionError) {
      setError(describeBridgeError(actionError));
    }
    finally { setBusy(false); await refresh(); }
  }

  return (
    <Stack gap={2}>
      <Box>
        <Typography variant="h2">MAX аккаунт</Typography>
        <Typography variant="body2" color="text.secondary">Вход по QR-коду нужен, чтобы отправлять КП прямо из карточки контакта.</Typography>
      </Box>
      {busy && <LinearProgress aria-label="Выполняем запрос к MAX" />}
      {error && <Alert severity="error" action={<Button color="inherit" disabled={busy} onClick={() => void refresh()}>Повторить</Button>}>{error}</Alert>}
      {loading && <Box sx={{ py: 6, display: 'grid', placeItems: 'center' }}><CircularProgress aria-label="Проверяем подключение к MAX" /></Box>}
      {(state === 'idle' || state === 'stopped') && (
        <Alert severity="info" action={<Button color="inherit" disabled={busy} startIcon={<QrCode2 />} onClick={() => void run(startAuth)}>Войти в MAX</Button>}>
          Аккаунт MAX не подключён, отправка КП недоступна.
        </Alert>
      )}
      {state === 'error' && (
        <Alert severity="error" action={<Button color="inherit" disabled={busy} onClick={() => void run(startAuth)}>Войти заново</Button>}>
          {snapshot?.error ?? 'MAX сообщил об ошибке входа.'}
        </Alert>
      )}
      {state === 'connecting' && (
        <Stack direction="row" alignItems="center" flexWrap="wrap" gap={2}>
          <CircularProgress size={20} aria-label="Подключаемся к MAX" />
          <Typography sx={{ flex: 1 }}>Подключаемся к MAX, это занимает несколько секунд.</Typography>
          <Button disabled={busy} onClick={() => void run(cancelAuth)}>Отмена</Button>
        </Stack>
      )}
      {state === 'qr' && (
        <Stack gap={1.5} alignItems="flex-start">
          <Typography>Откройте MAX на телефоне, зайдите в настройки, раздел с устройствами, и отсканируйте код.</Typography>
          <QrPanel qrSvg={snapshot?.qrSvg} qrLink={snapshot?.qrLink} />
          <Button disabled={busy} onClick={() => void run(cancelAuth)}>Отмена</Button>
        </Stack>
      )}
      {state === 'password' && (
        <Stack gap={1.5} maxWidth={tokens.size.formNarrow}>
          <Alert severity="info">MAX запросил пароль двухфакторной проверки.</Alert>
          <TextField
            type="password"
            label="Пароль MAX"
            value={password}
            disabled={busy}
            autoComplete="off"
            onChange={(event) => setPassword(event.target.value)}
          />
          <Stack direction="row" gap={1}>
            <Button variant="contained" disabled={busy || password.trim() === ''} onClick={() => void run(async () => { await submitAuthPassword(password); setPassword(''); })}>Подтвердить</Button>
            <Button disabled={busy} onClick={() => void run(cancelAuth)}>Отмена</Button>
          </Stack>
        </Stack>
      )}
      {state === 'connected' && (
        <Stack direction="row" alignItems="center" flexWrap="wrap" gap={2}>
          <Alert severity="success" sx={{ flex: 1 }}>Подключён аккаунт MAX: {snapshot?.account?.name ?? 'имя не передано'}</Alert>
          <Button color="error" variant="outlined" disabled={busy} onClick={() => void run(logoutMax)}>Выйти</Button>
        </Stack>
      )}
    </Stack>
  );
}

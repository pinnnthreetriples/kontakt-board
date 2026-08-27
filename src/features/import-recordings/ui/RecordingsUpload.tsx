import { useMemo, useState } from 'react';
import { CheckCircleOutline, GraphicEqOutlined } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { tokens } from '../../../shared/design-system/tokens';
import { formatDateTime } from '../../../shared/lib/dates';
import { formatPhone } from '../../../shared/lib/phone';
import { MAX_RECORDINGS_PER_UPLOAD, matchRecordings, saveRecordings, type RecordingMatch, type RecordingStatus } from '../model/recordings-service';

const PREVIEW_LIMIT = 20;
const STATUS_COLORS: Record<RecordingStatus, 'success' | 'warning' | 'default' | 'error'> = {
  matched: 'success', unmatched: 'warning', duplicate: 'default', error: 'error',
};

export function RecordingsUpload() {
  const [matches, setMatches] = useState<RecordingMatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attached, setAttached] = useState<number | null>(null);
  const counts = useMemo(() => ({
    matched: matches.filter((match) => match.status === 'matched').length,
    unmatched: matches.filter((match) => match.status === 'unmatched').length,
    duplicate: matches.filter((match) => match.status === 'duplicate').length,
    error: matches.filter((match) => match.status === 'error').length,
  }), [matches]);

  async function selectFiles(files: FileList | null) {
    setError(''); setAttached(null);
    const selected = [...files ?? []];
    if (selected.length === 0) return;
    setBusy(true);
    try { setMatches(await matchRecordings(selected)); }
    catch (caught) { setMatches([]); setError(caught instanceof Error ? caught.message : 'Не удалось прочитать файлы'); }
    finally { setBusy(false); }
  }

  async function attach() {
    setBusy(true); setError('');
    try { setAttached(await saveRecordings(matches)); setMatches([]); }
    catch { setError('Записи не прикреплены. Проверьте файлы и повторите.'); }
    finally { setBusy(false); }
  }

  function reset() {
    setMatches([]); setError(''); setAttached(null);
  }

  if (attached !== null) return (
    <Paper sx={{ p: { xs: 3, sm: 5 }, textAlign: 'center', border: 1, borderColor: 'divider', borderRadius: tokens.radiusCss.lg }}>
      <CheckCircleOutline color="success" sx={{ fontSize: tokens.size.successIcon }} />
      <Typography variant="h2" mt={1.5}>Записи прикреплены</Typography>
      <Typography color="text.secondary" mt={1}>Добавлено записей: {attached}. Они доступны в карточках заявок.</Typography>
      <Button variant="outlined" onClick={reset} sx={{ mt: 3 }}>Загрузить ещё записи</Button>
    </Paper>
  );

  return (
    <Paper sx={{ p: { xs: 2, sm: 3 }, border: 1, borderColor: 'divider', borderRadius: tokens.radiusCss.lg }}>
      <Stack direction="row" alignItems="center" gap={1.5}>
        <GraphicEqOutlined color="primary" />
        <Box>
          <Typography variant="h2">Записи разговоров</Typography>
          <Typography variant="body2" color="text.secondary">Файлы привязываются к заявкам по номеру телефона в названии</Typography>
        </Box>
      </Stack>
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      {matches.length === 0 ? (
        <Stack direction="row" flexWrap="wrap" gap={1} mt={2.5} alignItems="center">
          <Button component="label" variant="contained" disabled={busy}>
            Выбрать файлы
            <Box component="input" hidden type="file" multiple accept="audio/*,.mp3,.wav,.ogg,.m4a" onChange={(event) => { void selectFiles(event.target.files); }} />
          </Button>
          <Button component="label" variant="outlined" disabled={busy}>
            Выбрать папку
            <Box
              component="input"
              hidden
              type="file"
              multiple
              ref={(node: HTMLInputElement | null) => { if (node) node.webkitdirectory = true; }}
              onChange={(event) => { void selectFiles(event.target.files); }}
            />
          </Button>
          {busy && <CircularProgress aria-label="Чтение файлов" />}
          <Typography variant="body2" color="text.secondary">MP3, WAV, M4A, до 25 МБ и до {MAX_RECORDINGS_PER_UPLOAD} файлов за раз</Typography>
        </Stack>
      ) : (
        <>
          <Stack direction="row" gap={1} flexWrap="wrap" my={2}>
            <Chip color="success" label={`Прикрепим: ${counts.matched}`} />
            <Chip color="warning" label={`Без заявки: ${counts.unmatched}`} />
            <Chip label={`Уже загружены: ${counts.duplicate}`} />
            <Chip color="error" label={`Ошибки: ${counts.error}`} />
          </Stack>
          <TableContainer>
            <Table size="small">
              <TableHead><TableRow><TableCell>Файл</TableCell><TableCell>Телефон</TableCell><TableCell>Заявка</TableCell><TableCell>Время звонка</TableCell><TableCell>Статус</TableCell></TableRow></TableHead>
              <TableBody>
                {matches.slice(0, PREVIEW_LIMIT).map((match, index) => (
                  <TableRow key={`${match.fileName}-${index}`}>
                    <TableCell sx={{ wordBreak: 'break-all' }}>{match.fileName}</TableCell>
                    <TableCell>{match.phone ? formatPhone(match.phone) : '—'}</TableCell>
                    <TableCell>{match.leadTitle ?? '—'}</TableCell>
                    <TableCell>{formatDateTime(match.recordedAt)}</TableCell>
                    <TableCell><Chip size="small" color={STATUS_COLORS[match.status]} label={match.error ?? 'Прикрепить'} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {matches.length > PREVIEW_LIMIT && <Typography variant="body2" color="text.secondary" mt={1.5}>Показаны первые {PREVIEW_LIMIT} файлов из {matches.length}</Typography>}
          <Stack direction="row" justifyContent="space-between" flexWrap="wrap" gap={1} mt={3}>
            <Button onClick={reset} disabled={busy}>Выбрать другие файлы</Button>
            <Button variant="contained" loading={busy} disabled={counts.matched === 0} onClick={() => void attach()}>
              {`Прикрепить ${counts.matched}`}
            </Button>
          </Stack>
        </>
      )}
    </Paper>
  );
}

import { useMemo, useRef, useState } from 'react';
import { ArrowBack, CheckCircleOutline, CloudUploadOutlined, DescriptionOutlined, WarningAmberOutlined } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useLiveQuery } from 'dexie-react-hooks';
import { suggestMapping } from '../../features/import-contacts/model/import-mapping';
import { buildPreview, commitImport, MAX_IMPORT_ROWS, parseWorkbook } from '../../features/import-contacts/model/import-service';
import { db } from '../../infrastructure/database/database';
import type { ImportColumnMapping, ImportPreviewRow, ParsedSheet } from '../../shared/model/domain';
import { exportBackup } from '../../features/backup/model/backup-service';
import { tokens } from '../../shared/design-system/tokens';

const FILE_LIMIT = 15 * 1024 * 1024;
const fields: Array<{ key: keyof ImportColumnMapping; label: string }> = [
  { key: 'organization', label: 'Организация' }, { key: 'taxId', label: 'ИНН' }, { key: 'personName', label: 'Контактное лицо' },
  { key: 'position', label: 'Должность' }, { key: 'phone', label: 'Основной телефон' }, { key: 'secondaryPhone', label: 'Доп. телефон' },
  { key: 'email', label: 'E-mail' }, { key: 'address', label: 'Адрес' }, { key: 'region', label: 'Регион' },
  { key: 'website', label: 'Сайт' }, { key: 'tags', label: 'Теги' }, { key: 'externalId', label: 'ID записи' },
  { key: 'result', label: 'Результат' }, { key: 'description', label: 'Описание / комментарий' }, { key: 'assignee', label: 'Ответственный' },
  { key: 'source', label: 'Источник' }, { key: 'createdAt', label: 'Дата заявки' }, { key: 'initialComment', label: 'Комментарий' },
];

export function ImportPage() {
  const fileInput = useRef<HTMLInputElement>(null);
  const stages = useLiveQuery(() => db.stages.filter((stage) => !stage.archived).sortBy('order'), []) ?? [];
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [mapping, setMapping] = useState<ImportColumnMapping>({});
  const [preview, setPreview] = useState<ImportPreviewRow[]>([]);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number; errors: number } | null>(null);
  const [importProgress, setImportProgress] = useState(0);
  const selectedSheet = sheets[sheetIndex];
  const counts = useMemo(() => ({
    create: preview.filter((row) => row.action === 'create').length,
    update: preview.filter((row) => row.action === 'update').length,
    skip: preview.filter((row) => row.action === 'skip').length,
    error: preview.filter((row) => row.action === 'error').length,
  }), [preview]);

  async function selectFile(selected: File) {
    setError('');
    if (selected.size > FILE_LIMIT) { setError('Файл больше 15 МБ. Разделите его на несколько частей.'); return; }
    if (!/\.xlsx$/i.test(selected.name)) { setError('Выберите файл Excel в формате XLSX.'); return; }
    setBusy(true);
    try {
      const parsed = await parseWorkbook(selected);
      const first = parsed[0];
      if (!first || first.rows.length === 0) throw new Error('В файле нет строк');
      if (first.rows.length > MAX_IMPORT_ROWS) throw new Error(`В файле больше ${MAX_IMPORT_ROWS.toLocaleString('ru-RU')} строк`);
      setFile(selected); setSheets(parsed); setSheetIndex(0); setMapping(suggestMapping(first.headers)); setStep(1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось прочитать файл');
    } finally { setBusy(false); }
  }

  function changeSheet(index: number) {
    setSheetIndex(index);
    const sheet = sheets[index];
    if (sheet) setMapping(suggestMapping(sheet.headers));
  }

  async function preparePreview() {
    if (!selectedSheet || (!mapping.phone && !mapping.externalId)) { setError('Укажите столбец с телефоном или ID записи.'); return; }
    setBusy(true); setError('');
    try { setPreview(await buildPreview(selectedSheet.rows, mapping)); setStep(2); }
    catch { setError('Не удалось подготовить предпросмотр.'); }
    finally { setBusy(false); }
  }

  async function runImport() {
    const firstStage = stages[0];
    if (!file) return;
    if (!firstStage) { setError('Нет активного этапа для новых карточек. Добавьте этап в настройках.'); return; }
    setBusy(true); setError('');
    try {
      if ((await db.contacts.count()) > 0) await exportBackup();
      setImportProgress(0);
      setResult(await commitImport(file.name, preview, mapping, firstStage.id, (completed, total) => setImportProgress(Math.round((completed / total) * 100)))); setStep(3);
    }
    catch { setError('Импорт отменён: данные не были записаны. Проверьте файл и повторите.'); }
    finally { setBusy(false); }
  }

  function reset() {
    setFile(null); setSheets([]); setPreview([]); setMapping({}); setResult(null); setImportProgress(0); setStep(0); setError('');
    if (fileInput.current) fileInput.current.value = '';
  }

  function downloadErrors() {
    const errors = preview.filter((row) => row.action === 'error').map(({ rowNumber, error: rowError, raw }) => ({ rowNumber, error: rowError, raw }));
    const url = URL.createObjectURL(new Blob([JSON.stringify(errors, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'import-errors.json'; anchor.click(); URL.revokeObjectURL(url);
  }

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: tokens.size.contentWide }}>
      <Stepper alternativeLabel activeStep={step} sx={{ mb: 3.5, '& .MuiStepLabel-label': { display: { xs: 'none', sm: 'block' } } }}><Step><StepLabel>Файл</StepLabel></Step><Step><StepLabel>Столбцы</StepLabel></Step><Step><StepLabel>Проверка</StepLabel></Step><Step><StepLabel>Готово</StepLabel></Step></Stepper>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {step === 0 && (
        <Paper sx={{ p: { xs: 3, sm: 8 }, border: '1px dashed', borderColor: 'primary.main', bgcolor: 'primary.light', textAlign: 'center', borderRadius: tokens.radiusCss.lg }}>
          {busy ? <CircularProgress aria-label="Чтение Excel-файла" /> : <><CloudUploadOutlined color="primary" sx={{ fontSize: tokens.size.uploadIcon }} /><Typography variant="h2" mt={1.5}>Выберите Excel-файл</Typography><Typography color="text.secondary" mt={1}>XLSX, до 15 МБ</Typography><Button component="label" variant="contained" sx={{ mt: 2.5 }}>Выбрать файл<Box component="input" ref={fileInput} hidden type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const selected = event.target.files?.[0]; if (selected) void selectFile(selected); }} /></Button></>}
        </Paper>
      )}
      {step === 1 && selectedSheet && (
        <Paper sx={{ p: { xs: 2, sm: 3 }, border: 1, borderColor: 'divider', borderRadius: tokens.radiusCss.lg }}>
          <Stack direction="row" alignItems="center" flexWrap="wrap" gap={1.5} mb={2.5}><DescriptionOutlined color="primary" /><Box><Typography variant="h2">{file?.name}</Typography><Typography variant="body2" color="text.secondary">{selectedSheet.rows.length} строк</Typography></Box><Select inputProps={{ 'aria-label': 'Лист Excel' }} size="small" value={sheetIndex} onChange={(event) => changeSheet(event.target.value)} sx={{ ml: { sm: 'auto' }, width: { xs: tokens.size.full, sm: 'auto' }, minWidth: { xs: tokens.size.zero, sm: tokens.size.selectMedium } }}>{sheets.map((sheet, index) => <MenuItem key={sheet.name} value={index}>{sheet.name}</MenuItem>)}</Select></Stack>
          <Alert severity="info" icon={<WarningAmberOutlined />} sx={{ mb: 2.5 }}>Проверьте телефон и ID записи. В Excel эти значения должны храниться как текст, иначе длинный ID может потерять цифры. Тот же телефон или ID из одного источника обновляет существующую заявку.</Alert>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5 }}>
            {fields.map(({ key, label }) => <Stack key={key} direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'stretch', sm: 'center' }} gap={2}><Typography variant="body2" sx={{ width: { xs: tokens.size.full, sm: tokens.size.importLabel } }}>{label}{key === 'phone' || key === 'externalId' ? ' *' : ''}</Typography><Select inputProps={{ 'aria-label': `Столбец для поля «${label}»` }} fullWidth size="small" displayEmpty value={mapping[key] ?? ''} onChange={(event) => setMapping({ ...mapping, [key]: event.target.value || undefined })}><MenuItem value=""><Box component="em">Не импортировать</Box></MenuItem>{selectedSheet.headers.map((header) => <MenuItem value={header} key={header}>{header}</MenuItem>)}</Select></Stack>)}
          </Box>
          <Stack direction="row" justifyContent="space-between" flexWrap="wrap" gap={1} mt={3}><Button startIcon={<ArrowBack />} onClick={reset}>Назад</Button><Button variant="contained" onClick={() => void preparePreview()} disabled={busy}>{busy ? 'Проверяю...' : 'Проверить данные'}</Button></Stack>
        </Paper>
      )}
      {step === 2 && (
        <Paper sx={{ p: { xs: 2, sm: 3 }, border: 1, borderColor: 'divider', borderRadius: tokens.radiusCss.lg }}>
          <Typography variant="h2">Проверьте перед импортом</Typography>
          <Stack direction="row" gap={1} my={2}><Chip color="success" label={`Новые: ${counts.create}`} /><Chip color="primary" label={`Обновятся: ${counts.update}`} /><Chip label={`Пропущены: ${counts.skip}`} /><Chip color="error" label={`Ошибки: ${counts.error}`} /></Stack>
          <TableContainer><Table size="small"><TableHead><TableRow><TableCell>Строка</TableCell><TableCell>Организация</TableCell><TableCell>Контакт</TableCell><TableCell>Телефон</TableCell><TableCell>Действие</TableCell></TableRow></TableHead><TableBody>{preview.slice(0, 20).map((row) => <TableRow key={row.rowNumber}><TableCell>{row.rowNumber}</TableCell><TableCell>{row.organization || '—'}</TableCell><TableCell>{row.personName || '—'}</TableCell><TableCell>{row.phone || '—'}</TableCell><TableCell><Chip size="small" color={row.action === 'error' ? 'error' : row.action === 'create' ? 'success' : row.action === 'update' ? 'primary' : 'default'} label={row.error ?? ({ create: 'Создать', update: 'Обновить', skip: 'Пропустить', error: 'Ошибка' })[row.action]} /></TableCell></TableRow>)}</TableBody></Table></TableContainer>
          {preview.length > 20 && <Typography variant="body2" color="text.secondary" mt={1.5}>Показаны первые 20 строк из {preview.length}</Typography>}
          <Stack direction="row" justifyContent="space-between" flexWrap="wrap" gap={1} mt={3}><Button startIcon={<ArrowBack />} onClick={() => setStep(1)}>Изменить столбцы</Button><Stack direction="row" flexWrap="wrap" gap={1}>{counts.error > 0 && <Button color="error" onClick={downloadErrors}>Скачать ошибки</Button>}<Button variant="contained" onClick={() => void runImport()} disabled={busy}>{busy ? `Импортирую ${importProgress}%` : `Импортировать ${counts.create + counts.update}`}</Button></Stack></Stack>
          {busy && <LinearProgress aria-label="Прогресс импорта" variant="determinate" value={importProgress} sx={{ mt: 2 }} />}
        </Paper>
      )}
      {step === 3 && result && (
        <Paper sx={{ p: 7, textAlign: 'center', border: 1, borderColor: 'divider', borderRadius: tokens.radiusCss.lg }}><CheckCircleOutline color="success" sx={{ fontSize: tokens.size.successIcon }} /><Typography variant="h1" mt={1.5}>Импорт завершён</Typography><Typography color="text.secondary" mt={1}>Создано: {result.created}, обновлено: {result.updated}, пропущено: {result.skipped}, ошибок: {result.errors}</Typography><Button variant="contained" onClick={reset} sx={{ mt: 3 }}>Импортировать ещё файл</Button></Paper>
      )}
    </Box>
  );
}

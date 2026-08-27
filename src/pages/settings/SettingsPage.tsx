import { useState } from 'react';
import { Add, ArrowDownward, ArrowUpward, BackupOutlined, DeleteOutline, DownloadOutlined, EditOutlined, UploadOutlined } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useLiveQuery } from 'dexie-react-hooks';
import { exportBackup, restoreBackup } from '../../features/backup/model/backup-service';
import { archiveStage, LastStageError, reorderStage, saveStage, StageInUseError } from '../../entities/stage/model/stage-service';
import { db } from '../../infrastructure/database/database';
import type { CustomFieldDefinition, CustomFieldType, Stage } from '../../shared/model/domain';
import { stageColors, tokens } from '../../shared/design-system/tokens';
import { createCustomField, updateCustomField, updatePreferences } from '../../features/manage-settings/model/settings-service';
import { Toast } from '../../shared/ui/Toast';

const stagePalette = stageColors;

export function SettingsPage() {
  const stagesQuery = useLiveQuery(() => db.stages.filter((stage) => !stage.archived).sortBy('order'), []);
  const fieldsQuery = useLiveQuery(() => db.customFields.filter((field) => !field.archived).toArray(), []);
  const preferences = useLiveQuery(() => db.preferences.get('preferences'), []);
  const stages = stagesQuery ?? [];
  const fields = fieldsQuery ?? [];
  const [tab, setTab] = useState(0);
  const [stageDialog, setStageDialog] = useState(false);
  const [editingStage, setEditingStage] = useState<Stage | null>(null);
  const [stageName, setStageName] = useState('');
  const [stageColor, setStageColor] = useState<string>(stageColors[0]);
  const [stageKind, setStageKind] = useState<NonNullable<Stage['kind']>>('normal');
  const [fieldName, setFieldName] = useState('');
  const [fieldType, setFieldType] = useState<CustomFieldType>('text');
  const [message, setMessage] = useState('');
  const [pendingBackup, setPendingBackup] = useState<File | null>(null);
  const [pendingFieldDelete, setPendingFieldDelete] = useState<CustomFieldDefinition | null>(null);
  const [pendingStageDelete, setPendingStageDelete] = useState<Stage | null>(null);
  const [backupAcknowledged, setBackupAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);

  if (stagesQuery === undefined || fieldsQuery === undefined || preferences === undefined) {
    return <Box sx={{ py: 12, display: 'grid', placeItems: 'center' }}><CircularProgress aria-label="Загрузка настроек" /></Box>;
  }

  async function runAction(action: () => Promise<void>, success?: string) {
    setBusy(true); setMessage('');
    try { await action(); if (success) setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? `Не удалось: ${error.message}` : 'Не удалось выполнить действие.'); }
    finally { setBusy(false); }
  }

  async function addStage() {
    if (!stageName.trim()) return;
    await runAction(async () => {
      await saveStage({ name: stageName, color: stageColor, kind: stageKind }, editingStage?.id);
      setStageName(''); setEditingStage(null); setStageDialog(false);
    }, editingStage ? 'Этап обновлён.' : 'Этап добавлен.');
  }

  function renameStage(stage: Stage) {
    setEditingStage(stage); setStageName(stage.name); setStageColor(stage.color); setStageKind(stage.kind ?? 'normal'); setStageDialog(true);
  }

  async function moveStage(stage: Stage, direction: -1 | 1) {
    await runAction(() => reorderStage(stage.id, direction));
  }

  async function deleteStage(stage: Stage) {
    try { await archiveStage(stage.id); }
    catch (error) {
      if (error instanceof StageInUseError) setMessage(`Нельзя удалить «${stage.name}»: в нём ${error.leadsCount} карточек.`);
      else if (error instanceof LastStageError) setMessage('Нельзя удалить последний активный этап.');
      else setMessage('Не удалось удалить этап.');
    }
  }

  async function addField() {
    if (!fieldName.trim()) return;
    await runAction(async () => { await createCustomField(fieldName, fieldType); setFieldName(''); }, 'Поле добавлено.');
  }

  async function importBackup(file: File) {
    await runAction(async () => { await restoreBackup(file); setPendingBackup(null); setBackupAcknowledged(false); }, 'Резервная копия восстановлена.');
  }

  async function downloadCurrentBackup() {
    await runAction(() => exportBackup(), 'Текущая резервная копия скачана. Сохраните файл в надёжном месте.');
  }

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: tokens.size.contentNarrow }}>
      <Paper sx={{ border: 1, borderColor: 'divider', borderRadius: tokens.radiusCss.lg }}>
        <Tabs aria-label="Разделы настроек" variant="scrollable" scrollButtons="auto" value={tab} onChange={(_, value: number) => setTab(value)} sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}><Tab label="Этапы" /><Tab label="Поля контакта" /><Tab label="Резервные копии" /><Tab label="Общие" /></Tabs>
        <Box sx={{ p: { xs: 2, sm: 3 } }}>
          {tab === 0 && <><Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2} mb={2.5}><Box><Typography variant="h2">Этапы канбана</Typography><Typography variant="body2" color="text.secondary">Меняйте порядок и названия под свой процесс.</Typography></Box><Button disabled={busy} variant="contained" startIcon={<Add />} onClick={() => { setEditingStage(null); setStageName(''); setStageColor(stageColors[0]); setStageKind('normal'); setStageDialog(true); }}>Добавить этап</Button></Stack><Stack gap={1}>{stages.map((stage, index) => <Stack key={stage.id} direction="row" alignItems="center" flexWrap="wrap" gap={1.5} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: tokens.radiusCss.md }}><Box aria-hidden sx={{ width: tokens.size.stageDot, height: tokens.size.stageDot, borderRadius: tokens.radiusCss.round, bgcolor: stage.color }} /><Typography fontWeight={tokens.fontWeight.semibold} sx={{ flex: 1 }}>{stage.name}</Typography><Tooltip title="Выше"><Box component="span"><IconButton aria-label={`Переместить этап «${stage.name}» выше`} disabled={busy || index === 0} onClick={() => void moveStage(stage, -1)}><ArrowUpward fontSize="small" /></IconButton></Box></Tooltip><Tooltip title="Ниже"><Box component="span"><IconButton aria-label={`Переместить этап «${stage.name}» ниже`} disabled={busy || index === stages.length - 1} onClick={() => void moveStage(stage, 1)}><ArrowDownward fontSize="small" /></IconButton></Box></Tooltip><Tooltip title="Переименовать"><IconButton aria-label={`Изменить этап «${stage.name}»`} disabled={busy} onClick={() => renameStage(stage)}><EditOutlined fontSize="small" /></IconButton></Tooltip><Tooltip title="Удалить"><IconButton aria-label={`Удалить этап «${stage.name}»`} disabled={busy} color="error" onClick={() => setPendingStageDelete(stage)}><DeleteOutline fontSize="small" /></IconButton></Tooltip></Stack>)}</Stack></>}
          {tab === 1 && <><Typography variant="h2">Пользовательские поля</Typography><Typography variant="body2" color="text.secondary" mb={2.5}>Например: бюджет, источник или тип клиента.</Typography><Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5} mb={2.5}><TextField label="Название поля" value={fieldName} onChange={(event) => setFieldName(event.target.value)} sx={{ flex: 1 }} /><Select inputProps={{ 'aria-label': 'Тип пользовательского поля' }} size="small" value={fieldType} onChange={(event) => setFieldType(event.target.value)} sx={{ width: { xs: tokens.size.full, sm: 'auto' }, minWidth: { xs: tokens.size.zero, sm: tokens.size.selectSmall } }}><MenuItem value="text">Текст</MenuItem><MenuItem value="number">Число</MenuItem><MenuItem value="date">Дата</MenuItem><MenuItem value="boolean">Да / нет</MenuItem></Select><Button disabled={busy} variant="contained" startIcon={<Add />} onClick={() => void addField()}>Добавить</Button></Stack>{fields.length === 0 && <Typography color="text.secondary">Дополнительных полей пока нет.</Typography>}<Stack gap={1}>{fields.map((field) => <Stack key={field.id} direction="row" alignItems="center" flexWrap="wrap" gap={1} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: tokens.radiusCss.md }}><TextField size="small" defaultValue={field.name} aria-label="Название пользовательского поля" onBlur={(event) => { const name = event.target.value.trim(); if (name && name !== field.name) void runAction(() => updateCustomField(field.id, { name }), 'Поле обновлено.'); }} sx={{ flex: 1 }} /><Typography variant="body2" color="text.secondary" mr={2}>{field.type}</Typography><Tooltip title="Показывать на карточке"><Switch disabled={busy} checked={field.showOnCard} onChange={(_, checked) => void runAction(() => updateCustomField(field.id, { showOnCard: checked }))} slotProps={{ input: { 'aria-label': `Показывать «${field.name}» на карточке` } }} /></Tooltip><Tooltip title="Использовать в фильтрах"><Switch disabled={busy} checked={field.filterable} onChange={(_, checked) => void runAction(() => updateCustomField(field.id, { filterable: checked }))} slotProps={{ input: { 'aria-label': `Фильтровать по полю «${field.name}»` } }} /></Tooltip><IconButton disabled={busy} aria-label={`Удалить поле «${field.name}»`} color="error" onClick={() => setPendingFieldDelete(field)}><DeleteOutline /></IconButton></Stack>)}</Stack></>}
          {tab === 2 && <><Typography variant="h2">Резервные копии</Typography><Typography variant="body2" color="text.secondary" mb={2.5}>Скачайте копию данных и храните её в надёжном месте.</Typography><Stack direction="row" flexWrap="wrap" gap={1.5}><Button disabled={busy} variant="contained" startIcon={<DownloadOutlined />} onClick={() => void downloadCurrentBackup()}>Скачать копию</Button><Button disabled={busy} component="label" variant="outlined" startIcon={<UploadOutlined />}>Восстановить<Box component="input" hidden type="file" accept=".json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setPendingBackup(file); setBackupAcknowledged(false); } event.target.value = ''; }} /></Button></Stack><Alert severity="warning" icon={<BackupOutlined />} sx={{ mt: 3 }}>Восстановление полностью заменяет текущие данные. Сначала сохраните отдельную копию.</Alert></>}
          {tab === 3 && <><Typography variant="h2">Общие настройки</Typography><Stack gap={2} mt={2.5} maxWidth={tokens.size.formNarrow}><TextField key={`owner-${preferences.ownerName}`} disabled={busy} label="Имя пользователя" defaultValue={preferences.ownerName} onBlur={(event) => void runAction(() => updatePreferences({ ownerName: event.target.value }), 'Настройки сохранены.')} /><TextField key={`notify-${preferences.notifyMinutesBefore}`} disabled={busy} type="number" label="Напомнить за, минут" defaultValue={preferences.notifyMinutesBefore} slotProps={{ htmlInput: { min: 0, max: 1440 } }} onBlur={(event) => void runAction(() => updatePreferences({ notifyMinutesBefore: Number(event.target.value) }), 'Настройки сохранены.')} helperText="От 0 до 1440 минут" /><Stack direction="row" alignItems="center" justifyContent="space-between"><Box><Typography fontWeight={tokens.fontWeight.semibold}>Компактный режим</Typography><Typography variant="body2" color="text.secondary">Больше карточек на экране</Typography></Box><Switch disabled={busy} checked={preferences.compactMode} onChange={(_, checked) => void runAction(() => updatePreferences({ compactMode: checked }), 'Настройки сохранены.')} slotProps={{ input: { 'aria-label': 'Компактный режим' } }} /></Stack></Stack></>}
        </Box>
      </Paper>
      <Dialog open={stageDialog} onClose={() => { if (!busy) setStageDialog(false); }} fullWidth maxWidth="xs" aria-labelledby="stage-dialog-title"><DialogTitle id="stage-dialog-title">{editingStage ? 'Изменить этап' : 'Новый этап'}</DialogTitle><DialogContent><TextField fullWidth label="Название" value={stageName} onChange={(event) => setStageName(event.target.value)} sx={{ mt: 1 }} /><Select inputProps={{ 'aria-label': 'Назначение этапа' }} fullWidth size="small" value={stageKind} onChange={(event) => setStageKind(event.target.value)} sx={{ mt: 2 }}><MenuItem value="normal">Обычный этап</MenuItem><MenuItem value="no_answer">Не дозвонились</MenuItem><MenuItem value="won">Успешная продажа</MenuItem><MenuItem value="lost">Отказ</MenuItem></Select><Typography variant="body2" color="text.secondary" mt={2}>Цвет</Typography><Stack direction="row" gap={1} mt={1}>{stagePalette.map((color) => <IconButton aria-label={`Цвет ${color}`} aria-pressed={stageColor === color} key={color} onClick={() => setStageColor(color)} sx={{ width: tokens.size.colorButton, height: tokens.size.colorButton, bgcolor: color, border: stageColor === color ? 3 : 0, borderColor: 'text.primary', '&:hover': { bgcolor: color } }} />)}</Stack></DialogContent><DialogActions><Button disabled={busy} onClick={() => setStageDialog(false)}>Отмена</Button><Button loading={busy} disabled={!stageName.trim()} variant="contained" onClick={() => void addStage()}>{editingStage ? 'Сохранить' : 'Добавить'}</Button></DialogActions></Dialog>
      <Dialog open={Boolean(pendingBackup)} onClose={() => { if (!busy) setPendingBackup(null); }} fullWidth maxWidth="xs" aria-labelledby="restore-dialog-title"><DialogTitle id="restore-dialog-title">Восстановить данные?</DialogTitle><DialogContent><Typography>Текущие данные будут полностью заменены данными из «{pendingBackup?.name}».</Typography><Button disabled={busy} startIcon={<DownloadOutlined />} onClick={() => void downloadCurrentBackup()} sx={{ mt: 2 }}>Скачать текущую копию</Button><FormControlLabel sx={{ mt: 1 }} control={<Checkbox checked={backupAcknowledged} onChange={(_, checked) => setBackupAcknowledged(checked)} />} label="Я сохранил текущую копию в надёжном месте" /></DialogContent><DialogActions><Button disabled={busy} onClick={() => setPendingBackup(null)}>Отмена</Button><Button loading={busy} disabled={!backupAcknowledged} color="error" variant="contained" onClick={() => { if (pendingBackup) void importBackup(pendingBackup); }}>Восстановить</Button></DialogActions></Dialog>
      <Dialog open={Boolean(pendingFieldDelete)} onClose={() => setPendingFieldDelete(null)} fullWidth maxWidth="xs" aria-labelledby="field-delete-title"><DialogTitle id="field-delete-title">Удалить поле?</DialogTitle><DialogContent><Typography>Поле «{pendingFieldDelete?.name}» исчезнет из карточек и фильтров. Сохранённые значения останутся в резервных копиях.</Typography></DialogContent><DialogActions><Button disabled={busy} onClick={() => setPendingFieldDelete(null)}>Отмена</Button><Button disabled={busy} color="error" variant="contained" onClick={() => { if (pendingFieldDelete) void runAction(async () => { await updateCustomField(pendingFieldDelete.id, { archived: true }); setPendingFieldDelete(null); }, 'Поле удалено.'); }}>Удалить</Button></DialogActions></Dialog>
      <Dialog open={Boolean(pendingStageDelete)} onClose={() => setPendingStageDelete(null)} fullWidth maxWidth="xs" aria-labelledby="stage-delete-title"><DialogTitle id="stage-delete-title">Удалить этап?</DialogTitle><DialogContent><Typography>Этап «{pendingStageDelete?.name}» будет скрыт. Этап с карточками удалить нельзя.</Typography></DialogContent><DialogActions><Button disabled={busy} onClick={() => setPendingStageDelete(null)}>Отмена</Button><Button disabled={busy} color="error" variant="contained" onClick={() => { if (pendingStageDelete) void deleteStage(pendingStageDelete).finally(() => setPendingStageDelete(null)); }}>Удалить</Button></DialogActions></Dialog>
      {message && <Toast open severity={message.startsWith('Нельзя') || message.startsWith('Не удалось') ? 'error' : 'success'} message={message} onClose={() => setMessage('')} />}
    </Box>
  );
}

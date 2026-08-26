import { useMemo, useState } from 'react';
import { FileDownloadOutlined, FilterListOutlined, PersonAddAlt1Outlined, Search } from '@mui/icons-material';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  InputAdornment,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TableSortLabel,
  TextField,
  Typography,
} from '@mui/material';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSearchParams } from 'react-router-dom';
import { getLeadViews } from '../../entities/lead/model/lead-service';
import { AddContactDialog } from '../../features/add-contact/ui/AddContactDialog';
import { ContactDrawer } from '../../features/contact-details/ui/ContactDrawer';
import { exportContactsToExcel } from '../../features/backup/model/backup-service';
import { db } from '../../infrastructure/database/database';
import { formatShortDate } from '../../shared/lib/dates';
import { formatPhone } from '../../shared/lib/phone';
import type { LeadView, Stage } from '../../shared/model/domain';
import { tokens } from '../../shared/design-system/tokens';
import { Toast } from '../../shared/ui/Toast';

type SortKey = 'name' | 'updated';
const EMPTY_VIEWS: LeadView[] = [];
const EMPTY_STAGES: Stage[] = [];

export function ContactsPage() {
  const viewsQuery = useLiveQuery(() => getLeadViews(), []);
  const stagesQuery = useLiveQuery(() => db.stages.toArray(), []);
  const views = viewsQuery ?? EMPTY_VIEWS;
  const stages = stagesQuery ?? EMPTY_STAGES;
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const [stageId, setStageId] = useState('all');
  const [sort, setSort] = useState<SortKey>('updated');
  const [page, setPage] = useState(0);
  const [selectedLead, setSelectedLead] = useState<string | null>(null);
  const [exportState, setExportState] = useState<'idle' | 'busy' | 'success' | 'error'>('idle');
  const [addOpen, setAddOpen] = useState(false);
  const [addedMessage, setAddedMessage] = useState('');
  const stageNames = useMemo(() => new Map(stages.map((stage) => [stage.id, stage])), [stages]);
  const contactViews = useMemo(() => {
    const latestByContact = new Map<string, LeadView>();
    for (const view of views) {
      const current = latestByContact.get(view.contact.id);
      if (!current || view.lead.updatedAt > current.lead.updatedAt) latestByContact.set(view.contact.id, view);
    }
    return [...latestByContact.values()];
  }, [views]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return contactViews.filter((view) => {
      const matchesText = !needle || [view.contact.organization, view.contact.personName, view.contact.phone, view.contact.email, view.contact.region, view.lead.externalId].some((value) => value.toLowerCase().includes(needle));
      return matchesText && (stageId === 'all' || view.lead.stageId === stageId);
    }).sort((a, b) => sort === 'name'
      ? (a.contact.organization || a.contact.personName).localeCompare(b.contact.organization || b.contact.personName, 'ru')
      : b.lead.updatedAt.localeCompare(a.lead.updatedAt));
  }, [contactViews, query, stageId, sort]);
  const safePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 100) - 1));
  const hasFilters = query.trim().length > 0 || stageId !== 'all';
  // Тосты не умеют показываться одновременно на одном якоре, поэтому берём одно уведомление.
  const notice = exportState === 'error'
    ? { severity: 'error' as const, text: 'Не удалось экспортировать контакты. Повторите ещё раз.', close: () => setExportState('idle') }
    : exportState === 'success'
      ? { severity: 'success' as const, text: 'Файл Excel сохранён.', close: () => setExportState('idle') }
      : { severity: 'success' as const, text: addedMessage, close: () => setAddedMessage('') };

  async function handleExport(): Promise<void> {
    if (exportState === 'busy') return;
    setExportState('busy');
    try {
      await exportContactsToExcel();
      setExportState('success');
    } catch {
      setExportState('error');
    }
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" gap={1.5} flexWrap="wrap" mb={2.5}>
        <TextField size="small" label="Поиск контактов" placeholder="Имя, телефон, организация..." value={query} onChange={(event) => { const next = new URLSearchParams(params); if (event.target.value) next.set('q', event.target.value); else next.delete('q'); setParams(next, { replace: true }); setPage(0); }} sx={{ width: { xs: tokens.size.full, sm: tokens.size.searchContacts } }} slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> } }} />
        <Select size="small" value={stageId} onChange={(event) => { setStageId(event.target.value); setPage(0); }} startAdornment={<FilterListOutlined fontSize="small" sx={{ mr: 1 }} />} sx={{ minWidth: tokens.size.selectWide }} inputProps={{ 'aria-label': 'Фильтр по этапу' }}>
          <MenuItem value="all">Все этапы</MenuItem>
          {stages.filter((stage) => !stage.archived).map((stage) => <MenuItem value={stage.id} key={stage.id}>{stage.name}</MenuItem>)}
        </Select>
        <Button variant="outlined" startIcon={exportState === 'busy' ? <CircularProgress size={16} /> : <FileDownloadOutlined />} disabled={exportState === 'busy' || contactViews.length === 0} onClick={() => void handleExport()} sx={{ ml: 'auto' }}>Экспорт в Excel</Button>
        <Button variant="contained" startIcon={<PersonAddAlt1Outlined />} onClick={() => { setAddedMessage(''); setAddOpen(true); }}>Добавить контакт</Button>
      </Stack>
      {viewsQuery === undefined || stagesQuery === undefined ? <Box sx={{ py: 12, display: 'grid', placeItems: 'center' }}><CircularProgress aria-label="Загрузка контактов" /></Box> : <TableContainer component={Paper} sx={{ border: 1, borderColor: 'divider', borderRadius: tokens.radiusCss.lg, maxHeight: tokens.size.contactsViewport }}>
        <Table stickyHeader size="small">
          <TableHead><TableRow>
            <TableCell><TableSortLabel active={sort === 'name'} onClick={() => setSort('name')}>Организация</TableSortLabel></TableCell>
            <TableCell>Контакт</TableCell><TableCell>Телефон</TableCell><TableCell>Регион</TableCell><TableCell>Этап</TableCell><TableCell>Ответственный</TableCell>
            <TableCell><TableSortLabel active={sort === 'updated'} direction="desc" onClick={() => setSort('updated')}>Изменено</TableSortLabel></TableCell>
          </TableRow></TableHead>
          <TableBody>
            {filtered.slice(safePage * 100, safePage * 100 + 100).map((view) => {
              const stage = stageNames.get(view.lead.stageId);
              return <TableRow key={view.contact.id} hover tabIndex={0} aria-label={`Открыть контакт ${view.contact.organization || view.contact.personName || formatPhone(view.contact.phone)}`} onClick={() => setSelectedLead(view.lead.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedLead(view.lead.id); } }} sx={{ cursor: 'pointer' }}>
                <TableCell><Typography variant="body2" fontWeight={tokens.fontWeight.strong}>{view.contact.organization || '—'}</Typography></TableCell>
                <TableCell>{view.contact.personName || '—'}</TableCell><TableCell>{formatPhone(view.contact.phone)}</TableCell><TableCell>{view.contact.region || '—'}</TableCell>
                <TableCell>{stage ? <Chip size="small" label={stage.name} variant="outlined" /> : '—'}</TableCell>
                <TableCell>{view.lead.assignee}</TableCell><TableCell>{formatShortDate(view.lead.updatedAt)}</TableCell>
              </TableRow>;
            })}
          </TableBody>
        </Table>
        {filtered.length === 0 && <Box sx={{ py: 9, textAlign: 'center' }}><Typography variant="h2">{contactViews.length === 0 ? 'Контактов пока нет' : 'Ничего не найдено'}</Typography><Typography color="text.secondary" mt={1}>{contactViews.length === 0 ? 'Импортируйте Excel-файл или добавьте контакт вручную.' : hasFilters ? 'Измените поиск или сбросьте фильтр.' : 'Добавьте первый контакт.'}</Typography></Box>}
      </TableContainer>}
      <TablePagination component="div" count={filtered.length} page={safePage} onPageChange={(_, value) => setPage(value)} rowsPerPage={100} rowsPerPageOptions={[100]} labelDisplayedRows={({ from, to, count }) => `${from}–${to} из ${count}`} />
      <Typography variant="body2" color="text.secondary">Всего контактов: {contactViews.length}</Typography>
      <AddContactDialog open={addOpen} onClose={() => setAddOpen(false)} onCreated={(leadId) => { setAddedMessage('Контакт добавлен.'); setSelectedLead(leadId); }} />
      <ContactDrawer key={selectedLead ?? 'closed'} leadId={selectedLead} onClose={() => setSelectedLead(null)} />
      {notice.text && <Toast open severity={notice.severity} message={notice.text} onClose={notice.close} />}
    </Box>
  );
}

import { useMemo, useState } from 'react';
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { FilterAltOutlined, Search, TuneOutlined } from '@mui/icons-material';
import { Box, Button, CircularProgress, InputAdornment, MenuItem, Paper, Select, Stack, TextField, Typography } from '@mui/material';
import { useLiveQuery } from 'dexie-react-hooks';
import { getLeadViews, moveLead } from '../../entities/lead/model/lead-service';
import { ContactDrawer } from '../../features/contact-details/ui/ContactDrawer';
import { db } from '../../infrastructure/database/database';
import type { LeadView } from '../../shared/model/domain';
import { KanbanColumn, type BoardSort } from '../../widgets/kanban/KanbanColumn';
import { useClock } from '../../shared/lib/useClock';
import { tokens } from '../../shared/design-system/tokens';
import { Toast } from '../../shared/ui/Toast';

function sortViews(views: LeadView[], sort: BoardSort): LeadView[] {
  return [...views].sort((a, b) => {
    if (sort === 'name_asc') return (a.contact.organization || a.contact.personName).localeCompare(b.contact.organization || b.contact.personName, 'ru');
    if (sort === 'created_desc') return b.lead.createdAt.localeCompare(a.lead.createdAt);
    if (sort === 'call_asc') return (a.nextCall?.dueAt ?? 'z').localeCompare(b.nextCall?.dueAt ?? 'z');
    return b.lead.updatedAt.localeCompare(a.lead.updatedAt);
  });
}

const EMPTY_VIEWS: LeadView[] = [];

export function BoardPage() {
  const stagesQuery = useLiveQuery(() => db.stages.filter((stage) => !stage.archived).sortBy('order'), []);
  const viewsQuery = useLiveQuery(() => getLeadViews(), []);
  const stages = stagesQuery ?? [];
  const views = viewsQuery ?? EMPTY_VIEWS;
  const [selectedLead, setSelectedLead] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [assignee, setAssignee] = useState('all');
  const [sort, setSort] = useState<BoardSort>('updated_desc');
  const [message, setMessage] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [updatedFilter, setUpdatedFilter] = useState('all');
  const [callFilter, setCallFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [customFilter, setCustomFilter] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const clock = useClock();
  const assignees = useMemo(() => [...new Set(views.map((view) => view.lead.assignee).filter(Boolean))], [views]);
  const tags = useMemo(() => [...new Set(views.flatMap((view) => view.contact.tags))].sort(), [views]);
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return views.filter((view) => {
      const matchesQuery = !normalizedQuery || [view.contact.organization, view.contact.personName, view.contact.phone, view.contact.region].some((value) => value.toLowerCase().includes(normalizedQuery));
      const updatedAt = new Date(view.lead.updatedAt).getTime();
      const matchesUpdated = updatedFilter === 'all' || updatedAt >= clock - (updatedFilter === 'today' ? 86_400_000 : 7 * 86_400_000);
      const callAt = view.nextCall ? new Date(view.nextCall.dueAt).getTime() : undefined;
      const matchesCall = callFilter === 'all' || (callFilter === 'overdue' ? callAt !== undefined && callAt < clock : callAt !== undefined);
      const matchesTag = tagFilter === 'all' || view.contact.tags.includes(tagFilter);
      const matchesCustom = !customFilter.trim() || view.filterFields.some((field) => `${field.label}: ${field.value}`.toLowerCase().includes(customFilter.trim().toLowerCase()));
      return matchesQuery && matchesUpdated && matchesCall && matchesTag && matchesCustom && (assignee === 'all' || view.lead.assignee === assignee);
    });
  }, [views, query, assignee, updatedFilter, callFilter, tagFilter, customFilter, clock]);

  async function handleDragEnd(event: DragEndEvent) {
    const stageId = String(event.over?.id ?? '');
    const leadId = String(event.active.id);
    if (!stageId || !stages.some((stage) => stage.id === stageId)) return;
    try { await moveLead(leadId, stageId); setMessage('Карточка перемещена'); }
    catch { setMessage('Не удалось переместить карточку'); }
  }

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack direction="row" gap={1.5} alignItems="center" flexWrap="wrap" mb={2.5}>
        <TextField placeholder="Поиск на доске" value={query} onChange={(event) => setQuery(event.target.value)} sx={{ width: { xs: tokens.size.full, sm: tokens.size.searchBoard } }} slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }, htmlInput: { 'aria-label': 'Поиск на доске' } }} />
        <Select inputProps={{ 'aria-label': 'Ответственный' }} size="small" value={assignee} onChange={(event) => setAssignee(event.target.value)} displayEmpty sx={{ width: { xs: tokens.size.full, sm: 'auto' }, minWidth: { xs: tokens.size.zero, sm: tokens.size.selectMedium } }} startAdornment={<FilterAltOutlined fontSize="small" sx={{ mr: 1 }} />}>
          <MenuItem value="all">Все ответственные</MenuItem>
          {assignees.map((name) => <MenuItem key={name} value={name}>{name}</MenuItem>)}
        </Select>
        <Button startIcon={<TuneOutlined />} color="inherit" onClick={() => setShowFilters((value) => !value)}>Фильтры</Button>
        <Typography variant="body2" color="text.secondary" ml="auto">Найдено: {filtered.length}</Typography>
      </Stack>
      {showFilters && <Paper sx={{ p: 2, mb: 2, border: 1, borderColor: 'divider' }}><Stack direction="row" gap={1.5} alignItems="center" flexWrap="wrap"><Select inputProps={{ 'aria-label': 'Последнее изменение' }} size="small" value={updatedFilter} onChange={(event) => setUpdatedFilter(event.target.value)} sx={{ width: { xs: tokens.size.full, sm: 'auto' }, minWidth: { xs: tokens.size.zero, sm: tokens.size.selectWide } }}><MenuItem value="all">Любое изменение</MenuItem><MenuItem value="today">Изменено за сутки</MenuItem><MenuItem value="week">Изменено за 7 дней</MenuItem></Select><Select inputProps={{ 'aria-label': 'Статус звонка' }} size="small" value={callFilter} onChange={(event) => setCallFilter(event.target.value)} sx={{ width: { xs: tokens.size.full, sm: 'auto' }, minWidth: { xs: tokens.size.zero, sm: tokens.size.selectWide } }}><MenuItem value="all">Любые звонки</MenuItem><MenuItem value="scheduled">Есть звонок</MenuItem><MenuItem value="overdue">Просрочен звонок</MenuItem></Select><Select inputProps={{ 'aria-label': 'Тег' }} size="small" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} sx={{ width: { xs: tokens.size.full, sm: 'auto' }, minWidth: { xs: tokens.size.zero, sm: tokens.size.selectSmall } }}><MenuItem value="all">Все теги</MenuItem>{tags.map((tag) => <MenuItem key={tag} value={tag}>{tag}</MenuItem>)}</Select><TextField label="Доп. поле содержит" value={customFilter} onChange={(event) => setCustomFilter(event.target.value)} sx={{ width: { xs: tokens.size.full, sm: 'auto' }, minWidth: { xs: tokens.size.zero, sm: tokens.size.selectWide } }} /><Button onClick={() => { setUpdatedFilter('all'); setCallFilter('all'); setTagFilter('all'); setCustomFilter(''); }}>Сбросить</Button></Stack></Paper>}
      {viewsQuery === undefined || stagesQuery === undefined ? <Box sx={{ py: 12, display: 'grid', placeItems: 'center' }}><CircularProgress aria-label="Загрузка доски" /></Box> : views.length === 0 ? (
        <Box sx={{ py: 12, textAlign: 'center' }}><Typography variant="h2">Контактов пока нет</Typography><Typography color="text.secondary" mt={1}>Импортируйте Excel — карточки появятся здесь.</Typography></Box>
      ) : filtered.length === 0 ? (
        <Paper sx={{ py: 9, textAlign: 'center', border: 1, borderColor: 'divider' }}><Typography variant="h2">По фильтрам ничего не найдено</Typography><Typography color="text.secondary" mt={1}>Сбросьте фильтры или измените поиск.</Typography><Button sx={{ mt: 2 }} onClick={() => { setQuery(''); setAssignee('all'); setUpdatedFilter('all'); setCallFilter('all'); setTagFilter('all'); setCustomFilter(''); }}>Сбросить фильтры</Button></Paper>
      ) : (
        <DndContext sensors={sensors} onDragEnd={(event) => void handleDragEnd(event)}>
          <Stack direction="row" gap={1.5} alignItems="flex-start" sx={{ overflowX: 'auto', pb: 2, minHeight: tokens.size.boardViewport }}>
            {stages.map((stage) => <KanbanColumn key={stage.id} stage={stage} views={sortViews(filtered.filter((view) => view.lead.stageId === stage.id), sort)} sort={sort} onSort={setSort} onOpen={setSelectedLead} />)}
          </Stack>
        </DndContext>
      )}
      <ContactDrawer key={selectedLead ?? 'closed'} leadId={selectedLead} onClose={() => setSelectedLead(null)} />
      {message && <Toast open severity={message.startsWith('Не удалось') ? 'error' : 'success'} message={message} onClose={() => setMessage('')} />}
    </Box>
  );
}

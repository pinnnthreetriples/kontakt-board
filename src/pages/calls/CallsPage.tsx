import { useMemo, useRef, useState } from 'react';
import { CheckCircleOutline, EventRepeatOutlined, OpenInNewOutlined, PhoneOutlined } from '@mui/icons-material';
import { Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import { addDays, endOfDay, format, isSameDay, parseISO, startOfDay } from 'date-fns';
import { useLiveQuery } from 'dexie-react-hooks';
import { completeCall, completeCallAndMoveLead, getLeadViews, rescheduleCall, undoCallCompletion } from '../../entities/lead/model/lead-service';
import { ContactDrawer } from '../../features/contact-details/ui/ContactDrawer';
import { db } from '../../infrastructure/database/database';
import { callDateLabel, formatDateTime, isOverdue } from '../../shared/lib/dates';
import { formatPhone } from '../../shared/lib/phone';
import type { CallTask, LeadView, Stage } from '../../shared/model/domain';
import { useClock } from '../../shared/lib/useClock';
import { tokens } from '../../shared/design-system/tokens';
import { Toast } from '../../shared/ui/Toast';

type CallFilter = 'overdue' | 'today' | 'tomorrow' | 'week' | 'custom' | 'all';
const EMPTY_CALLS: CallTask[] = [];
const EMPTY_VIEWS: LeadView[] = [];
const EMPTY_STAGES: Stage[] = [];

export function CallsPage() {
  const viewsQuery = useLiveQuery(() => getLeadViews(), []);
  const callsQuery = useLiveQuery(() => db.calls.filter((call) => !call.completedAt).sortBy('dueAt'), []);
  const stagesQuery = useLiveQuery(() => db.stages.toArray(), []);
  const views = viewsQuery ?? EMPTY_VIEWS;
  const calls = callsQuery ?? EMPTY_CALLS;
  const stages = stagesQuery ?? EMPTY_STAGES;
  const [filter, setFilter] = useState<CallFilter>('today');
  const [selectedLead, setSelectedLead] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [page, setPage] = useState(0);
  const [actionError, setActionError] = useState<{ callId: string; message: string } | null>(null);
  const [busyCallIds, setBusyCallIds] = useState<ReadonlySet<string>>(() => new Set());
  const [undoAction, setUndoAction] = useState<{ callId: string; previousStageId?: string } | null>(null);
  const busyCallIdsRef = useRef(new Set<string>());
  const clock = useClock();
  const activeStages = stages.filter((stage) => !stage.archived);
  const noAnswerStage = activeStages.find((stage) => stage.kind === 'no_answer') ?? activeStages.find((stage) => stage.name.toLowerCase().includes('не дозвон'));
  const viewsByLead = useMemo(() => new Map(views.map((view) => [view.lead.id, view])), [views]);
  const visibleCalls = useMemo(() => {
    const now = new Date(clock);
    const tomorrow = addDays(now, 1);
    const weekEnd = endOfDay(addDays(now, 7));
    return calls.filter((call) => {
      if (!viewsByLead.has(call.leadId)) return false;
      const due = parseISO(call.dueAt);
      if (filter === 'overdue') return isOverdue(call.dueAt, now);
      if (filter === 'today') return isSameDay(due, now);
      if (filter === 'tomorrow') return isSameDay(due, tomorrow);
      if (filter === 'week') return due >= startOfDay(now) && due <= weekEnd;
      if (filter === 'custom') return format(due, 'yyyy-MM-dd') === selectedDate;
      return true;
    });
  }, [calls, filter, selectedDate, clock, viewsByLead]);
  const safePage = Math.min(page, Math.max(0, Math.ceil(visibleCalls.length / 100) - 1));
  // Ошибка показывается тостом, только если сам звонок не виден: иначе она стоит рядом со строкой.
  const globalError = actionError && !visibleCalls.some((call) => call.id === actionError.callId) ? actionError : null;

  const tabFilters: Array<{ value: CallFilter; label: string }> = [
    { value: 'overdue', label: `Просроченные ${calls.filter((call) => isOverdue(call.dueAt, new Date(clock))).length}` },
    { value: 'today', label: 'Сегодня' },
    { value: 'tomorrow', label: 'Завтра' },
    { value: 'week', label: '7 дней' },
    { value: 'custom', label: 'Дата' },
    { value: 'all', label: 'Все' },
  ];

  async function runAction(callId: string, action: () => Promise<void>): Promise<void> {
    if (busyCallIdsRef.current.has(callId)) return;
    busyCallIdsRef.current.add(callId);
    setBusyCallIds(new Set(busyCallIdsRef.current));
    setActionError(null);
    try {
      await action();
    } catch {
      setActionError({ callId, message: 'Не удалось выполнить действие. Повторите ещё раз.' });
    } finally {
      busyCallIdsRef.current.delete(callId);
      setBusyCallIds(new Set(busyCallIdsRef.current));
    }
  }

  return (
    <Box sx={{ p: 3, maxWidth: tokens.size.contentMedium }}>
      <Typography color="text.secondary" mb={2}>Здесь собраны все назначенные звонки. Просроченные всегда выделены.</Typography>
      {viewsQuery === undefined || callsQuery === undefined || stagesQuery === undefined ? <Box sx={{ py: 12, display: 'grid', placeItems: 'center' }}><CircularProgress aria-label="Загрузка звонков" /></Box> : <Paper sx={{ border: 1, borderColor: 'divider', borderRadius: tokens.radiusCss.lg }}>
        <Tabs aria-label="Период звонков" variant="scrollable" scrollButtons="auto" value={filter} onChange={(_, value: CallFilter) => { setFilter(value); setPage(0); }} sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
          {tabFilters.map((item) => <Tab key={item.value} value={item.value} label={item.label} />)}
        </Tabs>
        {filter === 'custom' && <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}><TextField type="date" label="Выберите дату" value={selectedDate} onChange={(event) => { setSelectedDate(event.target.value); setPage(0); }} slotProps={{ inputLabel: { shrink: true } }} /></Box>}
        <Stack divider={<Box sx={{ borderBottom: 1, borderColor: 'divider' }} />}>
          {visibleCalls.slice(safePage * 100, safePage * 100 + 100).map((call) => {
            const view = viewsByLead.get(call.leadId);
            if (!view) return null;
            const overdue = isOverdue(call.dueAt, new Date(clock));
            const isBusy = busyCallIds.has(call.id);
            const contactName = view.contact.organization || view.contact.personName || formatPhone(view.contact.phone);
            return (
              <Box key={call.id}>
                <Stack direction="row" alignItems="center" gap={2} flexWrap="wrap" aria-busy={isBusy} sx={{ px: 2.5, py: 2 }}>
                  <Box sx={{ width: tokens.size.callLabel }}><Typography fontWeight={tokens.fontWeight.bold} color={overdue ? 'error.main' : 'text.primary'}>{callDateLabel(call.dueAt)}</Typography><Typography variant="body2" color="text.secondary">{overdue ? 'Просрочено' : formatDateTime(call.dueAt)}</Typography></Box>
                  <Box sx={{ flex: 1, minWidth: tokens.size.zero }}><Typography fontWeight={tokens.fontWeight.strong} noWrap>{contactName}</Typography><Typography variant="body2" color="text.secondary" noWrap>{call.note || 'Без заметки'}, {formatPhone(view.contact.phone)}</Typography></Box>
                  {overdue && <Chip label="Просрочен" color="error" size="small" />}
                  <Button disabled={!view.contact.phone} startIcon={<PhoneOutlined />} href={view.contact.phone ? `tel:${view.contact.phone}` : undefined} aria-label={`Позвонить: ${contactName}`}>Позвонить</Button>
                  <Button startIcon={isBusy ? <CircularProgress size={16} /> : <CheckCircleOutline />} disabled={isBusy} aria-label={`Отметить звонок выполненным: ${contactName}`} onClick={() => void runAction(call.id, async () => { await completeCall(call.id); setUndoAction({ callId: call.id }); })}>Выполнено</Button>
                  <Button disabled={isBusy} aria-label={`Перенести звонок на завтра: ${contactName}`} onClick={() => void runAction(call.id, () => rescheduleCall(call.id, addDays(new Date(clock), 1).toISOString()))}>На завтра</Button>
                  <Button color="warning" disabled={isBusy || !noAnswerStage} title={!noAnswerStage ? 'Активный этап «Не дозвонились» не найден' : undefined} aria-label={`Не дозвонились: ${contactName}`} onClick={() => { if (noAnswerStage) void runAction(call.id, async () => { await completeCallAndMoveLead(call.id, noAnswerStage.id); setUndoAction({ callId: call.id, previousStageId: view.lead.stageId }); }); }}>Не дозвонились</Button>
                  <Button startIcon={<OpenInNewOutlined />} color="inherit" aria-label={`Открыть контакт: ${contactName}`} onClick={() => setSelectedLead(view.lead.id)}>Открыть</Button>
                </Stack>
                {actionError?.callId === call.id && <Alert severity="error" onClose={() => setActionError(null)} sx={{ mx: 2.5, mb: 2 }}>{actionError.message}</Alert>}
              </Box>
            );
          })}
          {visibleCalls.length === 0 && <Box sx={{ py: 9, textAlign: 'center' }}><EventRepeatOutlined color="disabled" sx={{ fontSize: tokens.size.emptyIcon }} /><Typography variant="h2" mt={1}>Звонков нет</Typography><Typography color="text.secondary" mt={0.75}>На выбранный период ничего не назначено.</Typography></Box>}
          {visibleCalls.length > 100 && <Stack direction="row" justifyContent="flex-end" gap={1} sx={{ p: 2 }}><Button disabled={safePage === 0} onClick={() => setPage((value) => value - 1)}>Назад</Button><Typography variant="body2" alignSelf="center">{safePage + 1} / {Math.ceil(visibleCalls.length / 100)}</Typography><Button disabled={(safePage + 1) * 100 >= visibleCalls.length} onClick={() => setPage((value) => value + 1)}>Далее</Button></Stack>}
        </Stack>
      </Paper>}
      <ContactDrawer key={selectedLead ?? 'closed'} leadId={selectedLead} onClose={() => setSelectedLead(null)} />
      {globalError ? (
        <Toast open severity="error" message={globalError.message} onClose={() => setActionError(null)} />
      ) : (
        <Toast open={Boolean(undoAction)} severity="success" autoHideDuration={8_000} message="Действие со звонком выполнено" onClose={() => setUndoAction(null)} action={<Button size="small" color="inherit" onClick={() => { if (undoAction) void runAction(undoAction.callId, async () => { await undoCallCompletion(undoAction.callId, undoAction.previousStageId); setUndoAction(null); }); }}>Отменить</Button>} />
      )}
    </Box>
  );
}

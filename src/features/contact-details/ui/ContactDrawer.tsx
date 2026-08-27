import { useState } from 'react';
import { CalendarTodayOutlined, Close, DeleteOutline, SaveOutlined } from '@mui/icons-material';
import {
  Box,
  Alert,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../infrastructure/database/database';
import { tokens } from '../../../shared/design-system/tokens';
import { formatDateTime, formatDateTimeValue, formatDateValue, parseDateValue, toDateInputValue } from '../../../shared/lib/dates';
import { addComment, deleteLead, moveLead, saveLeadCard, scheduleCall, setLeadPriority } from '../../../entities/lead/model/lead-service';
import type { Contact } from '../../../shared/model/domain';
import { EMPTY_DRAFT, leadDraftFrom, type ContactDraft, type LeadDraft } from '../model/drafts';
import { SendProposalDialog } from '../../send-proposal/ui/SendProposalDialog';
import { Toast } from '../../../shared/ui/Toast';
import { ContactFields } from './ContactFields';
import { EditableTitle } from './EditableTitle';
import { LeadChat, type ChatEntry } from './LeadChat';
import { LeadRecordings } from './LeadRecordings';
import { PrioritySelect } from './PrioritySelect';
import { StagePipeline } from './StagePipeline';
import { TagBar } from './TagBar';

interface ContactDrawerProps {
  leadId: string | null;
  onClose: () => void;
}

const nextCallDate = () => toDateInputValue(new Date(Date.now() + 3_600_000));

async function loadContactDetails(leadId: string | null) {
  if (!leadId) return null;
  const lead = await db.leads.get(leadId);
  if (!lead) return null;
  const [contact, comments, activities, calls, stages, customFields, preferences] = await Promise.all([
    db.contacts.get(lead.contactId),
    db.comments.where('leadId').equals(leadId).sortBy('createdAt'),
    db.activities.where('leadId').equals(leadId).sortBy('createdAt'),
    db.calls.where('leadId').equals(leadId).reverse().sortBy('dueAt'),
    db.stages.filter((stage) => !stage.archived).sortBy('order'),
    db.customFields.filter((field) => !field.archived).toArray(),
    db.preferences.get('preferences'),
  ]);
  if (!contact) return null;
  const chat: ChatEntry[] = [
    ...comments.map((item) => ({ id: item.id, kind: 'message' as const, text: item.text, author: item.author, createdAt: item.createdAt })),
    // Событие «Добавлен комментарий» дублирует само сообщение, которое уже в ленте.
    ...activities.filter((item) => item.kind !== 'commented').map((item) => ({ id: item.id, kind: 'event' as const, text: item.text, author: item.author, createdAt: item.createdAt })),
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return { lead, contact, chat, calls, stages, customFields, author: preferences?.ownerName.trim() || 'Я' };
}

// Черновик контакта собирается вне компонента: ветка с запасным значением иначе
// поднимает его цикломатическую сложность выше лимита линтера.
function toContactDraft(contact: Contact | undefined): ContactDraft {
  if (!contact) return EMPTY_DRAFT;
  return {
    organization: contact.organization,
    taxId: contact.taxId,
    personName: contact.personName,
    position: contact.position,
    phone: contact.phone,
    secondaryPhone: contact.secondaryPhone,
    email: contact.email,
    address: contact.address,
    region: contact.region,
    website: contact.website,
    tags: contact.tags,
    customValues: contact.customValues,
  };
}

// Имя диалога вынесено из компонента: подстановка запасного текста иначе поднимает
// его цикломатическую сложность выше лимита линтера.
function cardLabel(organization: string): string {
  return `Заявка: ${organization || 'Контакт'}`;
}

export function ContactDrawer({ leadId, onClose }: ContactDrawerProps) {
  const data = useLiveQuery(() => loadContactDetails(leadId), [leadId]);
  const [callDate, setCallDate] = useState(nextCallDate);
  const [callBaseline, setCallBaseline] = useState(callDate);
  const [callNote, setCallNote] = useState('');
  const [callError, setCallError] = useState('');
  const [actionError, setActionError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [busyAction, setBusyAction] = useState<'save' | 'call' | 'stage' | 'delete' | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [proposalOpen, setProposalOpen] = useState(false);
  const [draft, setDraft] = useState<ContactDraft | null>(null);
  const [leadDraft, setLeadDraft] = useState<LeadDraft | null>(null);
  const contactDraft = draft ?? toContactDraft(data?.contact);
  const currentLeadDraft = leadDraft ?? leadDraftFrom(data?.lead);
  const dirty = draft !== null || leadDraft !== null || Boolean(callNote.trim()) || callDate !== callBaseline;

  function requestClose() {
    if (dirty) setConfirmClose(true);
    else onClose();
  }

  function copyPhone() {
    void navigator.clipboard.writeText(contactDraft.phone)
      .then(() => setSuccessMessage('Номер скопирован.'))
      .catch(() => setActionError('Не удалось скопировать номер.'));
  }

  async function saveContact() {
    if (!leadId) return;
    setActionError(''); setSuccessMessage(''); setBusyAction('save');
    try {
      await saveLeadCard(leadId, contactDraft, currentLeadDraft);
      setDraft(null); setLeadDraft(null); setSuccessMessage('Изменения сохранены.');
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Не удалось сохранить изменения. Повторите ещё раз.'); }
    finally { setBusyAction(null); }
  }

  async function submitCall() {
    if (!leadId || !callDate) return;
    if (new Date(callDate).getTime() <= Date.now()) { setCallError('Выберите будущее время.'); return; }
    setActionError(''); setSuccessMessage(''); setBusyAction('call');
    try { await scheduleCall(leadId, callDate, callNote); const nextDate = nextCallDate(); setCallDate(nextDate); setCallBaseline(nextDate); setCallNote(''); setCallError(''); setSuccessMessage('Звонок назначен.'); }
    catch { setActionError('Не удалось назначить звонок.'); }
    finally { setBusyAction(null); }
  }

  async function removeLead() {
    if (!leadId) return;
    setActionError(''); setBusyAction('delete');
    try { await deleteLead(leadId); onClose(); }
    catch { setActionError('Не удалось удалить заявку.'); setBusyAction(null); }
  }

  if (!leadId) return null;
  if (data === undefined) return <Dialog open onClose={onClose} fullWidth maxWidth="lg" slotProps={{ paper: { 'aria-label': 'Загрузка карточки' } }}><Box sx={{ py: 8, display: 'grid', placeItems: 'center' }}><CircularProgress aria-label="Загрузка карточки" /></Box></Dialog>;
  if (data === null) return <Dialog open onClose={onClose} fullWidth maxWidth="lg" slotProps={{ paper: { 'aria-label': 'Карточка не найдена' } }}><Box sx={{ p: 3 }}><Alert severity="error" action={<Button color="inherit" onClick={onClose}>Закрыть</Button>}>Карточка не найдена. Возможно, она была удалена.</Alert></Box></Dialog>;

  const activeCalls = data.calls.filter((call) => !call.completedAt);

  return (
    <Dialog open={Boolean(leadId)} onClose={requestClose} fullWidth maxWidth="lg" scroll="paper" slotProps={{ paper: { 'aria-label': cardLabel(contactDraft.organization) } }}>
      <DialogContent>
        {actionError && <Toast open severity="error" message={actionError} onClose={() => setActionError('')} />}
        {successMessage && <Toast open severity="success" message={successMessage} onClose={() => setSuccessMessage('')} />}
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={1.5}>
          <Box minWidth={tokens.size.zero} flex={1}>
            <EditableTitle value={contactDraft.organization} placeholder="Контакт" disabled={busyAction !== null} onChange={(value) => setDraft({ ...contactDraft, organization: value })} />
            <Box mt={1}>
              <PrioritySelect
                value={data.lead.priority ?? 'normal'}
                disabled={busyAction !== null}
                onChange={(priority) => { setActionError(''); void setLeadPriority(data.lead.id, priority).catch(() => setActionError('Не удалось изменить приоритет.')); }}
              />
            </Box>
          </Box>
          <Stack direction="row" alignItems="center" flexWrap="wrap" gap={1}>
            <TagBar contactId={data.contact.id} tags={data.contact.tags} disabled={busyAction !== null} />
            <Tooltip title="Удалить заявку"><Box component="span"><IconButton aria-label="Удалить заявку" color="error" disabled={busyAction !== null} onClick={() => setConfirmDelete(true)}><DeleteOutline /></IconButton></Box></Tooltip>
            <IconButton aria-label="Закрыть" onClick={requestClose}><Close /></IconButton>
          </Stack>
        </Stack>
        <Box my={2}>
          <StagePipeline
            stages={data.stages}
            currentStageId={data.lead.stageId}
            disabled={busyAction !== null}
            onSelect={(stageId) => { setBusyAction('stage'); setActionError(''); void moveLead(data.lead.id, stageId).catch(() => setActionError('Не удалось изменить этап.')).finally(() => setBusyAction(null)); }}
          />
        </Box>
        <Divider />
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          gap={3}
          mt={2.5}
          divider={<Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', md: 'block' } }} />}
          sx={{ height: { md: tokens.size.cardPane }, minHeight: { md: tokens.size.cardPaneMin } }}
        >
          <Stack flex={3} minWidth={tokens.size.zero} sx={{ minHeight: tokens.size.zero }}>
            {/* Панель прокручивается сама: раскрытые поля не должны удлинять карточку и уносить чат вниз. */}
            <Stack gap={2} sx={{ flex: 1, minHeight: tokens.size.zero, overflowY: { md: 'auto' }, pr: { md: 1 }, pt: 1 }}>
              {/* Крайний срок — про заявку, а не про звонок, поэтому стоит выше формы звонка. */}
              <DatePicker
                label="Крайний срок"
                format="dd.MM.yyyy"
                value={parseDateValue(currentLeadDraft.deadline)}
                disabled={busyAction !== null}
                onChange={(value) => setLeadDraft({ ...currentLeadDraft, deadline: formatDateValue(value) })}
                sx={{ maxWidth: tokens.size.callInput }}
              />
              <Typography variant="subtitle1">Назначить звонок</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} flexWrap="wrap" gap={1.5} alignItems={{ sm: 'center' }}>
                <DateTimePicker
                  label="Дата и время"
                  format="dd.MM.yyyy HH:mm"
                  ampm={false}
                  value={parseDateValue(callDate)}
                  onChange={(value) => setCallDate(formatDateTimeValue(value))}
                  sx={{ minWidth: { xs: tokens.size.zero, sm: tokens.size.callInput } }}
                />
                <TextField label="Тема звонка" value={callNote} onChange={(event) => setCallNote(event.target.value)} sx={{ flex: 1, minWidth: tokens.size.fieldMin }} />
                <Button variant="outlined" startIcon={<CalendarTodayOutlined />} loading={busyAction === 'call'} loadingPosition="start" disabled={busyAction !== null} onClick={() => void submitCall()} sx={{ flexShrink: 0 }}>Добавить</Button>
              </Stack>
              {callError && <Typography variant="body2" color="error">{callError}</Typography>}
              {activeCalls.length > 0 && <Stack direction="row" gap={1} flexWrap="wrap">{activeCalls.map((call) => <Chip key={call.id} size="small" icon={<CalendarTodayOutlined />} label={`${formatDateTime(call.dueAt)}${call.note ? `, ${call.note}` : ''}`} variant="outlined" />)}</Stack>}
              <Divider />
              <ContactFields
                draft={contactDraft}
                leadDraft={currentLeadDraft}
                createdAt={data.lead.createdAt}
                customFields={data.customFields}
                onDraftChange={setDraft}
                onLeadDraftChange={setLeadDraft}
                onCopyPhone={copyPhone}
                onSendProposal={() => setProposalOpen(true)}
                recordings={<LeadRecordings leadId={data.lead.id} />}
              />
            </Stack>
            <Button startIcon={<SaveOutlined />} variant="outlined" loading={busyAction === 'save'} loadingPosition="start" disabled={!dirty || busyAction !== null} onClick={() => void saveContact()} sx={{ alignSelf: 'flex-start', mt: 2 }}>Сохранить изменения</Button>
          </Stack>
          <Stack flex={2} minWidth={tokens.size.zero} gap={1} sx={{ minHeight: tokens.size.zero }}>
            <Typography variant="subtitle1">Обсуждение</Typography>
            {/* Чат — соседняя колонка, а не вкладка: сохранение карточки не должно его блокировать. */}
            <LeadChat entries={data.chat} currentAuthor={data.author} busy={busyAction === 'delete'} onSend={(text) => addComment(data.lead.id, text)} />
          </Stack>
        </Stack>
      </DialogContent>
      {proposalOpen && <SendProposalDialog leadId={data.lead.id} phone={contactDraft.phone} onClose={() => setProposalOpen(false)} />}
      <Dialog open={confirmClose} onClose={() => setConfirmClose(false)} aria-labelledby="confirm-close-title"><DialogTitle id="confirm-close-title">Закрыть без сохранения?</DialogTitle><DialogContent><Typography>Несохранённые изменения будут потеряны.</Typography></DialogContent><DialogActions><Button onClick={() => setConfirmClose(false)}>Продолжить редактирование</Button><Button color="error" onClick={onClose}>Закрыть</Button></DialogActions></Dialog>
      <Dialog open={confirmDelete} onClose={() => { if (busyAction !== 'delete') setConfirmDelete(false); }} aria-labelledby="confirm-delete-title"><DialogTitle id="confirm-delete-title">Удалить заявку?</DialogTitle><DialogContent><Typography>Заявка «{data.contact.organization || data.contact.personName || 'Без названия'}», её комментарии, история и звонки будут удалены навсегда. Отменить это нельзя.</Typography></DialogContent><DialogActions><Button disabled={busyAction === 'delete'} onClick={() => setConfirmDelete(false)}>Отмена</Button><Button color="error" variant="contained" loading={busyAction === 'delete'} onClick={() => void removeLead()}>Удалить</Button></DialogActions></Dialog>
    </Dialog>
  );
}

import { useState, type ReactNode } from 'react';
import { ContentCopyOutlined, ExpandMore, PhoneOutlined } from '@mui/icons-material';
import { Box, Button, Collapse, IconButton, InputAdornment, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material';
import { tokens } from '../../../shared/design-system/tokens';
import { formatShortDate } from '../../../shared/lib/dates';
import { describeRegionTime, regionTimeHint, regionTimeMark } from '../../../shared/lib/timezones';
import { useClock } from '../../../shared/lib/useClock';
import type { CustomFieldDefinition } from '../../../shared/model/domain';
import type { ContactDraft, LeadDraft } from '../model/drafts';

interface ContactFieldsProps {
  draft: ContactDraft;
  leadDraft: LeadDraft;
  createdAt: string;
  customFields: CustomFieldDefinition[];
  onDraftChange: (draft: ContactDraft) => void;
  onLeadDraftChange: (draft: LeadDraft) => void;
  onCopyPhone: () => void;
  recordings: ReactNode;
}

interface CustomFieldsEditorProps {
  fields: CustomFieldDefinition[];
  draft: ContactDraft;
  onChange: (draft: ContactDraft) => void;
}

function CustomFieldsEditor({ fields, draft, onChange }: CustomFieldsEditorProps) {
  if (fields.length === 0) return null;
  return <>
    <Typography variant="subtitle1">Дополнительные поля</Typography>
    {fields.map((field) => {
      if (field.type === 'boolean') return <Stack key={field.id} direction="row" alignItems="center" justifyContent="space-between"><Typography>{field.name}</Typography><Switch checked={Boolean(draft.customValues[field.id])} onChange={(_, checked) => onChange({ ...draft, customValues: { ...draft.customValues, [field.id]: checked } })} slotProps={{ input: { 'aria-label': field.name } }} /></Stack>;
      const inputType = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';
      return <TextField key={field.id} type={inputType} label={field.name} value={draft.customValues[field.id] ?? ''} onChange={(event) => {
        const value = field.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value;
        onChange({ ...draft, customValues: { ...draft.customValues, [field.id]: value } });
      }} slotProps={field.type === 'date' ? { inputLabel: { shrink: true } } : undefined} />;
    })}
  </>;
}

export function ContactFields({ draft, leadDraft, createdAt, customFields, onDraftChange, onLeadDraftChange, onCopyPhone, recordings }: ContactFieldsProps) {
  const [open, setOpen] = useState(false);
  const clock = useClock();
  const localTime = describeRegionTime(draft.region, clock);
  const telHref = draft.phone ? `tel:${draft.phone}` : '';
  return (
    <Stack gap={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5}>
        <TextField fullWidth label="Результат" value={leadDraft.result} onChange={(event) => onLeadDraftChange({ ...leadDraft, result: event.target.value })} />
        <TextField fullWidth label="Организация" value={draft.organization} onChange={(event) => onDraftChange({ ...draft, organization: event.target.value })} />
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} flexWrap="wrap" gap={1.5}>
        <TextField label="Регион" value={draft.region} onChange={(event) => onDraftChange({ ...draft, region: event.target.value })} sx={{ flex: 4, minWidth: tokens.size.fieldMin }} helperText={localTime
          ? <Tooltip title={regionTimeHint(localTime)}><Typography variant="caption" color={localTime.workday === 'open' ? 'text.secondary' : 'warning.main'}>{localTime.time}, {localTime.offsetLabel}{regionTimeMark(localTime)}</Typography></Tooltip>
          : undefined} />
        <TextField label="Адрес" value={draft.address} onChange={(event) => onDraftChange({ ...draft, address: event.target.value })} sx={{ flex: 4, minWidth: tokens.size.fieldMin }} />
        <TextField label="Телефон" value={draft.phone} onChange={(event) => onDraftChange({ ...draft, phone: event.target.value })} sx={{ flex: 5, minWidth: tokens.size.fieldMin }} slotProps={{ input: { endAdornment: (
          <InputAdornment position="end">
            <Tooltip title="Скопировать номер"><Box component="span"><IconButton size="small" aria-label="Скопировать номер" disabled={!telHref} onClick={onCopyPhone}><ContentCopyOutlined fontSize="small" /></IconButton></Box></Tooltip>
            <Tooltip title="Позвонить"><Box component="span"><IconButton size="small" aria-label="Позвонить" color="primary" disabled={!telHref} href={telHref}><PhoneOutlined fontSize="small" /></IconButton></Box></Tooltip>
          </InputAdornment>
        ) } }} />
      </Stack>
      <TextField fullWidth multiline minRows={3} label="Комментарий" value={leadDraft.description} onChange={(event) => onLeadDraftChange({ ...leadDraft, description: event.target.value })} />
      {recordings}
      <Stack direction="row" gap={1} alignItems="baseline">
        <Typography variant="body2" color="text.secondary">Дата</Typography>
        <Typography variant="body2">{formatShortDate(createdAt)}</Typography>
      </Stack>
      <Button onClick={() => setOpen(!open)} aria-expanded={open} endIcon={<ExpandMore sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: tokens.motion.fast }} />} sx={{ alignSelf: 'flex-start' }}>Дополнительные данные</Button>
      <Collapse in={open} unmountOnExit>
        <Stack gap={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5}><TextField fullWidth label="ИНН" value={draft.taxId} onChange={(event) => onDraftChange({ ...draft, taxId: event.target.value })} /><TextField fullWidth label="Контактное лицо" value={draft.personName} onChange={(event) => onDraftChange({ ...draft, personName: event.target.value })} /></Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5}><TextField fullWidth label="Должность" value={draft.position} onChange={(event) => onDraftChange({ ...draft, position: event.target.value })} /><TextField fullWidth label="Доп. телефон" value={draft.secondaryPhone} onChange={(event) => onDraftChange({ ...draft, secondaryPhone: event.target.value })} /></Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5}><TextField fullWidth label="E-mail" value={draft.email} onChange={(event) => onDraftChange({ ...draft, email: event.target.value })} /><TextField fullWidth label="Сайт" value={draft.website} onChange={(event) => onDraftChange({ ...draft, website: event.target.value })} /></Stack>
          <TextField fullWidth label="Ответственный" value={leadDraft.assignee} onChange={(event) => onLeadDraftChange({ ...leadDraft, assignee: event.target.value })} />
          <CustomFieldsEditor fields={customFields} draft={draft} onChange={onDraftChange} />
        </Stack>
      </Collapse>
    </Stack>
  );
}

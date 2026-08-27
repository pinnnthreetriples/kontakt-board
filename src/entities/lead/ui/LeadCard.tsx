import { useDraggable } from '@dnd-kit/core';
import { CalendarTodayOutlined, ChatBubbleOutline, ContentCopyOutlined, FlagOutlined, PhoneOutlined } from '@mui/icons-material';
import { Box, ButtonBase, Chip, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material';
import { tokens } from '../../../shared/design-system/tokens';
import { callDateLabel, formatShortDate, isDeadlineOverdue, isOverdue } from '../../../shared/lib/dates';
import { formatPhone } from '../../../shared/lib/phone';
import type { LeadPriority, LeadView } from '../../../shared/model/domain';
import { PRIORITY_LABELS } from '../model/lead-service';
import { tagChipSx, useTagColors } from '../../tag/model/useTagColors';
import { useState } from 'react';

interface LeadCardProps {
  view: LeadView;
  onOpen: (leadId: string) => void;
  compact?: boolean;
}

const PRIORITY_DOT_COLORS: Record<LeadPriority, string> = { high: 'error.main', normal: 'text.secondary', low: 'text.secondary' };

type CopyState = 'idle' | 'success' | 'error';
const COPY_TOOLTIPS: Record<CopyState, string> = { idle: 'Скопировать телефон', success: 'Номер скопирован', error: 'Не удалось скопировать' };
const COPY_LABELS: Record<CopyState, string> = { idle: 'Скопировать телефон', success: 'Номер скопирован', error: 'Скопировать телефон' };

function DeadlineRow({ deadline }: { deadline: string }) {
  const overdue = isDeadlineOverdue(deadline);
  return (
    <Stack direction="row" alignItems="center" spacing={0.75} mt={1} sx={{ color: overdue ? 'error.main' : 'text.secondary' }}>
      <FlagOutlined sx={{ fontSize: tokens.iconSize.small }} />
      <Typography variant="body2" fontWeight={overdue ? tokens.fontWeight.semibold : tokens.fontWeight.regular}>Срок: {formatShortDate(deadline)}</Typography>
    </Stack>
  );
}

export function LeadCard({ view, onOpen, compact = false }: LeadCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: view.lead.id, data: { lead: view.lead } });
  const callOverdue = view.nextCall ? isOverdue(view.nextCall.dueAt) : false;
  const title = view.contact.organization || view.contact.personName || 'Без названия';
  const priority = view.lead.priority ?? 'normal';
  const priorityLabel = priority === 'normal' ? '' : `Приоритет: ${PRIORITY_LABELS[priority].toLowerCase()}`;
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const tagColors = useTagColors();

  async function copyPhone(event: React.MouseEvent) {
    event.stopPropagation();
    try { await navigator.clipboard.writeText(view.contact.phone); setCopyState('success'); }
    catch { setCopyState('error'); }
  }

  return (
    <Paper
      ref={setNodeRef}
      sx={{
        border: 1,
        borderColor: isDragging ? 'primary.main' : 'divider',
        boxShadow: tokens.elevation.card,
        width: tokens.size.full,
        color: 'text.primary',
        position: 'relative',
        overflow: 'hidden',
        opacity: isDragging ? 0.55 : 1,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition: `border-color ${tokens.motion.fast}, box-shadow ${tokens.motion.fast}`,
        '&:hover': { borderColor: 'primary.main', boxShadow: tokens.elevation.cardHover },
      }}
    >
      <ButtonBase {...attributes} {...listeners} onClick={() => onOpen(view.lead.id)} aria-label={[`Открыть контакт ${title}`, priorityLabel].filter(Boolean).join('. ')} sx={{ display: 'block', width: tokens.size.full, p: compact ? 1.25 : 1.75, textAlign: 'left', cursor: isDragging ? 'grabbing' : 'grab', color: 'inherit', '&:focus-visible': { outline: tokens.focus.outline, outlineColor: 'primary.light', outlineOffset: tokens.focus.offset } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1} pr={4}>
          <Box minWidth={tokens.size.zero}>
            <Stack direction="row" alignItems="center" gap={0.75}>
              {priorityLabel && <Box component="span" aria-hidden title={priorityLabel} sx={{ bgcolor: PRIORITY_DOT_COLORS[priority], borderRadius: tokens.radiusCss.round, width: tokens.size.columnDot, height: tokens.size.columnDot, flexShrink: 0 }} />}
              <Typography fontWeight={tokens.fontWeight.bold} minWidth={tokens.size.zero} sx={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden' }}>{title}</Typography>
            </Stack>
            {view.contact.personName && view.contact.organization && <Typography variant="body2" color="text.secondary" noWrap>{view.contact.personName}</Typography>}
          </Box>
        </Stack>
        <Stack direction="row" alignItems="center" spacing={0.75} mt={compact ? 0.75 : 1.5} color="text.secondary"><PhoneOutlined sx={{ fontSize: tokens.iconSize.small }} /><Typography variant="body2">{formatPhone(view.contact.phone)}</Typography></Stack>
        {view.nextCall && <Stack direction="row" alignItems="center" spacing={0.75} mt={1} sx={{ color: callOverdue ? 'error.main' : 'text.secondary' }}><CalendarTodayOutlined sx={{ fontSize: tokens.iconSize.small }} /><Typography variant="body2" fontWeight={callOverdue ? tokens.fontWeight.semibold : tokens.fontWeight.regular}>{callOverdue ? 'Просрочено: ' : ''}{callDateLabel(view.nextCall.dueAt)}</Typography></Stack>}
        {view.lead.deadline ? <DeadlineRow deadline={view.lead.deadline} /> : null}
        <Stack direction="row" alignItems="center" mt={1.5} gap={0.75} flexWrap="wrap">{view.contact.tags.slice(0, 3).map((tag) => <Chip key={tag} label={tag} size="small" variant="outlined" sx={tagChipSx(tagColors.get(tag))} />)}{view.cardFields.map((field) => <Chip key={field.label} label={`${field.label}: ${field.value}`} size="small" variant="outlined" />)}{view.commentsCount > 0 && <Stack direction="row" alignItems="center" gap={0.4} ml="auto" color="text.secondary"><ChatBubbleOutline sx={{ fontSize: tokens.iconSize.compact }} /><Typography variant="caption">{view.commentsCount}</Typography></Stack>}</Stack>
      </ButtonBase>
      <Tooltip title={COPY_TOOLTIPS[copyState]}><Box component="span"><IconButton disabled={!view.contact.phone} size="small" aria-label={COPY_LABELS[copyState]} onClick={(event) => void copyPhone(event)} sx={{ position: 'absolute', top: tokens.inset.cardAction, right: tokens.inset.cardAction }}><ContentCopyOutlined fontSize="inherit" /></IconButton></Box></Tooltip>
    </Paper>
  );
}

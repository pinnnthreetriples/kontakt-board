import { useDroppable } from '@dnd-kit/core';
import { MoreHoriz, SwapVert } from '@mui/icons-material';
import { Box, Button, IconButton, Menu, MenuItem, Stack, Tooltip, Typography } from '@mui/material';
import { useState } from 'react';
import { LeadCard } from '../../entities/lead/ui/LeadCard';
import { tokens } from '../../shared/design-system/tokens';
import type { LeadView, Stage } from '../../shared/model/domain';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../infrastructure/database/database';

export type BoardSort = 'updated_desc' | 'created_desc' | 'call_asc' | 'name_asc';

interface KanbanColumnProps {
  stage: Stage;
  views: LeadView[];
  sort: BoardSort;
  onSort: (sort: BoardSort) => void;
  onOpen: (leadId: string) => void;
}

const sortLabels: Record<BoardSort, string> = {
  updated_desc: 'Сначала изменённые',
  created_desc: 'Сначала новые',
  call_asc: 'По времени звонка',
  name_asc: 'По названию',
};

export function KanbanColumn({ stage, views, sort, onSort, onOpen }: KanbanColumnProps) {
  const { isOver, setNodeRef } = useDroppable({ id: stage.id });
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(100);
  const compact = useLiveQuery(() => db.preferences.get('preferences'), [])?.compactMode ?? false;

  return (
    <Box ref={setNodeRef} sx={{ width: tokens.size.cardMinWidth, flex: `0 0 ${tokens.size.cardMinWidth}px`, p: 1.25, borderRadius: tokens.radiusCss.lg, bgcolor: isOver ? 'primary.light' : 'background.default', transition: `background ${tokens.motion.fast}` }}>
      <Stack direction="row" alignItems="center" px={0.5} mb={1.25} minHeight={tokens.size.columnHeader}>
        <Box sx={{ width: tokens.size.columnDot, height: tokens.size.columnDot, borderRadius: tokens.radiusCss.round, bgcolor: stage.color, mr: 1 }} />
        <Typography variant="subtitle1" noWrap>{stage.name}</Typography>
        <Typography variant="body2" color="text.secondary" ml={0.75}>{views.length}</Typography>
        <Tooltip title="Сортировка всей доски"><IconButton aria-label="Сортировка всей доски" size="small" sx={{ ml: 'auto' }} onClick={(event) => setAnchor(event.currentTarget)}><MoreHoriz /></IconButton></Tooltip>
      </Stack>
      <Stack gap={1.25} minHeight={tokens.size.columnBody}>
        {views.slice(0, visibleLimit).map((view) => <LeadCard key={view.lead.id} view={view} onOpen={onOpen} compact={compact} />)}
        {views.length > visibleLimit && <Button size="small" onClick={() => setVisibleLimit((value) => value + 100)}>Показать ещё {Math.min(100, views.length - visibleLimit)}</Button>}
        {views.length === 0 && <Box sx={{ p: 2.5, border: '1px dashed', borderColor: 'divider', borderRadius: tokens.radiusCss.md, textAlign: 'center' }}><Typography variant="body2" color="text.secondary">Перетащите карточку сюда</Typography></Box>}
      </Stack>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {Object.entries(sortLabels).map(([value, label]) => (
          <MenuItem key={value} selected={sort === value} onClick={() => { onSort(value as BoardSort); setAnchor(null); }}><SwapVert fontSize="small" sx={{ mr: 1 }} />{label}</MenuItem>
        ))}
      </Menu>
    </Box>
  );
}

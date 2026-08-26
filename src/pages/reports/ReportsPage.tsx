import { useMemo } from 'react';
import { AccessTimeOutlined, CheckCircleOutline, GroupsOutlined, PhoneMissedOutlined } from '@mui/icons-material';
import { Box, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import { useLiveQuery } from 'dexie-react-hooks';
import { getLeadViews } from '../../entities/lead/model/lead-service';
import { db } from '../../infrastructure/database/database';
import { isOverdue } from '../../shared/lib/dates';
import { useClock } from '../../shared/lib/useClock';
import type { CallTask, LeadView, Stage } from '../../shared/model/domain';
import { tokens } from '../../shared/design-system/tokens';

const EMPTY_VIEWS: LeadView[] = [];
const EMPTY_STAGES: Stage[] = [];
const EMPTY_CALLS: CallTask[] = [];

export function ReportsPage() {
  const views = useLiveQuery(() => getLeadViews(), []) ?? EMPTY_VIEWS;
  const stages = useLiveQuery(() => db.stages.filter((stage) => !stage.archived).sortBy('order'), []) ?? EMPTY_STAGES;
  const calls = useLiveQuery(() => db.calls.toArray(), []) ?? EMPTY_CALLS;
  const clock = useClock();
  const wonStageIds = new Set(stages.filter((stage) => stage.kind === 'won' || (!stage.kind && stage.name.toLowerCase().includes('продаж'))).map((stage) => stage.id));
  const stats = [
    { label: 'Всего заявок', value: views.length, icon: GroupsOutlined, color: 'primary.main' },
    { label: 'Продажи', value: views.filter((view) => wonStageIds.has(view.lead.stageId)).length, icon: CheckCircleOutline, color: 'success.main' },
    { label: 'Запланировано звонков', value: calls.filter((call) => !call.completedAt).length, icon: AccessTimeOutlined, color: 'warning.main' },
    { label: 'Просрочено', value: calls.filter((call) => !call.completedAt && isOverdue(call.dueAt, new Date(clock))).length, icon: PhoneMissedOutlined, color: 'error.main' },
  ];
  const maximum = useMemo(() => Math.max(1, ...stages.map((stage) => views.filter((view) => view.lead.stageId === stage.id).length)), [stages, views]);

  return (
    <Box sx={{ p: 3, maxWidth: tokens.size.contentWide }}>
      <Typography color="text.secondary" mb={2.5}>Простая сводка по текущей работе. Данные обновляются автоматически.</Typography>
      <Stack direction="row" gap={2}>
        {stats.map(({ label, value, icon: Icon, color }) => <Paper key={label} sx={{ flex: 1, p: 2.5, border: 1, borderColor: 'divider', borderRadius: tokens.radiusCss.lg }}><Stack direction="row" justifyContent="space-between"><Box><Typography color="text.secondary" variant="body2">{label}</Typography><Typography variant="h1" mt={1}>{value}</Typography></Box><Box sx={{ width: tokens.size.reportIcon, height: tokens.size.reportIcon, display: 'grid', placeItems: 'center', borderRadius: tokens.radiusCss.md, bgcolor: 'background.default', color }}><Icon /></Box></Stack></Paper>)}
      </Stack>
      <Paper sx={{ mt: 2, p: 3, border: 1, borderColor: 'divider', borderRadius: tokens.radiusCss.lg }}>
        <Typography variant="h2" mb={2.5}>Заявки по этапам</Typography>
        <Stack gap={2.25}>
          {stages.map((stage) => {
            const count = views.filter((view) => view.lead.stageId === stage.id).length;
            return <Box key={stage.id}><Stack direction="row" justifyContent="space-between" mb={0.75}><Typography variant="body2" fontWeight={tokens.fontWeight.semibold}>{stage.name}</Typography><Typography variant="body2" color="text.secondary">{count}</Typography></Stack><LinearProgress variant="determinate" value={(count / maximum) * 100} sx={{ height: tokens.size.progressBar, borderRadius: tokens.radiusCss.sm, '& .MuiLinearProgress-bar': { bgcolor: stage.color } }} /></Box>;
          })}
        </Stack>
      </Paper>
    </Box>
  );
}

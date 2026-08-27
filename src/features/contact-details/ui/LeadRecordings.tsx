import { Stack, Typography } from '@mui/material';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../infrastructure/database/database';
import { formatDateTime } from '../../../shared/lib/dates';
import type { CallRecording } from '../../../shared/model/domain';
import { RecordingPlayer } from './RecordingPlayer';

const NO_RECORDINGS: CallRecording[] = [];

export function LeadRecordings({ leadId }: { leadId: string }) {
  // Отдельный запрос, а не общая загрузка карточки: иначе любая правка заявки
  // пересоздаёт ссылки на файлы и сбрасывает воспроизведение.
  const recordings = useLiveQuery(() => db.recordings.where('leadId').equals(leadId).sortBy('recordedAt'), [leadId]);
  const list = recordings ?? NO_RECORDINGS;

  return (
    <Stack gap={0.5}>
      <Typography variant="subtitle2" color="text.secondary">Записи разговоров</Typography>
      {list.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {recordings === undefined ? 'Загрузка записей…' : 'Записей нет. Загрузите их на странице импорта.'}
        </Typography>
      ) : list.map((recording) => (
        <Stack key={recording.id}>
          <Typography variant="caption" color="text.secondary">{formatDateTime(recording.recordedAt)}</Typography>
          <RecordingPlayer recording={recording} />
        </Stack>
      ))}
    </Stack>
  );
}

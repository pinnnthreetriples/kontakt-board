import { useEffect, useRef, useState } from 'react';
import { SendOutlined } from '@mui/icons-material';
import { Alert, Box, IconButton, Stack, TextField, Typography } from '@mui/material';
import { tokens } from '../../../shared/design-system/tokens';
import { formatDateTime, formatDayLabel, formatTime } from '../../../shared/lib/dates';

export interface ChatEntry {
  id: string;
  kind: 'message' | 'event';
  text: string;
  author: string;
  createdAt: string;
}

interface LeadChatProps {
  entries: ChatEntry[];
  currentAuthor: string;
  busy: boolean;
  onSend: (text: string) => Promise<void>;
}

interface DayGroup {
  key: string;
  label: string;
  items: ChatEntry[];
}

function groupByDay(entries: ChatEntry[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const entry of entries) {
    const key = entry.createdAt.slice(0, 10);
    const last = groups.at(-1);
    if (last && last.key === key) last.items.push(entry);
    else groups.push({ key, label: formatDayLabel(entry.createdAt), items: [entry] });
  }
  return groups;
}

const WRAP = { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } as const;

function EventRow({ entry }: { entry: ChatEntry }) {
  return (
    <Stack direction="row" gap={1} px={1} py={0.25}>
      <Typography variant="caption" color="text.secondary">{formatTime(entry.createdAt)}</Typography>
      <Typography variant="caption" color="text.secondary" fontWeight={tokens.fontWeight.navigation}>{entry.author}</Typography>
      <Typography variant="caption" color="text.secondary" sx={WRAP}>{entry.text}</Typography>
    </Stack>
  );
}

function MessageBubble({ entry, own }: { entry: ChatEntry; own: boolean }) {
  return (
    <Stack alignItems={own ? 'flex-end' : 'flex-start'} gap={0.25}>
      <Typography variant="caption" color="text.secondary" px={1}>{entry.author}</Typography>
      <Box sx={{ maxWidth: tokens.size.chatBubbleMax, px: 1.5, py: 1, borderRadius: tokens.radius.lg, bgcolor: own ? 'action.selected' : 'action.hover' }}>
        <Typography variant="body2" sx={WRAP}>{entry.text}</Typography>
        <Typography variant="caption" color="text.secondary" component="div" mt={0.5}>{formatDateTime(entry.createdAt)}</Typography>
      </Box>
    </Stack>
  );
}

export function LeadChat({ entries, currentAuthor, busy, onSend }: LeadChatProps) {
  const [text, setText] = useState('');
  const [failed, setFailed] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = viewportRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [entries.length]);

  async function send() {
    const value = text.trim();
    if (!value || busy) return;
    setFailed(false);
    try {
      await onSend(value);
      setText('');
    } catch {
      setFailed(true);
    }
  }

  return (
    <Stack gap={1.5}>
      <Box ref={viewportRef} sx={{ maxHeight: tokens.size.chatViewport, overflowY: 'auto', pr: 0.5 }}>
        {entries.length === 0 ? (
          <Typography variant="body2" color="text.secondary" align="center" py={4}>Сообщений пока нет. Напишите первое.</Typography>
        ) : groupByDay(entries).map((group) => (
          <Stack key={group.key} gap={1} pb={1}>
            <Typography variant="caption" color="text.secondary" align="center" pt={1}>{group.label}</Typography>
            {group.items.map((entry) => entry.kind === 'event'
              ? <EventRow key={entry.id} entry={entry} />
              : <MessageBubble key={entry.id} entry={entry} own={entry.author === currentAuthor} />)}
          </Stack>
        ))}
      </Box>
      {failed && <Alert severity="error" onClose={() => setFailed(false)}>Не удалось отправить сообщение.</Alert>}
      <Stack direction="row" gap={1} alignItems="flex-start">
        <TextField
          fullWidth multiline maxRows={6} size="small" placeholder="Отправить сообщение"
          slotProps={{ htmlInput: { 'aria-label': 'Отправить сообщение' } }}
          value={text} disabled={busy} onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }}
          helperText="Enter — отправить, Shift+Enter — новая строка"
        />
        <IconButton aria-label="Отправить сообщение" color="primary" disabled={busy || !text.trim()} onClick={() => void send()}><SendOutlined /></IconButton>
      </Stack>
    </Stack>
  );
}

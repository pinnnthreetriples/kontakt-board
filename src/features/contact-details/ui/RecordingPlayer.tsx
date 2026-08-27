import { useEffect, useRef, useState } from 'react';
import { DownloadOutlined, PauseRounded, PlayArrowRounded } from '@mui/icons-material';
import { Box, Button, IconButton, Slider, Stack, Tooltip, Typography } from '@mui/material';
import { tokens } from '../../../shared/design-system/tokens';
import { formatDateTime } from '../../../shared/lib/dates';
import type { CallRecording } from '../../../shared/model/domain';

const RATES = [1, 1.25, 1.5, 2];
const NUMERIC = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const;

function timeLabel(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function RecordingPlayer({ recording }: { recording: CallRecording }) {
  const audio = useRef<HTMLAudioElement>(null);
  // Объектный URL создаётся один раз на плеер и освобождается при размонтировании.
  const [url] = useState(() => URL.createObjectURL(recording.blob));
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(RATES[0] ?? 1);
  const label = formatDateTime(recording.recordedAt);

  useEffect(() => () => { URL.revokeObjectURL(url); }, [url]);

  useEffect(() => {
    const element = audio.current;
    if (element) element.playbackRate = rate;
  }, [rate]);

  function toggle() {
    const element = audio.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => setPlaying(false));
    else element.pause();
  }

  function seek(seconds: number) {
    const element = audio.current;
    if (element) element.currentTime = seconds;
    setPosition(seconds);
  }

  return (
    <Stack
      direction="row"
      alignItems="center"
      gap={1}
      sx={{ px: 1, py: 0.5, borderRadius: tokens.radiusCss.md, bgcolor: 'action.hover' }}
    >
      {/* У Material UI нет компонента для аудио: скрытый штатный элемент играет, а управление собрано из MUI. */}
      <Box
        component="audio"
        ref={audio}
        src={url}
        preload="metadata"
        sx={{ display: 'none' }}
        onLoadedMetadata={(event: React.SyntheticEvent<HTMLAudioElement>) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event: React.SyntheticEvent<HTMLAudioElement>) => setPosition(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setPosition(0); }}
      />
      <IconButton color="primary" size="small" aria-label={playing ? `Пауза, запись разговора ${label}` : `Слушать запись разговора ${label}`} onClick={toggle}>
        {playing ? <PauseRounded /> : <PlayArrowRounded />}
      </IconButton>
      <Slider
        size="small"
        value={Math.min(position, duration)}
        max={duration || 1}
        aria-label={`Позиция записи разговора ${label}`}
        onChange={(_, value) => seek(typeof value === 'number' ? value : 0)}
      />
      <Typography variant="caption" color="text.secondary" sx={NUMERIC}>{timeLabel(position)} / {timeLabel(duration)}</Typography>
      <Tooltip title="Скорость воспроизведения">
        <Button
          size="small"
          color="inherit"
          aria-label={`Скорость воспроизведения ${rate.toLocaleString('ru-RU')}`}
          onClick={() => setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length] ?? 1)}
          sx={NUMERIC}
        >
          {rate.toLocaleString('ru-RU')}&times;
        </Button>
      </Tooltip>
      <Tooltip title="Скачать запись">
        <IconButton size="small" component="a" href={url} download={recording.fileName} aria-label={`Скачать запись разговора ${label}`}>
          <DownloadOutlined fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

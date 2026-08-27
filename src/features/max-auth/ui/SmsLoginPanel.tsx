import { useState } from 'react';
import { Button, Stack, TextField, Typography } from '@mui/material';

interface SmsLoginPanelProps {
  /** `phone` — просим номер, `code` — MAX уже отправил SMS и ждёт код. */
  stage: 'phone' | 'code';
  busy: boolean;
  onStart: (phone: string) => void;
  onSubmitCode: (code: string) => void;
  onCancel: () => void;
}

/**
 * Запасной вход для случая, когда отсканировать QR-код нечем: например, сканера
 * не нашлось в мобильном приложении. Номер и код мост приводит к своему формату
 * сам, поэтому здесь нет ни масок, ни собственной проверки.
 */
export function SmsLoginPanel({ stage, busy, onStart, onSubmitCode, onCancel }: SmsLoginPanelProps) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');

  if (stage === 'code') {
    return (
      <Stack gap={1}>
        <Typography variant="body2" color="text.secondary">MAX отправил код в SMS на указанный номер.</Typography>
        <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
          <TextField
            label="Код из SMS"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            disabled={busy}
            slotProps={{ htmlInput: { inputMode: 'numeric', autoComplete: 'one-time-code' } }}
          />
          <Button variant="contained" disabled={busy || code.trim() === ''} onClick={() => onSubmitCode(code)}>Подтвердить</Button>
          <Button disabled={busy} onClick={onCancel}>Отмена</Button>
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack gap={1}>
      <Typography variant="body2" color="text.secondary">Нечем отсканировать код? Войдите по номеру телефона, MAX пришлёт код в SMS.</Typography>
      <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
        <TextField
          label="Номер телефона"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          disabled={busy}
          slotProps={{ htmlInput: { inputMode: 'tel', autoComplete: 'tel' } }}
        />
        <Button variant="outlined" disabled={busy || phone.trim() === ''} onClick={() => onStart(phone)}>Получить код</Button>
      </Stack>
    </Stack>
  );
}

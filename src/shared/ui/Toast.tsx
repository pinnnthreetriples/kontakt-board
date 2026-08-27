import type { ReactNode } from 'react';
import { CheckCircleOutlined, Close, ErrorOutline, InfoOutlined, WarningAmberOutlined } from '@mui/icons-material';
import { IconButton, Snackbar, Stack } from '@mui/material';
import type { AlertColor } from '@mui/material';

type ToastProps = {
  open: boolean;
  severity: AlertColor;
  message: ReactNode;
  onClose: () => void;
  action?: ReactNode;
};

// Поверхность тоста нейтральная, как и положено снекбару: тип сообщения передаёт
// иконка, а не цвет фона. Заливка severity-цветом на всю плашку слишком криклива.
const SEVERITY_ICONS: Record<AlertColor, ReactNode> = {
  success: <CheckCircleOutlined fontSize="small" color="success" />,
  info: <InfoOutlined fontSize="small" color="info" />,
  warning: <WarningAmberOutlined fontSize="small" color="warning" />,
  error: <ErrorOutline fontSize="small" color="error" />,
};

/**
 * Единственная обёртка над `Snackbar` в проекте. Готового компонента с нужным
 * поведением в MUI нет: `Snackbar` не задаёт ни общий якорь, ни кнопку закрытия,
 * а положение тостов обязано быть одинаковым во всём приложении. Обёртка
 * фиксирует правый нижний угол и добавляет кнопку закрытия рядом с действием.
 */
const TOAST_MS = 3_000;

export function Toast({ open, severity, message, onClose, action }: ToastProps) {
  return (
    <Snackbar
      open={open}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      autoHideDuration={TOAST_MS}
      onClose={(_, reason) => { if (reason !== 'clickaway') onClose(); }}
      slotProps={{ content: { role: 'alert' } }}
      message={<Stack direction="row" alignItems="center" gap={1}>{SEVERITY_ICONS[severity]}{message}</Stack>}
      action={(
        <Stack direction="row" alignItems="center" gap={0.5}>
          {action}
          <IconButton size="small" color="inherit" aria-label="Закрыть уведомление" onClick={onClose}><Close fontSize="small" /></IconButton>
        </Stack>
      )}
    />
  );
}

import { format, isSameDay, isTomorrow, isValid, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';

export function formatDateTime(value: string): string {
  return format(parseISO(value), 'd MMM, HH:mm', { locale: ru });
}

export function formatShortDate(value: string): string {
  return format(parseISO(value), 'dd.MM.yyyy', { locale: ru });
}

export function callDateLabel(value: string, now = new Date()): string {
  const date = parseISO(value);
  if (isSameDay(date, now)) return `Сегодня, ${format(date, 'HH:mm')}`;
  if (isTomorrow(date)) return `Завтра, ${format(date, 'HH:mm')}`;
  return formatDateTime(value);
}

export function isOverdue(value: string, now = new Date()): boolean {
  return parseISO(value).getTime() < now.getTime();
}

/** Срок сравнивается по дню: заявка со сроком «сегодня» ещё не просрочена. */
export function isDeadlineOverdue(value: string, now = new Date()): boolean {
  return value !== '' && value < toDateInputValue(now).slice(0, 10);
}

export function toDateInputValue(date: Date): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

/** Пикеры MUI работают с Date, а в базе лежат строки: `''` означает «не задано». */
export function parseDateValue(value: string): Date | null {
  const date = parseISO(value);
  return value !== '' && isValid(date) ? date : null;
}

export function formatDateValue(date: Date | null): string {
  return date && isValid(date) ? format(date, 'yyyy-MM-dd') : '';
}

export function formatDateTimeValue(date: Date | null): string {
  return date && isValid(date) ? toDateInputValue(date) : '';
}

export function formatDayLabel(value: string): string {
  return format(parseISO(value), 'd MMMM', { locale: ru });
}

export function formatTime(value: string): string {
  return format(parseISO(value), 'HH:mm', { locale: ru });
}

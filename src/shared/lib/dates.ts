import { format, isSameDay, isTomorrow, parseISO } from 'date-fns';
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

export function toDateInputValue(date: Date): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export function formatDayLabel(value: string): string {
  return format(parseISO(value), 'd MMMM', { locale: ru });
}

export function formatTime(value: string): string {
  return format(parseISO(value), 'HH:mm', { locale: ru });
}

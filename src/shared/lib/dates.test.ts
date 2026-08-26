import { describe, expect, it } from 'vitest';
import { callDateLabel, formatDateTime, formatDayLabel, formatShortDate, formatTime, isOverdue, toDateInputValue } from './dates';

// Даты собираются в местном поясе и форматируются в нём же, поэтому тест
// одинаково работает и в Москве, и в UTC на CI.
function local(year: number, month: number, day: number, hours = 0, minutes = 0): Date {
  return new Date(year, month - 1, day, hours, minutes);
}

describe('форматирование дат', () => {
  it('показывает дату и время в коротком русском виде', () => {
    expect(formatDateTime(local(2026, 8, 26, 19, 5).toISOString())).toBe('26 авг., 19:05');
    expect(formatShortDate(local(2026, 8, 6).toISOString())).toBe('06.08.2026');
    expect(formatDayLabel(local(2026, 8, 26).toISOString())).toBe('26 августа');
    expect(formatTime(local(2026, 8, 26, 9, 7).toISOString())).toBe('09:07');
  });

  it('переводит дату в значение для поля ввода без сдвига пояса', () => {
    expect(toDateInputValue(local(2026, 8, 26, 19, 5))).toBe('2026-08-26T19:05');
    expect(toDateInputValue(local(2026, 1, 1, 0, 0))).toBe('2026-01-01T00:00');
  });
});

describe('callDateLabel', () => {
  it('называет сегодняшний и завтрашний звонок словами', () => {
    expect(callDateLabel(local(2026, 8, 26, 19, 5).toISOString(), local(2026, 8, 26, 8, 0))).toBe('Сегодня, 19:05');
    expect(callDateLabel(new Date(Date.now() + 86_400_000).toISOString())).toMatch(/^Завтра, \d{2}:\d{2}$/);
  });

  it('для остальных дат показывает полную подпись', () => {
    expect(callDateLabel(local(2026, 8, 26, 19, 5).toISOString(), local(2026, 1, 1))).toBe('26 авг., 19:05');
  });
});

describe('isOverdue', () => {
  it('считает просроченным только прошедшее время', () => {
    const now = local(2026, 8, 26, 12, 0);
    expect(isOverdue(local(2026, 8, 26, 11, 59).toISOString(), now)).toBe(true);
    expect(isOverdue(local(2026, 8, 26, 12, 1).toISOString(), now)).toBe(false);
  });

  it('момент «прямо сейчас» ещё не просрочен', () => {
    const now = local(2026, 8, 26, 12, 0);
    expect(isOverdue(now.toISOString(), now)).toBe(false);
  });
});

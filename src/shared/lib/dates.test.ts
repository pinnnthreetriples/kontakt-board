import { describe, expect, it } from 'vitest';
import { callDateLabel, formatDateTime, formatDateTimeValue, formatDateValue, formatDayLabel, formatShortDate, formatTime, isDeadlineOverdue, isOverdue, parseDateValue, toDateInputValue } from './dates';

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

describe('значения для пикеров', () => {
  it('переводит строку в дату и обратно', () => {
    const date = parseDateValue('2026-08-31');
    expect(date).toEqual(local(2026, 8, 31));
    expect(formatDateValue(date)).toBe('2026-08-31');
    expect(formatDateTimeValue(local(2026, 8, 31, 9, 5))).toBe('2026-08-31T09:05');
  });

  it('пустое и некорректное значение считает «не задано»', () => {
    expect(parseDateValue('')).toBeNull();
    expect(parseDateValue('не дата')).toBeNull();
    expect(formatDateValue(null)).toBe('');
    expect(formatDateValue(new Date(Number.NaN))).toBe('');
    expect(formatDateTimeValue(null)).toBe('');
  });
});

describe('isDeadlineOverdue', () => {
  it('срок сравнивается по дню, а не по времени', () => {
    const now = local(2026, 8, 26, 12, 0);
    expect(isDeadlineOverdue('2026-08-25', now)).toBe(true);
    expect(isDeadlineOverdue('2026-08-26', now)).toBe(false);
    expect(isDeadlineOverdue('2026-08-27', now)).toBe(false);
  });

  it('пустой срок не считается просроченным', () => {
    expect(isDeadlineOverdue('', local(2026, 8, 26))).toBe(false);
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

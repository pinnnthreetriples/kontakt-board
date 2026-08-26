import { describe, expect, it } from 'vitest';
import { formatPhone, normalizePhone } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['+7 (909) 322-87-04', '79093228704'],
    ['8 909 322 87 04', '79093228704'],
    [79093228704, '79093228704'],
    ['', ''],
  ])('нормализует %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('не придумывает цифры короткому значению', () => {
    expect(normalizePhone('123-45')).toBe('12345');
  });
});

describe('formatPhone', () => {
  it('показывает российский номер одинаково', () => {
    expect(formatPhone('79093228704')).toBe('+7 909 322-87-04');
  });

  it('оставляет нестандартный номер без изменений', () => {
    expect(formatPhone('+41 44 668 18 00')).toBe('+41 44 668 18 00');
  });
});

describe('нечисловые значения', () => {
  it('не пытается разобрать значение чужого типа', () => {
    expect(normalizePhone(null)).toBe('');
    expect(normalizePhone(undefined)).toBe('');
    expect(normalizePhone({ phone: '79093228704' })).toBe('');
  });

  it('говорит вслух, что телефона нет', () => {
    expect(formatPhone('')).toBe('Телефон не указан');
  });

  it('не выдаёт за российский номер чужой одиннадцатизначный', () => {
    expect(formatPhone('19093228704')).toBe('19093228704');
  });
});

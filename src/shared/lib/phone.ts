const PHONE_DIGITS_MIN = 10;

export function normalizePhone(value: unknown): string {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  const digits = text.replace(/\D/g, '');
  if (digits.length < PHONE_DIGITS_MIN) return digits;
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  return digits;
}

export function formatPhone(value: string): string {
  const digits = normalizePhone(value);
  if (digits.length !== 11 || !digits.startsWith('7')) return value || 'Телефон не указан';
  return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
}

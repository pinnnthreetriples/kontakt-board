import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../../infrastructure/database/database';
import { resetDatabase } from '../../../test/fixtures';
import { createCustomField, updateCustomField, updatePreferences } from './settings-service';

beforeEach(resetDatabase);

describe('settings-service', () => {
  it('создаёт и обновляет пользовательское поле', async () => {
    await createCustomField('  Бюджет  ', 'number');
    const field = await db.customFields.where('name').equals('Бюджет').first();
    expect(field).toBeDefined();
    await updateCustomField(field!.id, { showOnCard: true });
    expect((await db.customFields.get(field!.id))?.showOnCard).toBe(true);
  });

  it('не принимает пустое имя поля', async () => {
    await expect(createCustomField('  ', 'text')).rejects.toThrow('Введите название');
  });

  it('ограничивает интервал напоминания диапазоном суток', async () => {
    await updatePreferences({ notifyMinutesBefore: 99_999, ownerName: '  ' });
    const preferences = await db.preferences.get('preferences');
    expect(preferences?.notifyMinutesBefore).toBe(1_440);
    expect(preferences?.ownerName).toBe('Я');
  });

  it('не сохраняет нечисловой интервал напоминания', async () => {
    await expect(updatePreferences({ notifyMinutesBefore: Number.NaN })).rejects.toThrow('должен быть числом');
    expect((await db.preferences.get('preferences'))?.notifyMinutesBefore).toBe(15);
  });

  it('не обновляет несуществующее поле', async () => {
    await expect(updateCustomField('нет такого поля', { showOnCard: true })).rejects.toThrow('не найдено');
  });

  it('не даёт стереть название поля', async () => {
    await createCustomField('Бюджет', 'number');
    const field = (await db.customFields.toArray())[0]!;

    await expect(updateCustomField(field.id, { name: '   ' })).rejects.toThrow('не может быть пустым');
    expect((await db.customFields.get(field.id))?.name).toBe('Бюджет');
  });

  it('обрезает пробелы в новом названии поля', async () => {
    await createCustomField('Бюджет', 'number');
    const field = (await db.customFields.toArray())[0]!;

    await updateCustomField(field.id, { name: '  Сумма сделки  ' });

    expect((await db.customFields.get(field.id))?.name).toBe('Сумма сделки');
  });

  it('восстанавливает настройки по умолчанию, если записи нет', async () => {
    await db.preferences.clear();

    await updatePreferences({ compactMode: true });

    expect(await db.preferences.get('preferences')).toMatchObject({ ownerName: 'Я', compactMode: true, notifyMinutesBefore: 15 });
  });
});

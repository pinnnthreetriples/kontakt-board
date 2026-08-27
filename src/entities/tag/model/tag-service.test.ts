import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../../infrastructure/database/database';
import { stageColors } from '../../../shared/design-system/tokens';
import { createLeadFixture, resetDatabase } from '../../../test/fixtures';
import { createTag, ensureTagColors, setContactTags, TagExistsError, TagNameError } from './tag-service';

describe('tag-service', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('создаёт тег с цветом и сохраняет его в справочнике', async () => {
    const tag = await createTag('Оптовик');

    expect(tag.name).toBe('Оптовик');
    expect(tag.color).not.toBe('');
    await expect(db.tags.get(tag.id)).resolves.toMatchObject({ name: 'Оптовик' });
  });

  it('берёт цвет, выбранный при создании', async () => {
    const chosen = stageColors[4];

    const tag = await createTag('Оптовик', chosen);

    expect(tag.color).toBe(chosen);
    await expect(db.tags.get(tag.id)).resolves.toMatchObject({ color: chosen });
  });

  it('заводит цвета только для новых имён и не трогает существующие', async () => {
    const existing = await createTag('Оптовик', stageColors[4]);

    await ensureTagColors(['Оптовик', ' Розница ', 'Розница', '']);

    const tags = await db.tags.toArray();
    expect(tags).toHaveLength(2);
    expect(tags.find((tag) => tag.name === 'Оптовик')?.color).toBe(existing.color);
    expect(tags.find((tag) => tag.name === 'Розница')?.color).toBeTruthy();
  });

  it('обрезает пробелы в названии тега', async () => {
    const tag = await createTag('  Розница  ');

    expect(tag.name).toBe('Розница');
  });

  it('отказывает при дубликате имени', async () => {
    await createTag('Оптовик');

    await expect(createTag('Оптовик')).rejects.toBeInstanceOf(TagExistsError);
    await expect(db.tags.count()).resolves.toBe(1);
  });

  it('отказывает при пустом имени', async () => {
    await expect(createTag('   ')).rejects.toBeInstanceOf(TagNameError);
    await expect(db.tags.count()).resolves.toBe(0);
  });

  it('setContactTags убирает дубли и пустые строки', async () => {
    const { contact } = await createLeadFixture();

    await setContactTags(contact.id, ['Оптовик', ' Оптовик ', '', '   ', 'Розница']);

    const saved = await db.contacts.get(contact.id);
    expect(saved?.tags).toEqual(['Оптовик', 'Розница']);
  });

  it('setContactTags обновляет отметку времени', async () => {
    const { contact } = await createLeadFixture();

    await setContactTags(contact.id, ['Оптовик']);

    const saved = await db.contacts.get(contact.id);
    expect(saved?.updatedAt).not.toBe('');
  });

});

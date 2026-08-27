import { db } from '../../../infrastructure/database/database';
import { createId } from '../../../shared/lib/ids';
import { stageColors } from '../../../shared/design-system/tokens';
import type { Tag } from '../../../shared/model/domain';

export class TagExistsError extends Error {
  constructor() { super('Такой тег уже есть'); }
}

export class TagNameError extends Error {
  constructor() { super('Название тега не может быть пустым'); }
}

export function nextTagColor(used: number): string {
  return stageColors[used % stageColors.length] ?? stageColors[0];
}

export async function createTag(name: string, color?: string): Promise<Tag> {
  const value = name.trim();
  if (!value) throw new TagNameError();
  return db.transaction('rw', db.tags, async () => {
    const existing = await db.tags.where('name').equals(value).first();
    if (existing) throw new TagExistsError();
    const tag: Tag = { id: createId(), name: value, color: color ?? nextTagColor(await db.tags.count()) };
    await db.tags.add(tag);
    return tag;
  });
}

/** Заводит цвета для тегов, пришедших из импорта: без записи в справочнике чип остаётся серым. */
export async function ensureTagColors(names: string[]): Promise<void> {
  const existing = new Set((await db.tags.toArray()).map((tag) => tag.name));
  const missing = [...new Set(names.map((name) => name.trim()))].filter((name) => name && !existing.has(name));
  if (missing.length === 0) return;
  await db.tags.bulkAdd(missing.map((name, index) => ({ id: createId(), name, color: nextTagColor(existing.size + index) })));
}

export async function setContactTags(contactId: string, tags: string[]): Promise<void> {
  const unique = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
  await db.contacts.update(contactId, { tags: unique, updatedAt: new Date().toISOString() });
}

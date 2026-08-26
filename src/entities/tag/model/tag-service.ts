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

export async function createTag(name: string): Promise<Tag> {
  const value = name.trim();
  if (!value) throw new TagNameError();
  return db.transaction('rw', db.tags, async () => {
    const existing = await db.tags.where('name').equals(value).first();
    if (existing) throw new TagExistsError();
    const used = await db.tags.count();
    const tag: Tag = { id: createId(), name: value, color: stageColors[used % stageColors.length] ?? stageColors[0] };
    await db.tags.add(tag);
    return tag;
  });
}

export async function setContactTags(contactId: string, tags: string[]): Promise<void> {
  const unique = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
  await db.contacts.update(contactId, { tags: unique, updatedAt: new Date().toISOString() });
}

import { db } from '../../../infrastructure/database/database';
import { createId } from '../../../shared/lib/ids';
import type { AppPreferences, CustomFieldDefinition, CustomFieldType } from '../../../shared/model/domain';

const DEFAULT_PREFERENCES: AppPreferences = {
  id: 'preferences',
  ownerName: 'Я',
  compactMode: false,
  notifyMinutesBefore: 15,
};

export async function createCustomField(name: string, type: CustomFieldType): Promise<void> {
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error('Введите название поля.');
  await db.customFields.add({
    id: createId(),
    name: normalizedName,
    type,
    showOnCard: false,
    filterable: false,
    archived: false,
  });
}

export async function updateCustomField(id: string, changes: Partial<Pick<CustomFieldDefinition, 'name' | 'showOnCard' | 'filterable' | 'archived'>>): Promise<void> {
  const field = await db.customFields.get(id);
  if (!field) throw new Error('Пользовательское поле не найдено.');
  const normalized = changes.name === undefined ? changes : { ...changes, name: changes.name.trim() };
  if (normalized.name === '') throw new Error('Название поля не может быть пустым.');
  await db.customFields.update(id, normalized);
}

export async function updatePreferences(changes: Partial<Omit<AppPreferences, 'id'>>): Promise<void> {
  if (changes.notifyMinutesBefore !== undefined && !Number.isFinite(changes.notifyMinutesBefore)) {
    throw new Error('Интервал напоминания должен быть числом.');
  }
  const current = await db.preferences.get('preferences') ?? DEFAULT_PREFERENCES;
  const next = { ...current, ...changes };
  next.ownerName = next.ownerName.trim() || DEFAULT_PREFERENCES.ownerName;
  next.notifyMinutesBefore = Math.min(1_440, Math.max(0, Math.round(next.notifyMinutesBefore)));
  await db.preferences.put(next);
}

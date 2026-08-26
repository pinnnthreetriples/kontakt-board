import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { ContactBoardDatabase } from './database';
import type { Contact, Lead, Stage, Tag } from '../../shared/model/domain';

// Схема версий 2-5: та же, что в приложении, но ещё без справочника тегов и приоритета.
const SCHEMA_V5 = {
  contacts: 'id, organization, personName, phone, normalizedPhone, email, updatedAt, *tags',
  leads: 'id, contactId, stageId, externalId, &externalKey, source, assignee, createdAt, updatedAt',
  stages: 'id, order, archived', comments: 'id, leadId, createdAt', activities: 'id, leadId, kind, createdAt',
  calls: 'id, leadId, dueAt, completedAt, createdAt', customFields: 'id, name, archived', importJobs: 'id, createdAt', preferences: 'id',
};

function legacyContact(id: string, tags: string[]): Contact {
  const now = new Date().toISOString();
  return {
    id, organization: id, taxId: '', personName: '', position: '', phone: '', normalizedPhone: '', secondaryPhone: '',
    email: '', address: '', region: '', website: '', tags, customValues: {}, createdAt: now, updatedAt: now,
  };
}

function legacyLead(id: string, stageId: string): Lead {
  const now = new Date().toISOString();
  return { id, contactId: 'contact', stageId, externalId: id, externalKey: `excel::${id}`, source: 'Excel', result: '', description: '', assignee: 'Я', createdAt: now, updatedAt: now };
}

const TEST_DATABASE = 'contact-board-migration-test';

afterEach(async () => { await Dexie.delete(TEST_DATABASE); });

describe('database migrations', () => {
  it('безопасно добавляет externalKey и назначение стандартных этапов', async () => {
    const legacy = new Dexie(TEST_DATABASE);
    legacy.version(1).stores({
      contacts: 'id, organization, personName, phone, normalizedPhone, email, updatedAt, *tags',
      leads: 'id, contactId, stageId, externalId, source, assignee, createdAt, updatedAt',
      stages: 'id, order, archived', comments: 'id, leadId, createdAt', activities: 'id, leadId, kind, createdAt',
      calls: 'id, leadId, dueAt, completedAt, createdAt', customFields: 'id, name, archived', importJobs: 'id, createdAt', preferences: 'id',
    });
    await legacy.open();
    const now = new Date().toISOString();
    const lead = (id: string, stageId: string): Lead => ({ id, contactId: 'contact', stageId, externalId: 'duplicate', source: 'Excel', result: '', description: '', assignee: 'Я', createdAt: now, updatedAt: now });
    await legacy.table<Lead>('leads').bulkAdd([lead('lead-1', 'stage-won'), lead('lead-2', 'stage-archived')]);
    await legacy.table<Stage>('stages').bulkAdd([
      { id: 'stage-won', name: 'Переименованный успех', color: 'black', order: 7, archived: false },
      { id: 'stage-archived', name: 'Старый', color: 'gray', order: 1, archived: true },
    ]);
    legacy.close();

    const migrated = new ContactBoardDatabase(TEST_DATABASE);
    await migrated.open();
    const leads = await migrated.leads.toArray();
    expect(leads.filter((item) => item.externalKey === 'excel::duplicate')).toHaveLength(1);
    expect(leads.every((item) => Boolean(item.externalKey))).toBe(true);
    expect(new Set(leads.map((item) => item.externalKey)).size).toBe(2);
    expect(leads.every((item) => item.externalKey === `${item.source.trim().toLowerCase()}::${item.externalId.trim()}`)).toBe(true);
    expect(leads.every((item) => item.stageId === 'stage-won')).toBe(true);
    expect((await migrated.stages.get('stage-won'))?.kind).toBe('won');
    expect((await migrated.stages.get('stage-won'))?.order).toBe(0);
    migrated.close();
  });

  it('исправляет порядок, системные типы и связи этапов при переходе с версии 4', async () => {
    const legacy = new Dexie(TEST_DATABASE);
    legacy.version(4).stores({
      contacts: 'id, organization, personName, phone, normalizedPhone, email, updatedAt, *tags',
      leads: 'id, contactId, stageId, externalId, &externalKey, source, assignee, createdAt, updatedAt',
      stages: 'id, order, archived', comments: 'id, leadId, createdAt', activities: 'id, leadId, kind, createdAt',
      calls: 'id, leadId, dueAt, completedAt, createdAt', customFields: 'id, name, archived', importJobs: 'id, createdAt', preferences: 'id',
    });
    await legacy.open();
    const now = new Date().toISOString();
    await legacy.table<Stage>('stages').bulkAdd([
      { id: 'first', name: 'Первый', color: 'black', order: 9, archived: false, kind: 'won' },
      { id: 'second', name: 'Второй', color: 'gray', order: 9, archived: false, kind: 'won' },
      { id: 'old', name: 'Архив', color: 'gray', order: 0, archived: true, kind: 'normal' },
    ]);
    await legacy.table<Lead>('leads').add({ id: 'lead', contactId: 'contact', stageId: 'old', externalId: 'id', externalKey: 'excel::id', source: 'Excel', result: '', description: '', assignee: 'Я', createdAt: now, updatedAt: now });
    legacy.close();

    const migrated = new ContactBoardDatabase(TEST_DATABASE);
    await migrated.open();
    const active = await migrated.stages.filter((stage) => !stage.archived).sortBy('order');
    expect(active.map((stage) => stage.order)).toEqual([0, 1]);
    expect(active.filter((stage) => stage.kind === 'won')).toHaveLength(1);
    expect((await migrated.leads.get('lead'))?.stageId).toBe(active[0]!.id);
    migrated.close();
  });

  it('собирает справочник тегов из контактов и проставляет средний приоритет', async () => {
    const legacy = new Dexie(TEST_DATABASE);
    legacy.version(5).stores(SCHEMA_V5);
    await legacy.open();
    await legacy.table<Contact>('contacts').bulkAdd([
      legacyContact('contact', ['Оптовик', 'Розница']),
      legacyContact('contact-2', ['Оптовик', '']),
    ]);
    await legacy.table<Stage>('stages').add({ id: 'stage-new', name: 'Новая заявка', color: 'black', order: 0, archived: false, kind: 'normal' });
    await legacy.table<Lead>('leads').add(legacyLead('lead', 'stage-new'));
    legacy.close();

    const migrated = new ContactBoardDatabase(TEST_DATABASE);
    await migrated.open();
    const tags = await migrated.tags.toArray();
    expect(tags.map((tag: Tag) => tag.name).sort()).toEqual(['Оптовик', 'Розница']);
    expect(tags.every((tag: Tag) => tag.color !== '')).toBe(true);
    expect((await migrated.leads.get('lead'))?.priority).toBe('normal');
    migrated.close();
  });

  it('не трогает уже выставленный приоритет заявки', async () => {
    const legacy = new Dexie(TEST_DATABASE);
    legacy.version(5).stores(SCHEMA_V5);
    await legacy.open();
    await legacy.table<Stage>('stages').add({ id: 'stage-new', name: 'Новая заявка', color: 'black', order: 0, archived: false, kind: 'normal' });
    await legacy.table<Lead>('leads').add({ ...legacyLead('lead', 'stage-new'), priority: 'high' });
    legacy.close();

    const migrated = new ContactBoardDatabase(TEST_DATABASE);
    await migrated.open();
    expect((await migrated.leads.get('lead'))?.priority).toBe('high');
    migrated.close();
  });

  it('поднимает запасной этап, если все этапы оказались архивными', async () => {
    const legacy = new Dexie(TEST_DATABASE);
    legacy.version(4).stores(SCHEMA_V5);
    await legacy.open();
    await legacy.table<Stage>('stages').bulkAdd([
      { id: 'old-1', name: 'Старый', color: 'gray', order: 3, archived: true, kind: 'normal' },
      { id: 'old-2', name: 'Тоже старый', color: 'gray', order: 4, archived: true, kind: 'won' },
    ]);
    await legacy.table<Lead>('leads').add(legacyLead('lead', 'old-1'));
    legacy.close();

    const migrated = new ContactBoardDatabase(TEST_DATABASE);
    await migrated.open();
    const active = await migrated.stages.filter((stage) => !stage.archived).toArray();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id: 'stage-recovered', order: 0 });
    expect((await migrated.leads.get('lead'))?.stageId).toBe('stage-recovered');
    migrated.close();
  });
});

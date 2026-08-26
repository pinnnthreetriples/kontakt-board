import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../../infrastructure/database/database';
import { createId } from '../../../shared/lib/ids';
import { DEFAULT_STAGES } from '../../../infrastructure/database/seed';
import { createLeadFixture, resetDatabase } from '../../../test/fixtures';
import type { Contact, Lead } from '../../../shared/model/domain';
import {
  addComment,
  createLeadCard,
  deleteLead,
  completeCall,
  completeCallAndMoveLead,
  getLeadViews,
  InvalidPhoneError,
  LeadNotFoundError,
  moveLead,
  PhoneCollisionError,
  rescheduleCall,
  saveLeadCard,
  scheduleCall,
  setLeadPriority,
  StageNotFoundError,
  undoCallCompletion,
} from './lead-service';

function cardValues(contact: Contact) {
  return {
    organization: contact.organization, taxId: contact.taxId, personName: contact.personName, position: contact.position,
    phone: contact.phone, secondaryPhone: contact.secondaryPhone, email: contact.email, address: contact.address,
    region: contact.region, website: contact.website, tags: contact.tags, customValues: contact.customValues,
  };
}

function leadValues(lead: Lead) {
  return { result: lead.result, description: lead.description, assignee: lead.assignee };
}

beforeEach(async () => {
  await resetDatabase();
  await createLeadFixture();
});

describe('lead-service', () => {
  it('удаляет заявку вместе с комментариями, историей, звонками и контактом', async () => {
    const lead = (await db.leads.toArray())[0]!;
    await addComment(lead.id, 'Тестовый комментарий');
    await scheduleCall(lead.id, new Date(Date.now() + 86_400_000).toISOString(), 'Перезвонить');
    await deleteLead(lead.id);
    expect(await db.leads.count()).toBe(0);
    expect(await db.contacts.count()).toBe(0);
    expect(await db.comments.count()).toBe(0);
    expect(await db.activities.count()).toBe(0);
    expect(await db.calls.count()).toBe(0);
  });

  it('оставляет контакт, если у него есть другая заявка', async () => {
    const lead = (await db.leads.toArray())[0]!;
    const second = { ...lead, id: createId(), externalId: 'fixture-second', externalKey: 'тест::fixture-second' };
    await db.leads.add(second);
    await deleteLead(lead.id);
    expect(await db.leads.count()).toBe(1);
    expect(await db.contacts.get(lead.contactId)).toBeDefined();
  });

  it('не удаляет несуществующую заявку', async () => {
    await expect(deleteLead('нет-такой')).rejects.toBeInstanceOf(LeadNotFoundError);
    expect(await db.leads.count()).toBe(1);
  });

  it('создаёт контакт и заявку вручную', async () => {
    const leadId = await createLeadCard(
      { organization: 'Новый клуб', phone: '8 (999) 111-22-33' },
      { result: '', description: '', assignee: 'Пётр' },
      DEFAULT_STAGES[2]!.id,
    );
    const lead = (await db.leads.get(leadId))!;
    const contact = (await db.contacts.get(lead.contactId))!;
    expect(lead.stageId).toBe(DEFAULT_STAGES[2]!.id);
    expect(lead.source).toBe('Вручную');
    expect(lead.assignee).toBe('Пётр');
    expect(contact.organization).toBe('Новый клуб');
    expect(contact.normalizedPhone).toBe('79991112233');
    expect(contact.email).toBe('');
    expect(await db.activities.where('leadId').equals(leadId).count()).toBe(1);
  });

  it('не создаёт контакт с дублирующимся телефоном', async () => {
    const existing = (await db.contacts.toArray())[0]!;
    await expect(createLeadCard({ phone: existing.phone }, { result: '', description: '', assignee: 'Я' }, DEFAULT_STAGES[0]!.id))
      .rejects.toBeInstanceOf(PhoneCollisionError);
    expect(await db.contacts.count()).toBe(1);
    expect(await db.leads.count()).toBe(1);
  });

  it('не создаёт контакт в архивном этапе', async () => {
    await db.stages.update(DEFAULT_STAGES[3]!.id, { archived: true });
    await expect(createLeadCard({ organization: 'Клуб' }, { result: '', description: '', assignee: 'Я' }, DEFAULT_STAGES[3]!.id))
      .rejects.toBeInstanceOf(StageNotFoundError);
    expect(await db.contacts.count()).toBe(1);
  });

  it('перемещает карточку и пишет историю', async () => {
    const lead = (await db.leads.toArray())[0]!;
    await moveLead(lead.id, DEFAULT_STAGES[3]!.id);
    expect((await db.leads.get(lead.id))?.stageId).toBe(DEFAULT_STAGES[3]!.id);
    expect(await db.activities.where('leadId').equals(lead.id).count()).toBe(1);
  });

  it('не перемещает карточку в архивный этап', async () => {
    const lead = (await db.leads.toArray())[0]!;
    await db.stages.update(DEFAULT_STAGES[3]!.id, { archived: true });
    await moveLead(lead.id, DEFAULT_STAGES[3]!.id);
    expect((await db.leads.get(lead.id))?.stageId).toBe(lead.stageId);
    expect(await db.activities.where('leadId').equals(lead.id).count()).toBe(0);
  });

  it('атомарно сохраняет контакт и заявку', async () => {
    const lead = (await db.leads.toArray())[0]!;
    const contact = (await db.contacts.get(lead.contactId))!;
    await saveLeadCard(
      lead.id,
      { ...cardValues(contact), organization: 'Новая организация', phone: '8 (999) 123-45-67' },
      { ...leadValues(lead), description: 'Новое описание' },
    );
    expect(await db.contacts.get(contact.id)).toMatchObject({ organization: 'Новая организация', normalizedPhone: '79991234567' });
    expect(await db.leads.get(lead.id)).toMatchObject({ description: 'Новое описание' });
    expect(await db.activities.where('leadId').equals(lead.id).count()).toBe(1);
  });

  it('откатывает сохранение карточки при коллизии телефона', async () => {
    const first = (await db.leads.toArray())[0]!;
    const firstContact = (await db.contacts.get(first.contactId))!;
    const second = await createLeadFixture(1);
    await expect(saveLeadCard(
      first.id,
      { ...cardValues(firstContact), organization: 'Не сохранять', phone: second.contact.phone },
      { ...leadValues(first), description: 'Не сохранять' },
    )).rejects.toBeInstanceOf(PhoneCollisionError);
    expect(await db.contacts.get(firstContact.id)).toMatchObject({ organization: firstContact.organization, phone: firstContact.phone });
    expect(await db.leads.get(first.id)).toMatchObject({ description: first.description });
    expect(await db.activities.where('leadId').equals(first.id).count()).toBe(0);
  });

  it('отклоняет слишком короткий телефон', async () => {
    const lead = (await db.leads.toArray())[0]!;
    const contact = (await db.contacts.get(lead.contactId))!;
    await expect(saveLeadCard(lead.id, { ...cardValues(contact), phone: '123-45' }, leadValues(lead)))
      .rejects.toBeInstanceOf(InvalidPhoneError);
  });

  it('назначает и завершает звонок', async () => {
    const lead = (await db.leads.toArray())[0]!;
    const before = lead.updatedAt;
    const dueAt = new Date(Date.now() + 86_400_000).toISOString();
    await scheduleCall(lead.id, dueAt, 'Уточнить решение');
    const call = (await db.calls.where('leadId').equals(lead.id).reverse().sortBy('createdAt'))[0]!;
    await rescheduleCall(call.id, new Date(Date.now() + 2 * 86_400_000).toISOString());
    await completeCall(call.id);
    expect((await db.calls.get(call.id))?.completedAt).toBeTruthy();
    expect((await db.leads.get(lead.id))?.updatedAt).not.toBe(before);
  });

  it('не создаёт два одинаковых звонка при параллельном назначении', async () => {
    const lead = (await db.leads.toArray())[0]!;
    const dueAt = new Date(Date.now() + 86_400_000).toISOString();
    await Promise.all([
      scheduleCall(lead.id, dueAt, 'Уточнить решение'),
      scheduleCall(lead.id, dueAt, 'Уточнить решение'),
    ]);
    expect(await db.calls.where('leadId').equals(lead.id).count()).toBe(1);
    expect(await db.activities.where('leadId').equals(lead.id).count()).toBe(1);
  });

  it('однократно завершает звонок при параллельных действиях', async () => {
    const lead = (await db.leads.toArray())[0]!;
    await scheduleCall(lead.id, new Date(Date.now() + 86_400_000).toISOString(), 'Позвонить');
    const call = (await db.calls.toArray())[0]!;
    await Promise.all([completeCall(call.id), completeCall(call.id)]);
    const completed = (await db.activities.where('leadId').equals(lead.id).toArray()).filter((item) => item.kind === 'call_completed');
    expect(completed).toHaveLength(1);
  });

  it('однократно переносит звонок на одинаковое время', async () => {
    const lead = (await db.leads.toArray())[0]!;
    await scheduleCall(lead.id, new Date(Date.now() + 86_400_000).toISOString(), 'Позвонить');
    const call = (await db.calls.toArray())[0]!;
    const target = new Date(Date.now() + 2 * 86_400_000).toISOString();
    await Promise.all([rescheduleCall(call.id, target), rescheduleCall(call.id, target)]);
    const scheduled = (await db.activities.where('leadId').equals(lead.id).toArray()).filter((item) => item.kind === 'call_scheduled');
    expect(scheduled).toHaveLength(2);
  });

  it('атомарно завершает звонок и переносит карточку в «не дозвонились»', async () => {
    const lead = (await db.leads.toArray())[0]!;
    await scheduleCall(lead.id, new Date(Date.now() + 86_400_000).toISOString(), 'Позвонить');
    const call = (await db.calls.toArray())[0]!;
    await completeCallAndMoveLead(call.id, 'stage-no-answer');
    expect((await db.calls.get(call.id))?.completedAt).toBeTruthy();
    expect((await db.leads.get(lead.id))?.stageId).toBe('stage-no-answer');
  });

  it('отменяет завершение звонка и возвращает прежний этап', async () => {
    const lead = (await db.leads.toArray())[0]!;
    await scheduleCall(lead.id, new Date(Date.now() + 86_400_000).toISOString(), 'Позвонить');
    const call = (await db.calls.toArray())[0]!;
    await completeCallAndMoveLead(call.id, 'stage-no-answer');
    await undoCallCompletion(call.id, lead.stageId);
    expect((await db.calls.get(call.id))?.completedAt).toBeUndefined();
    expect((await db.leads.get(lead.id))?.stageId).toBe(lead.stageId);
  });

  it('однократно завершает и перемещает карточку при параллельных действиях', async () => {
    const lead = (await db.leads.toArray())[0]!;
    await scheduleCall(lead.id, new Date(Date.now() + 86_400_000).toISOString(), 'Позвонить');
    const call = (await db.calls.toArray())[0]!;
    await Promise.all([
      completeCallAndMoveLead(call.id, 'stage-no-answer'),
      completeCallAndMoveLead(call.id, 'stage-no-answer'),
    ]);
    const completed = (await db.activities.where('leadId').equals(lead.id).toArray()).filter((item) => item.kind === 'call_completed');
    expect(completed).toHaveLength(1);
  });

  it('меняет приоритет заявки и пишет запись в историю', async () => {
    const lead = (await db.leads.toArray())[0]!;
    await setLeadPriority(lead.id, 'high');
    expect((await db.leads.get(lead.id))?.priority).toBe('high');
    const activities = await db.activities.where('leadId').equals(lead.id).toArray();
    expect(activities.filter((item) => item.text === 'Приоритет: высокий')).toHaveLength(1);
  });

  it('не плодит историю при повторной установке того же приоритета', async () => {
    const lead = (await db.leads.toArray())[0]!;
    await setLeadPriority(lead.id, 'low');
    await setLeadPriority(lead.id, 'low');
    expect(await db.activities.where('leadId').equals(lead.id).count()).toBe(1);
  });

  it('не меняет приоритет несуществующей заявки', async () => {
    await expect(setLeadPriority('нет-такой', 'high')).rejects.toBeInstanceOf(LeadNotFoundError);
    expect(await db.activities.count()).toBe(0);
  });

  it('не создаёт осиротевшие комментарии и звонки', async () => {
    await expect(addComment('missing-lead', 'Комментарий')).rejects.toBeInstanceOf(LeadNotFoundError);
    await expect(scheduleCall('missing-lead', new Date(Date.now() + 86_400_000).toISOString(), 'Позвонить'))
      .rejects.toBeInstanceOf(LeadNotFoundError);
    expect(await db.comments.count()).toBe(0);
    expect(await db.calls.count()).toBe(0);
    expect(await db.activities.count()).toBe(0);
  });

  it('использует имя владельца в комментариях', async () => {
    const lead = (await db.leads.toArray())[0]!;
    await db.preferences.update('preferences', { ownerName: 'Виктория' });
    await addComment(lead.id, 'Перезвонить');
    expect((await db.comments.toArray())[0]?.author).toBe('Виктория');
  });

  it('собирает контакт, заявку и ближайший звонок в одну проекцию', async () => {
    const views = await getLeadViews();
    expect(views).toHaveLength(1);
    expect(views[0]).toHaveProperty('contact.organization');
  });

  it('переносит в проекцию только заполненные пользовательские поля', async () => {
    const lead = (await db.leads.toArray())[0]!;
    await db.customFields.bulkAdd([
      { id: 'field-1', name: 'VIP', type: 'boolean', showOnCard: true, filterable: true, archived: false },
      { id: 'field-2', name: 'Без значения', type: 'text', showOnCard: true, filterable: true, archived: false },
      { id: 'field-3', name: 'Бюджет', type: 'number', showOnCard: false, filterable: true, archived: false },
      { id: 'field-4', name: 'Пустая строка', type: 'text', showOnCard: false, filterable: true, archived: false },
      { id: 'field-5', name: 'Архивное', type: 'text', showOnCard: true, filterable: true, archived: true },
    ]);
    await db.contacts.update(lead.contactId, { customValues: { 'field-1': true, 'field-3': 120, 'field-4': '', 'field-5': 'скрыто' } });

    const view = (await getLeadViews())[0]!;

    expect(view.cardFields).toEqual([{ label: 'VIP', value: 'Да' }]);
    expect(view.filterFields).toEqual([{ label: 'VIP', value: 'Да' }, { label: 'Бюджет', value: '120' }]);
  });

  it('не показывает заявку, у которой потерялся контакт', async () => {
    await db.contacts.clear();

    expect(await getLeadViews()).toEqual([]);
  });

  it('обрабатывает 10 000 заявок без квадратичного замедления', async () => {
    await db.contacts.clear(); await db.leads.clear();
    const now = new Date().toISOString();
    const contacts: Contact[] = Array.from({ length: 10_000 }, (_, index) => ({
      id: `contact-${index}`, organization: `Организация ${index}`, taxId: '', personName: '', position: '', phone: `7909000${String(index).padStart(4, '0')}`,
      normalizedPhone: `7909000${String(index).padStart(4, '0')}`, secondaryPhone: '', email: '', address: '', region: '', website: '', tags: [], customValues: {}, createdAt: now, updatedAt: now,
    }));
    const leads: Lead[] = contacts.map((contact, index) => ({
      id: `lead-${index}`, contactId: contact.id, stageId: DEFAULT_STAGES[0]!.id, externalId: `perf-${index}`, externalKey: `test::perf-${index}`,
      source: 'test', result: '', description: '', assignee: 'Я', createdAt: now, updatedAt: now,
    }));
    await db.transaction('rw', [db.contacts, db.leads], async () => { await db.contacts.bulkAdd(contacts); await db.leads.bulkAdd(leads); });
    const startedAt = performance.now();
    expect(await getLeadViews()).toHaveLength(10_000);
    expect(performance.now() - startedAt).toBeLessThan(5_000);
  }, 15_000);
});
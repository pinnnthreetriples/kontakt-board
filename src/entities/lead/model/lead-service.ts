import { db } from '../../../infrastructure/database/database';
import { createId } from '../../../shared/lib/ids';
import { normalizePhone } from '../../../shared/lib/phone';
import type { ActivityItem, Contact, Lead, LeadPriority, LeadView } from '../../../shared/model/domain';

export const PRIORITY_LABELS: Record<LeadPriority, string> = { low: 'Низкий', normal: 'Средний', high: 'Высокий' };

type ContactCardValues = Pick<Contact, 'organization' | 'taxId' | 'personName' | 'position' | 'phone' | 'secondaryPhone' | 'email' | 'address' | 'region' | 'website' | 'tags' | 'customValues'>;
type LeadCardValues = Pick<Lead, 'result' | 'description' | 'assignee'>;

const EMPTY_CONTACT: ContactCardValues = {
  organization: '', taxId: '', personName: '', position: '', phone: '', secondaryPhone: '',
  email: '', address: '', region: '', website: '', tags: [], customValues: {},
};

export class LeadNotFoundError extends Error {
  constructor() { super('Заявка не найдена'); }
}

export class InvalidPhoneError extends Error {
  constructor() { super('Телефон должен содержать не менее 10 цифр'); }
}

export class PhoneCollisionError extends Error {
  constructor() { super('Контакт с таким телефоном уже существует'); }
}

export class StageNotFoundError extends Error {
  constructor() { super('Этап не найден'); }
}

async function currentAuthor(): Promise<string> {
  return (await db.preferences.get('preferences'))?.ownerName.trim() || 'Я';
}

export async function getLeadViews(): Promise<LeadView[]> {
  const [leads, contacts, calls, comments, customFields] = await Promise.all([
    db.leads.toArray(), db.contacts.toArray(), db.calls.toArray(), db.comments.toArray(), db.customFields.toArray(),
  ]);
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  const activeCalls = calls.filter((call) => !call.completedAt).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const nextCallByLead = new Map<string, (typeof activeCalls)[number]>();
  for (const call of activeCalls) if (!nextCallByLead.has(call.leadId)) nextCallByLead.set(call.leadId, call);
  const commentsByLead = new Map<string, number>();
  for (const comment of comments) commentsByLead.set(comment.leadId, (commentsByLead.get(comment.leadId) ?? 0) + 1);
  return leads.flatMap((lead) => {
    const contact = contactsById.get(lead.contactId);
    if (!contact) return [];
    return [{
      lead,
      contact,
      nextCall: nextCallByLead.get(lead.id),
      commentsCount: commentsByLead.get(lead.id) ?? 0,
      cardFields: customFields.filter((field) => field.showOnCard && !field.archived).slice(0, 2).flatMap((field) => {
        const value = contact.customValues[field.id];
        return value === undefined || value === '' ? [] : [{ label: field.name, value: typeof value === 'boolean' ? (value ? 'Да' : 'Нет') : String(value) }];
      }),
      filterFields: customFields.filter((field) => field.filterable && !field.archived).flatMap((field) => {
        const value = contact.customValues[field.id];
        return value === undefined || value === '' ? [] : [{ label: field.name, value: typeof value === 'boolean' ? (value ? 'Да' : 'Нет') : String(value) }];
      }),
    }];
  });
}

export async function moveLead(leadId: string, stageId: string): Promise<void> {
  const now = new Date().toISOString();
  const author = await currentAuthor();
  await db.transaction('rw', [db.leads, db.stages, db.activities], async () => {
    const [lead, stage] = await Promise.all([db.leads.get(leadId), db.stages.get(stageId)]);
    if (!lead) throw new LeadNotFoundError();
    if (!stage || stage.archived) return;
    if (lead.stageId === stageId) return;
    const activity: ActivityItem = {
      id: createId(), leadId, kind: 'stage_changed', text: `Этап изменён на «${stage.name}»`, author, createdAt: now,
    };
    await db.leads.update(leadId, { stageId, updatedAt: now });
    await db.activities.add(activity);
  });
}

export async function setLeadPriority(leadId: string, priority: LeadPriority): Promise<void> {
  const now = new Date().toISOString();
  const author = await currentAuthor();
  await db.transaction('rw', [db.leads, db.activities], async () => {
    const lead = await db.leads.get(leadId);
    if (!lead) throw new LeadNotFoundError();
    if ((lead.priority ?? 'normal') === priority) return;
    const activity: ActivityItem = {
      id: createId(), leadId, kind: 'updated', text: `Приоритет: ${PRIORITY_LABELS[priority].toLowerCase()}`, author, createdAt: now,
    };
    await db.leads.update(leadId, { priority, updatedAt: now });
    await db.activities.add(activity);
  });
}

function contactChanges(values: Partial<ContactCardValues>): Partial<ContactCardValues> {
  return {
    ...(values.organization !== undefined && { organization: values.organization }),
    ...(values.taxId !== undefined && { taxId: values.taxId }),
    ...(values.personName !== undefined && { personName: values.personName }),
    ...(values.position !== undefined && { position: values.position }),
    ...(values.phone !== undefined && { phone: values.phone }),
    ...(values.secondaryPhone !== undefined && { secondaryPhone: values.secondaryPhone }),
    ...(values.email !== undefined && { email: values.email }),
    ...(values.address !== undefined && { address: values.address }),
    ...(values.region !== undefined && { region: values.region }),
    ...(values.website !== undefined && { website: values.website }),
    ...(values.tags !== undefined && { tags: values.tags }),
    ...(values.customValues !== undefined && { customValues: values.customValues }),
  };
}

async function checkedPhone(contactId: string, phone: string): Promise<string> {
  const normalizedPhone = normalizePhone(phone);
  if (phone.trim() && normalizedPhone.length < 10) throw new InvalidPhoneError();
  if (normalizedPhone) {
    const collision = await db.contacts.where('normalizedPhone').equals(normalizedPhone)
      .filter((contact) => contact.id !== contactId).first();
    if (collision) throw new PhoneCollisionError();
  }
  return normalizedPhone;
}

export async function createLeadCard(contactValues: Partial<ContactCardValues>, leadValues: LeadCardValues, stageId: string): Promise<string> {
  const now = new Date().toISOString();
  const author = await currentAuthor();
  const contactId = createId();
  const leadId = createId();
  return db.transaction('rw', [db.contacts, db.leads, db.stages, db.activities], async () => {
    const stage = await db.stages.get(stageId);
    if (!stage || stage.archived) throw new StageNotFoundError();
    const values = { ...EMPTY_CONTACT, ...contactChanges(contactValues) };
    const normalizedPhone = await checkedPhone(contactId, values.phone);
    await db.contacts.add({ ...values, id: contactId, normalizedPhone, createdAt: now, updatedAt: now });
    await db.leads.add({ ...leadValues, id: leadId, contactId, stageId, externalId: '', source: 'Вручную', createdAt: now, updatedAt: now });
    await db.activities.add({ id: createId(), leadId, kind: 'created', text: 'Контакт добавлен вручную', author, createdAt: now });
    return leadId;
  });
}

export async function saveLeadCard(leadId: string, contactValues: ContactCardValues, leadValues: LeadCardValues): Promise<void> {
  const now = new Date().toISOString();
  const author = await currentAuthor();
  await db.transaction('rw', [db.contacts, db.leads, db.activities], async () => {
    const lead = await db.leads.get(leadId);
    if (!lead) throw new LeadNotFoundError();
    const contact = await db.contacts.get(lead.contactId);
    if (!contact) throw new LeadNotFoundError();
    const normalizedPhone = await checkedPhone(contact.id, contactValues.phone);
    await db.contacts.update(contact.id, { ...contactChanges(contactValues), normalizedPhone, updatedAt: now });
    await db.leads.update(lead.id, { ...leadValues, updatedAt: now });
    await db.activities.add({ id: createId(), leadId, kind: 'updated', text: 'Карточка изменена', author, createdAt: now });
  });
}

// Контакт удаляется вместе с последней своей заявкой, иначе остаётся сиротой.
export async function deleteLead(leadId: string): Promise<void> {
  await db.transaction('rw', [db.leads, db.contacts, db.comments, db.activities, db.calls], async () => {
    const lead = await db.leads.get(leadId);
    if (!lead) throw new LeadNotFoundError();
    await db.comments.where('leadId').equals(leadId).delete();
    await db.activities.where('leadId').equals(leadId).delete();
    await db.calls.where('leadId').equals(leadId).delete();
    await db.leads.delete(leadId);
    const remaining = await db.leads.where('contactId').equals(lead.contactId).count();
    if (remaining === 0) await db.contacts.delete(lead.contactId);
  });
}

export async function addComment(leadId: string, text: string): Promise<void> {
  const value = text.trim();
  if (!value) return;
  const now = new Date().toISOString();
  const author = await currentAuthor();
  await db.transaction('rw', [db.comments, db.activities, db.leads], async () => {
    const lead = await db.leads.get(leadId);
    if (!lead) throw new LeadNotFoundError();
    await db.comments.add({ id: createId(), leadId, text: value, author, createdAt: now });
    await db.activities.add({ id: createId(), leadId, kind: 'commented', text: 'Добавлен комментарий', author, createdAt: now });
    await db.leads.update(leadId, { updatedAt: now });
  });
}

export async function scheduleCall(leadId: string, dueAt: string, note: string): Promise<void> {
  const dueDate = new Date(dueAt);
  if (Number.isNaN(dueDate.getTime()) || dueDate.getTime() <= Date.now()) return;
  const now = new Date().toISOString();
  const author = await currentAuthor();
  await db.transaction('rw', [db.calls, db.activities, db.leads], async () => {
    const lead = await db.leads.get(leadId);
    if (!lead) throw new LeadNotFoundError();
    if (dueDate.getTime() <= Date.now()) return;
    const normalizedDueAt = dueDate.toISOString();
    const normalizedNote = note.trim();
    const duplicate = await db.calls.where('leadId').equals(leadId)
      .filter((call) => !call.completedAt && call.dueAt === normalizedDueAt && call.note === normalizedNote).first();
    if (duplicate) return;
    await db.calls.add({ id: createId(), leadId, dueAt: normalizedDueAt, note: normalizedNote, createdAt: now });
    await db.activities.add({ id: createId(), leadId, kind: 'call_scheduled', text: 'Назначен звонок', author, createdAt: now });
    await db.leads.update(leadId, { updatedAt: now });
  });
}

export async function completeCall(callId: string): Promise<void> {
  const now = new Date().toISOString();
  const author = await currentAuthor();
  await db.transaction('rw', [db.calls, db.activities, db.leads], async () => {
    const call = await db.calls.get(callId);
    if (!call || call.completedAt) return;
    const lead = await db.leads.get(call.leadId);
    if (!lead) throw new LeadNotFoundError();
    await db.calls.update(callId, { completedAt: now });
    await db.activities.add({ id: createId(), leadId: call.leadId, kind: 'call_completed', text: 'Звонок выполнен', author, createdAt: now });
    await db.leads.update(call.leadId, { updatedAt: now });
  });
}

export async function rescheduleCall(callId: string, dueAt: string): Promise<void> {
  const dueDate = new Date(dueAt);
  if (Number.isNaN(dueDate.getTime()) || dueDate.getTime() <= Date.now()) return;
  const now = new Date().toISOString();
  const author = await currentAuthor();
  await db.transaction('rw', [db.calls, db.activities, db.leads], async () => {
    const call = await db.calls.get(callId);
    const normalizedDueAt = dueDate.toISOString();
    if (!call || call.completedAt || call.dueAt === normalizedDueAt || dueDate.getTime() <= Date.now()) return;
    const lead = await db.leads.get(call.leadId);
    if (!lead) throw new LeadNotFoundError();
    await db.calls.update(callId, { dueAt: normalizedDueAt });
    await db.activities.add({ id: createId(), leadId: call.leadId, kind: 'call_scheduled', text: 'Звонок перенесён', author, createdAt: now });
    await db.leads.update(call.leadId, { updatedAt: now });
  });
}

export async function completeCallAndMoveLead(callId: string, stageId: string): Promise<void> {
  const now = new Date().toISOString();
  const author = await currentAuthor();
  await db.transaction('rw', [db.calls, db.leads, db.stages, db.activities], async () => {
    const [call, stage] = await Promise.all([db.calls.get(callId), db.stages.get(stageId)]);
    if (!call || call.completedAt || !stage || stage.archived) return;
    const lead = await db.leads.get(call.leadId);
    if (!lead) throw new LeadNotFoundError();
    await db.calls.update(call.id, { completedAt: now });
    await db.leads.update(lead.id, { stageId: stage.id, updatedAt: now });
    await db.activities.bulkAdd([
      { id: createId(), leadId: lead.id, kind: 'call_completed', text: 'Звонок завершён: не дозвонились', author, createdAt: now },
      { id: createId(), leadId: lead.id, kind: 'stage_changed', text: `Этап изменён на «${stage.name}»`, author, createdAt: now },
    ]);
  });
}

export async function undoCallCompletion(callId: string, previousStageId?: string): Promise<void> {
  const now = new Date().toISOString();
  const author = await currentAuthor();
  await db.transaction('rw', [db.calls, db.leads, db.stages, db.activities], async () => {
    const call = await db.calls.get(callId);
    if (!call?.completedAt) return;
    const lead = await db.leads.get(call.leadId);
    if (!lead) throw new LeadNotFoundError();
    const previousStage = previousStageId ? await db.stages.get(previousStageId) : undefined;
    await db.calls.update(call.id, { completedAt: undefined });
    await db.leads.update(lead.id, { ...(previousStage && !previousStage.archived ? { stageId: previousStage.id } : {}), updatedAt: now });
    await db.activities.add({ id: createId(), leadId: lead.id, kind: 'updated', text: 'Действие со звонком отменено', author, createdAt: now });
  });
}

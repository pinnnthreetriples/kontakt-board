import { z } from 'zod';
import { db } from '../../../infrastructure/database/database';
import { tokens } from '../../../shared/design-system/tokens';
import { normalizePhone } from '../../../shared/lib/phone';

const dateString = z.iso.datetime();
const contactSchema = z.object({
  id: z.string(), organization: z.string(), taxId: z.string(), personName: z.string(), position: z.string(), phone: z.string(),
  normalizedPhone: z.string(), secondaryPhone: z.string(), email: z.string(), address: z.string(), region: z.string(), website: z.string(),
  tags: z.array(z.string()), customValues: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])), createdAt: dateString, updatedAt: dateString,
});
const leadSchema = z.object({
  id: z.string(), contactId: z.string(), stageId: z.string(), externalId: z.string(), externalKey: z.string().optional(), source: z.string(),
  result: z.string(), description: z.string(), assignee: z.string(), priority: z.enum(['low', 'normal', 'high']).optional(),
  createdAt: dateString, updatedAt: dateString,
});
const tagSchema = z.object({ id: z.string(), name: z.string(), color: z.string() });
const stageSchema = z.object({
  id: z.string(), name: z.string(), color: z.string(), order: z.number().int(), archived: z.boolean(),
  kind: z.enum(['normal', 'no_answer', 'won', 'lost']).optional(),
});
const commentSchema = z.object({ id: z.string(), leadId: z.string(), text: z.string(), author: z.string(), createdAt: dateString });
const activitySchema = z.object({
  id: z.string(), leadId: z.string(), kind: z.enum(['created', 'updated', 'stage_changed', 'commented', 'call_scheduled', 'call_completed', 'imported']),
  text: z.string(), author: z.string(), createdAt: dateString,
});
const callSchema = z.object({ id: z.string(), leadId: z.string(), dueAt: dateString, note: z.string(), completedAt: dateString.optional(), createdAt: dateString });
const fieldSchema = z.object({ id: z.string(), name: z.string(), type: z.enum(['text', 'number', 'date', 'select', 'boolean']), showOnCard: z.boolean(), filterable: z.boolean(), archived: z.boolean() });
const importJobSchema = z.object({ id: z.string(), fileName: z.string(), created: z.number().int(), updated: z.number().int(), skipped: z.number().int(), errors: z.number().int(), createdAt: dateString });
const preferencesSchema = z.object({ id: z.literal('preferences'), ownerName: z.string(), compactMode: z.boolean(), notifyMinutesBefore: z.number() });

const backupSchema = z.object({
  version: z.literal(2),
  createdAt: dateString,
  checksum: z.string().length(8),
  data: z.object({
    contacts: z.array(contactSchema), leads: z.array(leadSchema), stages: z.array(stageSchema), comments: z.array(commentSchema),
    activities: z.array(activitySchema), calls: z.array(callSchema), customFields: z.array(fieldSchema), importJobs: z.array(importJobSchema),
    preferences: z.array(preferencesSchema), tags: z.array(tagSchema).optional(),
  }),
});

export const MAX_BACKUP_SIZE = 50 * 1024 * 1024;

export function assertBackupSize(size: number): void {
  if (size > MAX_BACKUP_SIZE) throw new Error('Резервная копия больше 50 МБ');
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function exportBackup(): Promise<void> {
  const payload = await createBackupPayload();
  const blob = new Blob([payload], { type: 'application/json' });
  assertBackupSize(blob.size);
  downloadBlob(blob, `contacts-backup-${new Date().toISOString().slice(0, 10)}.json`);
  localStorage.setItem('last-external-backup', new Date().toISOString());
}

function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalStringify(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function calculateChecksum(value: unknown): string {
  const text = canonicalStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export async function createBackupPayload(): Promise<string> {
  const data = await db.transaction('r', db.tables, async () => ({
    contacts: await db.contacts.toArray(), leads: await db.leads.toArray(), stages: await db.stages.toArray(),
    comments: await db.comments.toArray(), activities: await db.activities.toArray(), calls: await db.calls.toArray(),
    customFields: await db.customFields.toArray(), importJobs: await db.importJobs.toArray(), preferences: await db.preferences.toArray(),
    tags: await db.tags.toArray(),
  }));
  return JSON.stringify({ version: 2, createdAt: new Date().toISOString(), checksum: calculateChecksum(data), data }, null, 2);
}

function assertReferences(data: z.infer<typeof backupSchema>['data']): void {
  const unique = (values: string[]) => new Set(values).size === values.length;
  const allIdGroups = [data.contacts, data.leads, data.stages, data.comments, data.activities, data.calls, data.customFields, data.importJobs];
  if (allIdGroups.some((items) => !unique(items.map((item) => item.id)))) {
    throw new Error('Резервная копия содержит повторяющиеся ID');
  }
  const contactIds = new Set(data.contacts.map((item) => item.id));
  const phones = data.contacts.flatMap((contact) => contact.normalizedPhone ? [contact.normalizedPhone] : []);
  if (!unique(phones) || phones.some((phone) => phone.length < 10)) throw new Error('Резервная копия содержит некорректные или повторяющиеся телефоны');
  const stageIds = new Set(data.stages.map((item) => item.id));
  const activeStageIds = new Set(data.stages.filter((item) => !item.archived).map((item) => item.id));
  const leadIds = new Set(data.leads.map((item) => item.id));
  if (activeStageIds.size === 0) throw new Error('Резервная копия не содержит активного этапа');
  if (data.leads.some((lead) => !contactIds.has(lead.contactId) || !stageIds.has(lead.stageId))) throw new Error('Нарушены связи заявок');
  if (data.leads.some((lead) => !activeStageIds.has(lead.stageId))) throw new Error('Заявка связана с архивным этапом');
  if ([...data.comments, ...data.activities, ...data.calls].some((item) => !leadIds.has(item.leadId))) throw new Error('Нарушены связи истории');
  const activeSpecialKinds = data.stages
    .filter((stage) => !stage.archived && stage.kind && stage.kind !== 'normal')
    .map((stage) => stage.kind as string);
  if (!unique(activeSpecialKinds)) throw new Error('Повторяются системные типы активных этапов');
  const expectedOrders = data.stages.filter((stage) => !stage.archived).map((stage) => stage.order).sort((left, right) => left - right);
  if (expectedOrders.some((order, index) => order !== index)) throw new Error('Нарушен порядок активных этапов');
  const externalKeys = data.leads.flatMap((lead) => lead.externalKey ? [lead.externalKey] : []);
  const inconsistentKey = data.leads.some((lead) => lead.externalKey !== restoredExternalKey(lead.source, lead.externalId));
  if (!unique(externalKeys) || inconsistentKey || data.preferences.length !== 1) throw new Error('Нарушены уникальные значения');
}

function normalizeSource(value: string): string {
  return value.trim().toLowerCase();
}

function restoredExternalKey(source: string, externalId: string): string | undefined {
  const id = externalId.trim();
  return id ? `${normalizeSource(source)}::${id}` : undefined;
}

function normalizeRestoredData(data: z.infer<typeof backupSchema>['data']): z.infer<typeof backupSchema>['data'] {
  const defaultKinds: Record<string, NonNullable<z.infer<typeof stageSchema>['kind']>> = {
    'stage-no-answer': 'no_answer', 'stage-won': 'won', 'stage-lost': 'lost',
  };
  const normalizedStages = data.stages.map((stage) => ({ ...stage, kind: stage.kind ?? defaultKinds[stage.id] ?? 'normal' }));
  const activeStages = normalizedStages.filter((stage) => !stage.archived).sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const orderByStageId = new Map(activeStages.map((stage, index) => [stage.id, index]));
  const stages = normalizedStages.map((stage) => ({ ...stage, order: stage.archived ? -1 : (orderByStageId.get(stage.id) ?? stage.order) }));
  const contacts = data.contacts.map((contact) => ({ ...contact, normalizedPhone: normalizePhone(contact.phone) }));
  const leads = data.leads.map((lead) => {
    const externalId = lead.externalId.trim();
    const source = lead.source.trim() || 'Excel';
    return { ...lead, source, externalId, externalKey: restoredExternalKey(source, externalId) };
  });
  return { ...data, contacts, stages, leads };
}

export async function restoreBackup(file: File): Promise<void> {
  assertBackupSize(file.size);
  const parsed = backupSchema.parse(JSON.parse(await file.text()) as unknown);
  if (calculateChecksum(parsed.data) !== parsed.checksum) throw new Error('Контрольная сумма не совпадает');
  const data = normalizeRestoredData(parsed.data);
  assertReferences(data);
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    await db.contacts.bulkAdd(data.contacts);
    await db.leads.bulkAdd(data.leads);
    await db.stages.bulkAdd(data.stages);
    await db.comments.bulkAdd(data.comments);
    await db.activities.bulkAdd(data.activities);
    await db.calls.bulkAdd(data.calls);
    await db.customFields.bulkAdd(data.customFields);
    await db.importJobs.bulkAdd(data.importJobs);
    await db.preferences.bulkAdd(data.preferences);
    // restoreBackup чистит все таблицы, поэтому справочник тегов надо вернуть явно.
    await db.tags.bulkAdd(data.tags ?? []);
  });
}

function safeCell(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

export async function exportContactsToExcel(): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const [contacts, leads, stages] = await Promise.all([db.contacts.toArray(), db.leads.toArray(), db.stages.toArray()]);
  const stageNames = new Map(stages.map((stage) => [stage.id, stage.name]));
  const latestLeadByContact = new Map<string, (typeof leads)[number]>();
  for (const lead of leads) {
    const current = latestLeadByContact.get(lead.contactId);
    if (!current || lead.updatedAt > current.updatedAt) latestLeadByContact.set(lead.contactId, lead);
  }
  const rows = contacts.map((contact) => {
    const lead = latestLeadByContact.get(contact.id);
    return {
      Организация: safeCell(contact.organization),
      Контакт: safeCell(contact.personName),
      Телефон: safeCell(contact.phone),
      Email: safeCell(contact.email),
      Регион: safeCell(contact.region),
      Этап: safeCell(lead ? stageNames.get(lead.stageId) ?? '' : ''),
      Результат: safeCell(lead?.result ?? ''),
      Ответственный: safeCell(lead?.assignee ?? ''),
      'ID записи': safeCell(lead?.externalId ?? ''),
    };
  });
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Контакты');
  sheet.columns = Object.keys(rows[0] ?? { Организация: '' }).map((header) => ({ header, key: header, width: tokens.size.excelColumn }));
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `contacts-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

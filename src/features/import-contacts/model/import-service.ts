import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { isValid, parse, parseISO } from 'date-fns';
import { db } from '../../../infrastructure/database/database';
import { createId } from '../../../shared/lib/ids';
import { normalizePhone } from '../../../shared/lib/phone';
import type {
  ActivityItem,
  Contact,
  ImportColumnMapping,
  ImportPreviewRow,
  Lead,
  ParsedSheet,
} from '../../../shared/model/domain';
import { externalKey, identifiersConflict, normalizeSource, sourceLabel, storedExternalKey } from './import-identifiers';

const MAX_XLSX_SIZE = 15 * 1024 * 1024;
const MAX_UNPACKED_SIZE = 120 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 5_000;
export const MAX_IMPORT_ROWS = 20_000;
const MAX_IMPORT_SHEETS = 50;
const MAX_IMPORT_COLUMNS = 250;

type ZipEntryWithMetadata = JSZip.JSZipObject & {
  _data?: { uncompressedSize?: number };
};

async function validateXlsxArchive(buffer: ArrayBuffer): Promise<void> {
  const archive = await JSZip.loadAsync(buffer, { checkCRC32: false });
  const entries = Object.values(archive.files);
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error('В XLSX слишком много внутренних файлов');
  let unpackedSize = 0;
  for (const entry of entries) {
    const metadata = (entry as ZipEntryWithMetadata)._data;
    unpackedSize += metadata?.uncompressedSize ?? 0;
    if (unpackedSize > MAX_UNPACKED_SIZE) throw new Error('Распакованный XLSX больше 120 МБ');
  }
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  return '';
}

export async function parseWorkbook(file: File): Promise<ParsedSheet[]> {
  if (file.size > MAX_XLSX_SIZE) throw new Error('Файл больше 15 МБ');
  const buffer = await file.arrayBuffer();
  const signature = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  if (signature[0] !== 0x50 || signature[1] !== 0x4b) throw new Error('Файл не является безопасным XLSX-архивом');
  await validateXlsxArchive(buffer);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  if (workbook.worksheets.length > MAX_IMPORT_SHEETS) {
    throw new Error(`В XLSX больше ${MAX_IMPORT_SHEETS} листов`);
  }
  const totalRows = workbook.worksheets.reduce((sum, sheet) => sum + Math.max(0, sheet.rowCount - 1), 0);
  if (totalRows > MAX_IMPORT_ROWS) {
    throw new Error(`В XLSX больше ${MAX_IMPORT_ROWS.toLocaleString('ru-RU')} строк суммарно`);
  }
  return workbook.worksheets.map((sheet) => {
    if (sheet.columnCount > MAX_IMPORT_COLUMNS) {
      throw new Error(`На листе «${sheet.name}» больше ${MAX_IMPORT_COLUMNS} столбцов`);
    }
    const headerRow = sheet.getRow(1);
    const seenHeaders = new Map<string, number>();
    const headers = Array.from({ length: sheet.columnCount }, (_, index) => {
      const base = headerRow.getCell(index + 1).text.trim();
      if (!base) return '';
      const count = seenHeaders.get(base) ?? 0;
      seenHeaders.set(base, count + 1);
      return count === 0 ? base : `${base} (${count + 1})`;
    });
    const rows: Array<Record<string, unknown>> = [];
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const record: Record<string, unknown> = {};
      headers.forEach((header, index) => { if (header) record[header] = row.getCell(index + 1).text.trim(); });
      rows.push(record);
    }
    return { name: sheet.name, headers: headers.filter(Boolean), rows };
  });
}

function mapped(row: Record<string, unknown>, mapping: ImportColumnMapping, field: keyof ImportColumnMapping): string {
  const header = mapping[field];
  return header ? cellText(row[header]) : '';
}

function importedDate(value: string): string | undefined {
  if (!value) return undefined;
  const iso = parseISO(value);
  if (isValid(iso)) return iso.toISOString();
  for (const format of ['dd.MM.yyyy HH:mm', 'dd.MM.yyyy']) {
    const date = parse(value, format, new Date());
    if (isValid(date)) return date.toISOString();
  }
  return undefined;
}

export async function buildPreview(rows: Array<Record<string, unknown>>, mapping: ImportColumnMapping): Promise<ImportPreviewRow[]> {
  const previews: ImportPreviewRow[] = [];
  const [storedLeads, storedContacts] = await Promise.all([db.leads.toArray(), db.contacts.toArray()]);
  const contactByPhone = new Map(storedContacts.flatMap((contact) => contact.normalizedPhone ? [[contact.normalizedPhone, contact.id] as const] : []));
  const phoneByContact = new Map(storedContacts.flatMap((contact) => contact.normalizedPhone ? [[contact.id, contact.normalizedPhone] as const] : []));
  const contactByExternalKey = new Map(storedLeads.flatMap((lead) => {
    const key = storedExternalKey(lead);
    return key ? [[key, lead.contactId] as const] : [];
  }));
  const leadContactSources = new Set(storedLeads.map((lead) => `${lead.contactId}::${normalizeSource(lead.source)}`));
  for (const [index, row] of rows.entries()) {
    const phone = mapped(row, mapping, 'phone');
    const externalId = mapped(row, mapping, 'externalId');
    const source = sourceLabel(mapped(row, mapping, 'source'));
    const organization = mapped(row, mapping, 'organization');
    const personName = mapped(row, mapping, 'personName');
    const normalizedPhone = normalizePhone(phone);
    if (!organization && !personName && !normalizedPhone && !externalId) {
      previews.push({ rowNumber: index + 2, organization, personName, phone, externalId, action: 'skip', raw: row });
      continue;
    }
    if (!normalizedPhone && !externalId) {
      previews.push({ rowNumber: index + 2, organization, personName, phone, externalId, action: 'error', error: 'Нужен телефон или ID записи', raw: row });
      continue;
    }
    if (phone && normalizedPhone.length < 10) {
      previews.push({ rowNumber: index + 2, organization, personName, phone, externalId, action: 'error', error: 'Некорректный телефон', raw: row });
      continue;
    }
    const key = externalKey(source, externalId);
    const externalContactId = key ? contactByExternalKey.get(key) : undefined;
    const phoneContactId = normalizedPhone ? contactByPhone.get(normalizedPhone) : undefined;
    if (identifiersConflict(externalContactId, phoneContactId)) {
      previews.push({ rowNumber: index + 2, organization, personName, phone, externalId, action: 'error',
        error: 'Телефон и ID записи относятся к разным контактам', raw: row });
      continue;
    }
    const knownContactId = externalContactId ?? phoneContactId;
    const contactId = knownContactId ?? `preview-contact-${index}`;
    const contactSourceKey = `${contactId}::${normalizeSource(source)}`;
    const action = contactByExternalKey.has(key ?? '') || leadContactSources.has(contactSourceKey) ? 'update' : 'create';
    previews.push({ rowNumber: index + 2, organization, personName, phone, externalId, action, raw: row });
    if (key) contactByExternalKey.set(key, contactId);
    leadContactSources.add(contactSourceKey);
    if (normalizedPhone) {
      const previousPhone = phoneByContact.get(contactId);
      if (previousPhone && previousPhone !== normalizedPhone && contactByPhone.get(previousPhone) === contactId) contactByPhone.delete(previousPhone);
      contactByPhone.set(normalizedPhone, contactId);
      phoneByContact.set(contactId, normalizedPhone);
    }
  }
  return previews;
}

function makeContact(row: Record<string, unknown>, mapping: ImportColumnMapping, id: string, now: string): Contact {
  const phone = mapped(row, mapping, 'phone');
  return {
    id,
    organization: mapped(row, mapping, 'organization'),
    taxId: mapped(row, mapping, 'taxId'),
    personName: mapped(row, mapping, 'personName'),
    position: mapped(row, mapping, 'position'),
    phone,
    normalizedPhone: normalizePhone(phone),
    secondaryPhone: mapped(row, mapping, 'secondaryPhone'),
    email: mapped(row, mapping, 'email'),
    address: mapped(row, mapping, 'address'),
    region: mapped(row, mapping, 'region'),
    website: mapped(row, mapping, 'website'),
    tags: mapped(row, mapping, 'tags').split(',').map((tag) => tag.trim()).filter(Boolean),
    customValues: {},
    createdAt: now,
    updatedAt: now,
  };
}

function updateContact(existing: Contact, incoming: Contact, now: string): Contact {
  const result = { ...existing, updatedAt: now };
  const keys: Array<keyof Pick<Contact, 'organization' | 'taxId' | 'personName' | 'position' | 'phone' | 'normalizedPhone' | 'secondaryPhone' | 'email' | 'address' | 'region' | 'website'>> = [
    'organization', 'taxId', 'personName', 'position', 'phone', 'normalizedPhone', 'secondaryPhone', 'email', 'address', 'region', 'website',
  ];
  for (const key of keys) if (incoming[key]) result[key] = incoming[key];
  if (incoming.tags.length > 0) result.tags = [...new Set([...existing.tags, ...incoming.tags])];
  return result;
}

type ImportSummary = { created: number; updated: number; skipped: number; errors: number };
type ImportState = {
  contactsById: Map<string, Contact>;
  contactsByPhone: Map<string, Contact>;
  leadsByKey: Map<string, Lead>;
  leadsByContactSource: Map<string, Lead>;
  commentKeys: Set<string>;
  lastActivityAt: number;
};

function linkedContact(state: ImportState, lead: Lead | undefined, phoneContact: Contact | undefined): Contact | undefined {
  return lead ? state.contactsById.get(lead.contactId) : phoneContact;
}

function linkedLead(state: ImportState, key: string | undefined, lead: Lead | undefined, contact: Contact | undefined, source: string): Lead | undefined {
  if (lead || !contact) return lead;
  return state.leadsByContactSource.get(`${contact.id}::${normalizeSource(source)}`);
}

async function loadImportState(): Promise<ImportState> {
  const [contacts, leads, comments] = await Promise.all([db.contacts.toArray(), db.leads.toArray(), db.comments.toArray()]);
  const leadsByContactSource = new Map<string, Lead>();
  for (const lead of leads.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) {
    leadsByContactSource.set(`${lead.contactId}::${normalizeSource(lead.source)}`, lead);
  }
  return {
    contactsById: new Map(contacts.map((contact) => [contact.id, contact])),
    contactsByPhone: new Map(contacts.flatMap((contact) => contact.normalizedPhone ? [[contact.normalizedPhone, contact] as const] : [])),
    leadsByKey: new Map(leads.flatMap((lead) => {
      const key = storedExternalKey(lead);
      return key ? [[key, lead] as const] : [];
    })),
    leadsByContactSource,
    commentKeys: new Set(comments.map((comment) => `${comment.leadId}::${comment.text}`)),
    lastActivityAt: 0,
  };
}

function makeLead(
  existing: Lead | undefined,
  preview: ImportPreviewRow,
  mapping: ImportColumnMapping,
  contactId: string,
  defaultStageId: string,
  source: string,
  key: string | undefined,
  createdAt: string,
  now: string,
): Lead {
  if (existing) return {
    ...existing,
    externalId: key ? preview.externalId.trim() : existing.externalId,
    externalKey: key ?? existing.externalKey,
    source: key ? source : existing.source,
    result: mapped(preview.raw, mapping, 'result') || existing.result,
    assignee: mapped(preview.raw, mapping, 'assignee') || existing.assignee,
    description: mapped(preview.raw, mapping, 'description') || existing.description,
    updatedAt: now,
  };
  return {
    id: createId(), contactId, stageId: defaultStageId, externalId: preview.externalId, externalKey: key,
    result: mapped(preview.raw, mapping, 'result'), source, description: mapped(preview.raw, mapping, 'description'),
    assignee: mapped(preview.raw, mapping, 'assignee') || 'Я', createdAt, updatedAt: now,
  };
}

async function processPreview(
  preview: ImportPreviewRow,
  mapping: ImportColumnMapping,
  defaultStageId: string,
  state: ImportState,
  summary: ImportSummary,
): Promise<void> {
  if (preview.action === 'error') { summary.errors += 1; return; }
  if (preview.action === 'skip') { summary.skipped += 1; return; }
  const now = new Date().toISOString();
  const sourceCreatedAt = importedDate(mapped(preview.raw, mapping, 'createdAt')) ?? now;
  const source = sourceLabel(mapped(preview.raw, mapping, 'source'));
  const key = externalKey(source, preview.externalId);
  const contactByPhone = state.contactsByPhone.get(normalizePhone(preview.phone));
  const leadByKey = key ? state.leadsByKey.get(key) : undefined;
  if (identifiersConflict(leadByKey?.contactId, contactByPhone?.id)) {
    summary.errors += 1;
    return;
  }
  const existingContact = linkedContact(state, leadByKey, contactByPhone);
  const existingLead = linkedLead(state, key, leadByKey, existingContact, source);
  const incoming = makeContact(preview.raw, mapping, existingContact?.id ?? createId(), now);
  const contact = existingContact ? updateContact(existingContact, incoming, now) : incoming;
  await db.contacts.put(contact);
  state.contactsById.set(contact.id, contact);
  const previousPhone = existingContact?.normalizedPhone;
  if (previousPhone && previousPhone !== contact.normalizedPhone && state.contactsByPhone.get(previousPhone)?.id === contact.id) {
    state.contactsByPhone.delete(previousPhone);
  }
  if (contact.normalizedPhone) state.contactsByPhone.set(contact.normalizedPhone, contact);
  const lead = makeLead(existingLead, preview, mapping, contact.id, defaultStageId, source, key, sourceCreatedAt, now);
  await db.leads.put(lead);
  state.leadsByKey.delete(existingLead?.externalKey ?? '');
  if (lead.externalKey) state.leadsByKey.set(lead.externalKey, lead);
  state.leadsByContactSource.set(`${lead.contactId}::${normalizeSource(lead.source)}`, lead);
  const initialComment = mapped(preview.raw, mapping, 'initialComment');
  const commentKey = `${lead.id}::${initialComment}`;
  if (initialComment && !state.commentKeys.has(commentKey)) {
    await db.comments.add({ id: createId(), leadId: lead.id, text: initialComment, author: 'Импорт', createdAt: sourceCreatedAt });
    state.commentKeys.add(commentKey);
  }
  const activity: ActivityItem = {
    id: createId(), leadId: lead.id, kind: 'imported', author: 'Система', createdAt: new Date(state.lastActivityAt = Math.max(Date.now(), state.lastActivityAt + 1)).toISOString(),
    text: existingLead ? 'Заявка обновлена из Excel' : 'Заявка создана из Excel',
  };
  await db.activities.add(activity);
  if (existingLead) summary.updated += 1; else summary.created += 1;
}

export async function commitImport(fileName: string, previews: ImportPreviewRow[], mapping: ImportColumnMapping,
  defaultStageId: string, onProgress?: (completed: number, total: number) => void): Promise<ImportSummary> {
  const summary: ImportSummary = { created: 0, updated: 0, skipped: 0, errors: 0 };
  await db.transaction('rw', [db.contacts, db.leads, db.stages, db.comments, db.activities, db.importJobs], async () => {
    const stage = await db.stages.get(defaultStageId);
    if (!stage || stage.archived) throw new Error('Активный этап для импорта не найден');
    const state = await loadImportState();
    for (const [index, preview] of previews.entries()) {
      await processPreview(preview, mapping, defaultStageId, state, summary);
      if ((index + 1) % 25 === 0 || index === previews.length - 1) onProgress?.(index + 1, previews.length);
    }
    await db.importJobs.add({ id: createId(), fileName, ...summary, createdAt: new Date().toISOString() });
  });
  return summary;
}

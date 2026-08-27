import { isValid, parse } from 'date-fns';
import { db } from '../../../infrastructure/database/database';
import { createId } from '../../../shared/lib/ids';
import { formatDateTime } from '../../../shared/lib/dates';
import { formatPhone, normalizePhone } from '../../../shared/lib/phone';
import type { ActivityItem, CallRecording, Contact, Lead } from '../../../shared/model/domain';

export const MAX_RECORDING_SIZE = 25 * 1024 * 1024;
export const MAX_RECORDINGS_PER_UPLOAD = 500;

const AUDIO_FILE = /\.(mp3|wav|ogg|oga|opus|m4a|aac|mp4|webm)$/i;
// Кол-центр называет файлы так: 21268751244_+79110733976_25.08.2026_12_28_01m40s.mp3.
// Идентификатор звонка в начале имени тоже 11 цифр, поэтому кандидаты сортируются
// по плюсу, а окончательный выбор делает совпадение с телефоном контакта.
const PHONE_IN_NAME = /(\+?)(\d{10,15})/g;
const RECORDED_AT_IN_NAME = /(\d{2}\.\d{2}\.\d{4})[_ -](\d{1,2})[_:.-](\d{2})/;

export type RecordingStatus = 'matched' | 'unmatched' | 'duplicate' | 'error';

export interface RecordingMatch {
  file: File;
  fileName: string;
  phone: string;
  recordedAt: string;
  status: RecordingStatus;
  leadId?: string;
  leadTitle?: string;
  error?: string;
}

type LeadTarget = { leadId: string; leadTitle: string };
type ReadyRecording = RecordingMatch & { leadId: string };

/** Телефоны из имени файла: сначала помеченные плюсом, затем по порядку появления. */
export function phoneCandidates(fileName: string): string[] {
  const found = [...fileName.matchAll(PHONE_IN_NAME)]
    .map((match, index) => ({ phone: normalizePhone(match[2]), plus: match[1] === '+', index }))
    .filter((candidate) => candidate.phone.length >= 10)
    .sort((left, right) => Number(right.plus) - Number(left.plus) || left.index - right.index);
  return [...new Set(found.map((candidate) => candidate.phone))];
}

export function recordedAtFromName(fileName: string, fallback: string): string {
  const match = RECORDED_AT_IN_NAME.exec(fileName);
  if (!match) return fallback;
  const [, date = '', hour = '', minute = ''] = match;
  const parsed = parse(`${date} ${hour}:${minute}`, 'dd.MM.yyyy H:mm', new Date());
  return isValid(parsed) ? parsed.toISOString() : fallback;
}

// Запись уходит в самую свежую заявку контакта: пачка приходит сразу после импорта,
// а старые заявки того же клиента к этому разговору не относятся.
function buildLeadIndex(contacts: Contact[], leads: Lead[]): Map<string, LeadTarget> {
  const newestByContact = new Map<string, Lead>();
  for (const lead of leads) {
    const current = newestByContact.get(lead.contactId);
    if (!current || lead.createdAt > current.createdAt) newestByContact.set(lead.contactId, lead);
  }
  const targets = contacts.flatMap((contact) => {
    const lead = newestByContact.get(contact.id);
    return lead ? [{ contact, target: { leadId: lead.id, leadTitle: contact.organization || contact.personName || formatPhone(contact.phone) } }] : [];
  });
  const index = new Map<string, LeadTarget>();
  for (const { contact, target } of targets) {
    if (contact.normalizedPhone.length >= 10) index.set(contact.normalizedPhone, target);
  }
  // Дополнительный телефон не перебивает основной: он же может принадлежать другому контакту.
  for (const { contact, target } of targets) {
    const secondary = normalizePhone(contact.secondaryPhone);
    if (secondary.length >= 10 && !index.has(secondary)) index.set(secondary, target);
  }
  return index;
}

function matchFile(file: File, index: Map<string, LeadTarget>, knownNames: Set<string>): RecordingMatch {
  const fileName = file.name;
  const base = { file, fileName, phone: '', recordedAt: recordedAtFromName(fileName, new Date(file.lastModified || Date.now()).toISOString()) };
  if (!AUDIO_FILE.test(fileName)) return { ...base, status: 'error', error: 'Не аудиофайл' };
  if (file.size > MAX_RECORDING_SIZE) return { ...base, status: 'error', error: 'Файл больше 25 МБ' };
  if (knownNames.has(fileName)) return { ...base, status: 'duplicate', error: 'Уже загружен' };
  knownNames.add(fileName);
  const candidates = phoneCandidates(fileName);
  const hit = candidates.flatMap((phone) => {
    const target = index.get(phone);
    return target ? [{ phone, ...target }] : [];
  })[0];
  if (!hit) return { ...base, phone: candidates[0] ?? '', status: 'unmatched', error: 'Заявка с таким номером не найдена' };
  return { ...base, phone: hit.phone, status: 'matched', leadId: hit.leadId, leadTitle: hit.leadTitle };
}

/** Раскладывает файлы по заявкам, ничего не записывая: результат показывается перед подтверждением. */
export async function matchRecordings(files: File[]): Promise<RecordingMatch[]> {
  if (files.length > MAX_RECORDINGS_PER_UPLOAD) {
    throw new Error(`За один раз можно загрузить не больше ${MAX_RECORDINGS_PER_UPLOAD} записей`);
  }
  const [contacts, leads, stored] = await Promise.all([db.contacts.toArray(), db.leads.toArray(), db.recordings.toArray()]);
  const index = buildLeadIndex(contacts, leads);
  const knownNames = new Set(stored.map((recording) => recording.fileName));
  return files.map((file) => matchFile(file, index, knownNames));
}

function isReady(match: RecordingMatch): match is ReadyRecording {
  return match.status === 'matched' && match.leadId !== undefined;
}

export async function saveRecordings(matches: RecordingMatch[]): Promise<number> {
  const ready = matches.filter(isReady);
  if (ready.length === 0) return 0;
  const now = new Date().toISOString();
  return db.transaction('rw', [db.recordings, db.activities, db.leads], async () => {
    const leads = await db.leads.bulkGet([...new Set(ready.map((match) => match.leadId))]);
    const existingLeadIds = new Set(leads.flatMap((lead) => lead ? [lead.id] : []));
    const attached = ready.filter((match) => existingLeadIds.has(match.leadId));
    const recordings: CallRecording[] = attached.map((match) => ({
      id: createId(), leadId: match.leadId, fileName: match.fileName, recordedAt: match.recordedAt, blob: match.file,
    }));
    const activities: ActivityItem[] = attached.map((match) => ({
      id: createId(), leadId: match.leadId, kind: 'imported', author: 'Система',
      text: `Прикреплена запись разговора, ${formatDateTime(match.recordedAt)}`, createdAt: now,
    }));
    await db.recordings.bulkAdd(recordings);
    await db.activities.bulkAdd(activities);
    return attached.length;
  });
}

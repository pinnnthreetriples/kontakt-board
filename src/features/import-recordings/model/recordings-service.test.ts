import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../../infrastructure/database/database';
import { deleteLead } from '../../../entities/lead/model/lead-service';
import { createLeadFixture, resetDatabase } from '../../../test/fixtures';
import { MAX_RECORDING_SIZE, matchRecordings, phoneCandidates, recordedAtFromName, saveRecordings } from './recordings-service';

const CALL_CENTER_NAME = '21268751244_+79110733976_25.08.2026_12_28_01m40s.mp3';

function audioFile(name: string, size = 1024): File {
  const file = new File([new Uint8Array(1)], name, { type: 'audio/mpeg' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

beforeEach(async () => {
  await resetDatabase();
});

describe('phoneCandidates', () => {
  it('в имени кол-центра предпочитает номер с плюсом, а не идентификатор звонка', () => {
    expect(phoneCandidates(CALL_CENTER_NAME)).toEqual(['79110733976', '21268751244']);
  });

  it('понимает имя из одного номера и восьмёрку в начале', () => {
    expect(phoneCandidates('89110733976.mp3')).toEqual(['79110733976']);
  });

  it('не берёт короткие числа из даты и длительности', () => {
    expect(phoneCandidates('запись_25.08.2026_12_28_01m40s.mp3')).toEqual([]);
  });
});

describe('recordedAtFromName', () => {
  it('читает дату и время звонка из имени файла', () => {
    expect(recordedAtFromName(CALL_CENTER_NAME, '2020-01-01T00:00:00.000Z')).toBe(new Date(2026, 7, 25, 12, 28).toISOString());
  });

  it('без даты в имени оставляет запасное значение', () => {
    expect(recordedAtFromName('call.mp3', '2020-01-01T00:00:00.000Z')).toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('matchRecordings', () => {
  it('привязывает запись к заявке контакта с тем же телефоном', async () => {
    const { contact, lead } = await createLeadFixture(0);
    const [match] = await matchRecordings([audioFile(`21268751244_+${contact.normalizedPhone}_25.08.2026_12_28_01m40s.mp3`)]);
    expect(match).toMatchObject({ status: 'matched', leadId: lead.id, phone: contact.normalizedPhone, leadTitle: contact.organization });
  });

  it('берёт самую свежую заявку контакта', async () => {
    const { contact, lead } = await createLeadFixture(0);
    const newer = { ...lead, id: 'lead-newer', externalId: 'newer', externalKey: 'тест::newer', createdAt: new Date(Date.now() + 60_000).toISOString() };
    await db.leads.add(newer);
    const [match] = await matchRecordings([audioFile(`+${contact.normalizedPhone}.mp3`)]);
    expect(match?.leadId).toBe(newer.id);
  });

  it('находит контакт по дополнительному телефону', async () => {
    const { contact, lead } = await createLeadFixture(0);
    await db.contacts.update(contact.id, { secondaryPhone: '+7 921 000-11-22' });
    const [match] = await matchRecordings([audioFile('79210001122.mp3')]);
    expect(match).toMatchObject({ status: 'matched', leadId: lead.id });
  });

  it('помечает файл без заявки, неаудио, слишком большой и повторный', async () => {
    const { contact } = await createLeadFixture(0);
    const matches = await matchRecordings([
      audioFile('+79990001122.mp3'),
      audioFile('запись.txt'),
      audioFile(`+${contact.normalizedPhone}_big.mp3`, MAX_RECORDING_SIZE + 1),
      audioFile(`+${contact.normalizedPhone}.mp3`),
      audioFile(`+${contact.normalizedPhone}.mp3`),
    ]);
    expect(matches.map((match) => match.status)).toEqual(['unmatched', 'error', 'error', 'matched', 'duplicate']);
  });

  it('считает повторной запись, уже лежащую в базе', async () => {
    const { contact } = await createLeadFixture(0);
    const file = audioFile(`+${contact.normalizedPhone}.mp3`);
    await saveRecordings(await matchRecordings([file]));
    const [match] = await matchRecordings([file]);
    expect(match?.status).toBe('duplicate');
  });
});

describe('saveRecordings', () => {
  it('сохраняет аудио, пишет событие в историю и отдаёт число прикреплённых', async () => {
    const { contact, lead } = await createLeadFixture(0);
    const attached = await saveRecordings(await matchRecordings([audioFile(`21268751244_+${contact.normalizedPhone}_25.08.2026_12_28_01m40s.mp3`)]));
    expect(attached).toBe(1);
    const stored = await db.recordings.where('leadId').equals(lead.id).toArray();
    expect(stored).toHaveLength(1);
    // Сам Blob не проверяется: fake-indexeddb не сохраняет файлы jsdom, это делает e2e-тест.
    expect(stored[0]?.fileName).toContain('_25.08.2026_');
    expect(stored[0]?.recordedAt).toBe(new Date(2026, 7, 25, 12, 28).toISOString());
    const activities = await db.activities.where('leadId').equals(lead.id).toArray();
    expect(activities.some((activity) => activity.text.startsWith('Прикреплена запись разговора'))).toBe(true);
  });

  it('не пишет ничего, когда прикреплять нечего', async () => {
    await createLeadFixture(0);
    expect(await saveRecordings(await matchRecordings([audioFile('+79990001122.mp3')]))).toBe(0);
    expect(await db.recordings.count()).toBe(0);
  });

  it('пропускает заявку, удалённую между проверкой и сохранением', async () => {
    const { contact, lead } = await createLeadFixture(0);
    const matches = await matchRecordings([audioFile(`+${contact.normalizedPhone}.mp3`)]);
    await deleteLead(lead.id);
    expect(await saveRecordings(matches)).toBe(0);
  });

  it('удаляет записи вместе с заявкой', async () => {
    const { contact, lead } = await createLeadFixture(0);
    await saveRecordings(await matchRecordings([audioFile(`+${contact.normalizedPhone}.mp3`)]));
    await deleteLead(lead.id);
    expect(await db.recordings.count()).toBe(0);
  });
});

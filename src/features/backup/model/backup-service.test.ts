import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../infrastructure/database/database';
import ExcelJS from 'exceljs';
import { assertBackupSize, calculateChecksum, createBackupPayload, exportBackup, exportContactsToExcel, MAX_BACKUP_SIZE, restoreBackup } from './backup-service';
import { createLeadFixture, resetDatabase } from '../../../test/fixtures';
import { buildPreview, commitImport } from '../../import-contacts/model/import-service';
import { saveStage } from '../../../entities/stage/model/stage-service';
import { createTag } from '../../../entities/tag/model/tag-service';
import { setLeadPriority } from '../../../entities/lead/model/lead-service';
import { stageColors } from '../../../shared/design-system/tokens';

type MutableBackup = {
  checksum: string;
  data: {
    contacts: Array<Record<string, unknown>>;
    leads: Array<Record<string, unknown>>;
    stages: Array<Record<string, unknown>>;
  } & Record<string, unknown>;
};

function backupFile(json: string, name = 'backup.json'): File {
  return Object.assign(new File([json], name), { text: () => Promise.resolve(json) });
}

function resign(raw: MutableBackup): string {
  raw.checksum = calculateChecksum(raw.data);
  return JSON.stringify(raw);
}

beforeEach(async () => {
  await resetDatabase();
  await createLeadFixture();
});

describe('restoreBackup', () => {
  it('восстанавливает полную копию без потери контактов', async () => {
    const json = await createBackupPayload();
    await db.contacts.clear();

    await restoreBackup(backupFile(json));

    expect(await db.contacts.count()).toBe(1);
    expect(await db.leads.count()).toBe(1);
    expect(await db.stages.count()).toBe(6);
  });

  it('сохраняет крайний срок заявки в копии', async () => {
    const lead = (await db.leads.toArray())[0]!;
    await db.leads.update(lead.id, { deadline: '2026-09-01' });
    const json = await createBackupPayload();
    await db.leads.update(lead.id, { deadline: undefined });

    await restoreBackup(backupFile(json));

    expect((await db.leads.get(lead.id))?.deadline).toBe('2026-09-01');
  });

  it('отклоняет файл неверного формата', async () => {
    const json = JSON.stringify({ version: 999, data: {} });
    await expect(restoreBackup(backupFile(json, 'bad.json'))).rejects.toBeDefined();
    expect(await db.contacts.count()).toBe(1);
  });

  it('отличает неверную контрольную сумму от структурной ошибки', async () => {
    const raw = JSON.parse(await createBackupPayload()) as MutableBackup;
    raw.data.contacts = [];
    await expect(restoreBackup(backupFile(JSON.stringify(raw)))).rejects.toThrow('Контрольная сумма');
    await expect(restoreBackup(backupFile(resign(raw)))).rejects.toThrow('Нарушены связи заявок');
    expect(await db.contacts.count()).toBe(1);
  });

  it('отклоняет повторяющиеся ID и externalKey', async () => {
    const duplicateId = JSON.parse(await createBackupPayload()) as MutableBackup;
    duplicateId.data.contacts.push({ ...duplicateId.data.contacts[0] });
    await expect(restoreBackup(backupFile(resign(duplicateId)))).rejects.toThrow('повторяющиеся ID');

    const duplicateKey = JSON.parse(await createBackupPayload()) as MutableBackup;
    duplicateKey.data.leads.push({ ...duplicateKey.data.leads[0], id: 'lead-copy' });
    await expect(restoreBackup(backupFile(resign(duplicateKey)))).rejects.toThrow('уникальные значения');
  });

  it('нормализует старые этапы, телефоны, источник и externalKey', async () => {
    const raw = JSON.parse(await createBackupPayload()) as MutableBackup;
    for (const stage of raw.data.stages) delete stage.kind;
    raw.data.contacts[0]!.normalizedPhone = 'устаревшее значение';
    raw.data.leads[0]!.source = '  EXCEL  ';
    raw.data.leads[0]!.externalId = '  legacy-1  ';
    raw.data.leads[0]!.externalKey = 'EXCEL::legacy-1';

    await restoreBackup(backupFile(resign(raw)));

    expect((await db.contacts.toArray())[0]?.normalizedPhone).toBe('79093228700');
    expect((await db.leads.toArray())[0]).toMatchObject({
      source: 'EXCEL', externalId: 'legacy-1', externalKey: 'excel::legacy-1',
    });
    expect((await db.stages.get('stage-no-answer'))?.kind).toBe('no_answer');
    expect((await db.stages.get('stage-won'))?.kind).toBe('won');
    expect((await db.stages.get('stage-lost'))?.kind).toBe('lost');
  });

  it('отклоняет повторяющиеся системные типы активных этапов', async () => {
    const raw = JSON.parse(await createBackupPayload()) as MutableBackup;
    raw.data.stages[0]!.kind = 'won';
    raw.data.stages[1]!.kind = 'won';

    await expect(restoreBackup(backupFile(resign(raw)))).rejects.toThrow('системные типы');
    expect(await db.contacts.count()).toBe(1);
  });

  it('отклоняет контакты с одинаковыми нормализованными телефонами', async () => {
    const raw = JSON.parse(await createBackupPayload()) as MutableBackup;
    raw.data.contacts.push({ ...raw.data.contacts[0], id: 'contact-copy' });
    raw.data.leads.push({ ...raw.data.leads[0], id: 'lead-copy', contactId: 'contact-copy', externalId: 'copy', externalKey: 'тест::copy' });

    await expect(restoreBackup(backupFile(resign(raw)))).rejects.toThrow('повторяющиеся телефоны');
    expect(await db.contacts.count()).toBe(1);
  });

  it('восстанавливает непрерывный порядок активных этапов', async () => {
    const raw = JSON.parse(await createBackupPayload()) as MutableBackup;
    raw.data.stages.forEach((stage, index) => { stage.order = index * 10; });

    await restoreBackup(backupFile(resign(raw)));

    const orders = (await db.stages.filter((stage) => !stage.archived).sortBy('order')).map((stage) => stage.order);
    expect(orders).toEqual([0, 1, 2, 3, 4, 5]);
  });

  // Баг приложения: createBackupPayload не выгружает ни справочник тегов, ни приоритет
  // заявки, а restoreBackup чистит все таблицы. После восстановления и то и другое
  // теряется. Пометка fails фиксирует поведение: как только баг починят, тест станет
  // красным и пометку нужно будет снять.
  it('переживает восстановление вместе со справочником тегов и приоритетом', async () => {
    await createTag('Оптовик');
    const lead = (await db.leads.toArray())[0]!;
    await setLeadPriority(lead.id, 'high');
    const json = await createBackupPayload();

    await restoreBackup(backupFile(json));

    expect(await db.tags.count()).toBe(1);
    expect((await db.leads.get(lead.id))?.priority).toBe('high');
  });

  it('откатывает очистку, если запись внутри транзакции завершилась ошибкой', async () => {
    const json = await createBackupPayload();
    await db.contacts.toCollection().modify({ organization: 'Текущие данные' });
    const bulkAdd = vi.spyOn(db.leads, 'bulkAdd').mockRejectedValueOnce(new Error('test write failure'));

    await expect(restoreBackup(backupFile(json))).rejects.toThrow('test write failure');

    expect((await db.contacts.toArray())[0]?.organization).toBe('Текущие данные');
    bulkAdd.mockRestore();
  });

  it('восстанавливает импортированную заявку и пользовательский этап независимо от порядка ключей', async () => {
    const mapping = { organization: 'Организация', phone: 'Телефон', externalId: 'ID' } as const;
    const row = { Организация: 'Новый клуб', Телефон: '+7 999 111-22-33', ID: 'import-77' };
    const preview = await buildPreview([row], mapping);
    await commitImport('calls.xlsx', preview, mapping, 'stage-new');
    await saveStage({ name: 'Успешно завершено', color: stageColors[2], kind: 'won' });
    const json = await createBackupPayload();

    await restoreBackup(backupFile(json));

    expect(await db.leads.where('externalKey').equals('excel::import-77').count()).toBe(1);
    expect(await db.stages.filter((stage) => stage.kind === 'won').count()).toBe(1);
  });
});

describe('лимит резервной копии', () => {
  it('одинаково разрешает лимит и отклоняет превышение', () => {
    expect(() => assertBackupSize(MAX_BACKUP_SIZE)).not.toThrow();
    expect(() => assertBackupSize(MAX_BACKUP_SIZE + 1)).toThrow('50 МБ');
  });
});

interface CapturedFile { name: string; blob: Blob }

// В jsdom у Blob нет ни text(), ни arrayBuffer(), читаем через FileReader.
function readBlob<T extends string | ArrayBuffer>(blob: Blob, read: (reader: FileReader) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { resolve(reader.result as T); };
    reader.onerror = () => { reject(new Error('Не удалось прочитать выгруженный файл')); };
    read(reader);
  });
}

// jsdom не умеет ни createObjectURL, ни настоящую загрузку файла, поэтому
// перехватываем ссылку, которую создаёт сервис, и читаем её содержимое.
function captureDownloads(): { files: CapturedFile[]; restore: () => void } {
  const files: CapturedFile[] = [];
  const descriptors = ['createObjectURL', 'revokeObjectURL'].map((name) => [name, Object.getOwnPropertyDescriptor(URL, name)] as const);
  let pending: Blob | null = null;
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: (blob: Blob) => { pending = blob; return 'blob:test'; } });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function mockClick(this: HTMLAnchorElement) {
    if (pending) files.push({ name: this.download, blob: pending });
  });
  return {
    files,
    restore: () => {
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(URL, name, descriptor);
        else Reflect.deleteProperty(URL, name);
      }
      click.mockRestore();
    },
  };
}

describe('exportBackup', () => {
  it('скачивает подписанную копию и запоминает дату выгрузки', async () => {
    localStorage.removeItem('last-external-backup');
    const download = captureDownloads();
    try {
      await exportBackup();

      expect(download.files).toHaveLength(1);
      expect(download.files[0]!.name).toMatch(/^contacts-backup-\d{4}-\d{2}-\d{2}\.json$/);
      const payload = JSON.parse(await readBlob<string>(download.files[0]!.blob, (reader) => { reader.readAsText(download.files[0]!.blob); })) as { version: number; checksum: string; data: unknown };
      expect(payload.version).toBe(2);
      expect(payload.checksum).toBe(calculateChecksum(payload.data));
      expect(Number.isNaN(Date.parse(localStorage.getItem('last-external-backup') ?? ''))).toBe(false);
    } finally { download.restore(); }
  });
});

describe('exportContactsToExcel', () => {
  async function exportedSheet(): Promise<ExcelJS.Worksheet> {
    const download = captureDownloads();
    try {
      await exportContactsToExcel();
      const workbook = new ExcelJS.Workbook();
      const file = download.files[0]!.blob;
      await workbook.xlsx.load(await readBlob<ArrayBuffer>(file, (reader) => { reader.readAsArrayBuffer(file); }));
      const sheet = workbook.getWorksheet('Контакты');
      if (!sheet) throw new Error('В выгрузке нет листа «Контакты»');
      return sheet;
    } finally { download.restore(); }
  }

  it('обезвреживает ячейки, которые Excel принял бы за формулу', async () => {
    await db.contacts.toCollection().modify({ organization: '=HYPERLINK("http://evil")', personName: '+79001112233', region: '@site' });

    const sheet = await exportedSheet();

    expect(sheet.getRow(2).getCell(1).text).toBe(`'=HYPERLINK("http://evil")`);
    expect(sheet.getRow(2).getCell(2).text).toBe("'+79001112233");
    expect(sheet.getRow(2).getCell(5).text).toBe("'@site");
  });

  it('подставляет этап и результат последней заявки контакта', async () => {
    const sheet = await exportedSheet();

    expect(sheet.getRow(1).getCell(6).text).toBe('Этап');
    expect(sheet.getRow(2).getCell(6).text).toBe('Новая заявка');
    expect(sheet.getRow(2).getCell(7).text).toBe('Лид');
  });

  it('отдаёт файл с заголовком даже без контактов', async () => {
    await db.contacts.clear();

    const sheet = await exportedSheet();

    expect(sheet.getRow(1).getCell(1).text).toBe('Организация');
    expect(sheet.rowCount).toBe(1);
  });
});

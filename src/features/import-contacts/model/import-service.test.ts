import { beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { db } from '../../../infrastructure/database/database';
import { normalizePhone } from '../../../shared/lib/phone';
import { DEFAULT_STAGES } from '../../../infrastructure/database/seed';
import { addComment } from '../../../entities/lead/model/lead-service';
import type { ImportColumnMapping } from '../../../shared/model/domain';
import { suggestMapping } from './import-mapping';
import { buildPreview, commitImport, MAX_IMPORT_ROWS, parseWorkbook } from './import-service';

const mapping: ImportColumnMapping = {
  organization: 'Организация',
  personName: 'Контакт',
  phone: 'Телефон',
  externalId: 'ID записи',
  result: 'Результат',
};

const row = {
  Организация: 'Клуб Тайфун',
  Контакт: 'Анна',
  Телефон: '+7 909 322-87-04',
  'ID записи': '21300000001',
  Результат: 'Лид',
};

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.stages.bulkAdd(DEFAULT_STAGES);
});

describe('suggestMapping', () => {
  it('понимает русские заголовки и другой регистр', () => {
    expect(suggestMapping(['ОРГАНИЗАЦИЯ', 'Телефон', 'ID записи'])).toMatchObject({
      organization: 'ОРГАНИЗАЦИЯ', phone: 'Телефон', externalId: 'ID записи',
    });
  });

  it('понимает заголовки выгрузки звонков с уточнениями', () => {
    const headers = [
      'Результат', 'Организация', 'ИНН', 'Контакт', 'Должность', 'Комментарий',
      'Телефон, на который звонили', 'Телефон основного контакта', 'E-mail основного контакта',
      'Описание контакта', 'Сфера деятельности', 'Адрес', 'Регион', 'Сайт', 'Теги',
      'Сотрудник', 'Дата', 'ID записи',
    ];
    const mapping = suggestMapping(headers);
    expect(mapping).toMatchObject({
      result: 'Результат', organization: 'Организация', taxId: 'ИНН', personName: 'Контакт',
      position: 'Должность', description: 'Комментарий', phone: 'Телефон, на который звонили',
      email: 'E-mail основного контакта', address: 'Адрес', region: 'Регион', website: 'Сайт',
      assignee: 'Сотрудник', createdAt: 'Дата', externalId: 'ID записи',
    });
    expect(mapping.tags).toBeUndefined();
    expect(mapping.initialComment).toBeUndefined();
  });

  it('не отдаёт один столбец двум полям', () => {
    const mapping = suggestMapping(['Телефон основного контакта', 'Описание контакта']);
    expect(mapping.phone).toBe('Телефон основного контакта');
    expect(mapping.personName).toBeUndefined();
  });
});

describe('parseWorkbook', () => {
  it('читает реальные ячейки XLSX как текст', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Заявки');
    sheet.addRow(['Организация', 'Телефон', 'ID записи']);
    sheet.addRow(['Клуб Дан', '+7 905 016-26-16', '21300000001']);
    const buffer = await workbook.xlsx.writeBuffer();
    const bytes = new Uint8Array(buffer);
    const file = Object.assign(new File([bytes], 'calls.xlsx'), { arrayBuffer: () => Promise.resolve(bytes.buffer) });

    const parsed = await parseWorkbook(file);

    expect(parsed[0]?.headers).toEqual(['Организация', 'Телефон', 'ID записи']);
    expect(parsed[0]?.rows[0]).toMatchObject({ Телефон: '+7 905 016-26-16', 'ID записи': '21300000001' });
  });

  it('ограничивает суммарное число строк во всех листах', async () => {
    const workbook = new ExcelJS.Workbook();
    const first = workbook.addWorksheet('Первый');
    const second = workbook.addWorksheet('Второй');
    first.getCell(1, 1).value = 'Телефон';
    first.getCell(10_002, 1).value = '+7 900 000-00-01';
    second.getCell(1, 1).value = 'Телефон';
    second.getCell(MAX_IMPORT_ROWS - 10_000 + 1, 1).value = '+7 900 000-00-02';
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    const file = Object.assign(new File([bytes], 'large.xlsx'), { arrayBuffer: () => Promise.resolve(bytes.buffer) });

    await expect(parseWorkbook(file)).rejects.toThrow('строк суммарно');
  });

  it('ограничивает число листов и столбцов', async () => {
    const manySheets = new ExcelJS.Workbook();
    for (let index = 0; index < 51; index += 1) manySheets.addWorksheet(`Лист ${index + 1}`);
    const sheetsBytes = new Uint8Array(await manySheets.xlsx.writeBuffer());
    const sheetsFile = Object.assign(new File([sheetsBytes], 'sheets.xlsx'), { arrayBuffer: () => Promise.resolve(sheetsBytes.buffer) });
    await expect(parseWorkbook(sheetsFile)).rejects.toThrow('больше 50 листов');

    const manyColumns = new ExcelJS.Workbook();
    manyColumns.addWorksheet('Широкий').getCell(1, 251).value = 'Лишний столбец';
    const columnsBytes = new Uint8Array(await manyColumns.xlsx.writeBuffer());
    const columnsFile = Object.assign(new File([columnsBytes], 'columns.xlsx'), { arrayBuffer: () => Promise.resolve(columnsBytes.buffer) });
    await expect(parseWorkbook(columnsFile)).rejects.toThrow('больше 250 столбцов');
  });
});

describe('импорт контактов', () => {
  it('создаёт контакт после предпросмотра', async () => {
    const preview = await buildPreview([row], mapping);
    expect(preview[0]?.action).toBe('create');
    const result = await commitImport('calls.xlsx', preview, mapping, DEFAULT_STAGES[0]!.id);
    expect(result).toEqual({ created: 1, updated: 0, skipped: 0, errors: 0 });
    expect(await db.contacts.count()).toBe(1);
    expect((await db.contacts.toArray())[0]?.normalizedPhone).toBe('79093228704');
  });

  it('откатывает импорт, если этап отсутствует или архивирован', async () => {
    const preview = await buildPreview([row], mapping);
    await db.stages.update(DEFAULT_STAGES[0]!.id, { archived: true });
    await expect(commitImport('calls.xlsx', preview, mapping, DEFAULT_STAGES[0]!.id)).rejects.toThrow('Активный этап');
    expect(await db.contacts.count()).toBe(0);
    expect(await db.leads.count()).toBe(0);
    expect(await db.importJobs.count()).toBe(0);
  });

  it('повторный импорт обновляет, но не удаляет комментарии', async () => {
    const firstPreview = await buildPreview([row], mapping);
    await commitImport('calls.xlsx', firstPreview, mapping, DEFAULT_STAGES[0]!.id);
    const lead = (await db.leads.toArray())[0]!;
    await addComment(lead.id, 'Позвонить после обеда');

    const updatedRow = { ...row, Организация: 'Клуб Тайфун 2' };
    const secondPreview = await buildPreview([updatedRow], mapping);
    expect(secondPreview[0]?.action).toBe('update');
    const result = await commitImport('calls-2.xlsx', secondPreview, mapping, DEFAULT_STAGES[0]!.id);

    expect(result.updated).toBe(1);
    expect(await db.contacts.count()).toBe(1);
    expect(await db.leads.count()).toBe(1);
    expect(await db.comments.where('leadId').equals(lead.id).count()).toBe(1);
    expect((await db.contacts.toArray())[0]?.organization).toBe('Клуб Тайфун 2');
  });

  it('помечает некорректный телефон, не записывая строку', async () => {
    const preview = await buildPreview([{ ...row, Телефон: '123' }], mapping);
    expect(preview[0]).toMatchObject({ action: 'error', error: 'Некорректный телефон' });
    const result = await commitImport('bad.xlsx', preview, mapping, DEFAULT_STAGES[0]!.id);
    expect(result.errors).toBe(1);
    expect(await db.contacts.count()).toBe(0);
  });

  it('не склеивает строки без телефона и ID', async () => {
    const preview = await buildPreview([{ ...row, Телефон: '', 'ID записи': '' }], mapping);
    expect(preview[0]).toMatchObject({ action: 'error', error: 'Нужен телефон или ID записи' });
    await commitImport('empty-phone.xlsx', preview, mapping, DEFAULT_STAGES[0]!.id);
    expect(await db.contacts.count()).toBe(0);
  });

  it('повторный импорт без ID не создаёт новую карточку', async () => {
    const noIdRow = { ...row, 'ID записи': '' };
    await commitImport('first.xlsx', await buildPreview([noIdRow], mapping), mapping, DEFAULT_STAGES[0]!.id);
    await commitImport('second.xlsx', await buildPreview([noIdRow], mapping), mapping, DEFAULT_STAGES[0]!.id);
    expect(await db.contacts.count()).toBe(1);
    expect(await db.leads.count()).toBe(1);
  });

  it('новый ID у того же телефона и источника обновляет заявку', async () => {
    await commitImport('first.xlsx', await buildPreview([row], mapping), mapping, DEFAULT_STAGES[0]!.id);
    const changedId = { ...row, Организация: 'Обновлённый клуб', 'ID записи': '21300000099' };
    const preview = await buildPreview([changedId], mapping);

    expect(preview[0]?.action).toBe('update');
    expect(await commitImport('second.xlsx', preview, mapping, DEFAULT_STAGES[0]!.id)).toMatchObject({ created: 0, updated: 1 });
    expect(await db.contacts.count()).toBe(1);
    expect(await db.leads.count()).toBe(1);
    expect((await db.leads.toArray())[0]?.externalKey).toBe('excel::21300000099');
  });

  it('одинаковые ID из разных источников не конфликтуют', async () => {
    const sourceMapping = { ...mapping, source: 'Источник' };
    const rows = [{ ...row, Источник: 'Колл-центр A' }, { ...row, Телефон: '+7 922 222-22-22', Источник: 'Колл-центр B' }];
    await commitImport('sources.xlsx', await buildPreview(rows, sourceMapping), sourceMapping, DEFAULT_STAGES[0]!.id);
    expect(await db.leads.count()).toBe(2);
  });

  it('нормализует регистр и пробелы источника при дедупликации', async () => {
    const sourceMapping = { ...mapping, source: 'Источник' };
    await commitImport(
      'first.xlsx',
      await buildPreview([{ ...row, Источник: 'Колл-центр A' }], sourceMapping),
      sourceMapping,
      DEFAULT_STAGES[0]!.id,
    );
    const updated = { ...row, Организация: 'После обновления', Источник: '  КОЛЛ-ЦЕНТР A  ' };
    const preview = await buildPreview([updated], sourceMapping);

    expect(preview[0]?.action).toBe('update');
    expect(await commitImport('second.xlsx', preview, sourceMapping, DEFAULT_STAGES[0]!.id)).toMatchObject({ created: 0, updated: 1 });
    expect(await db.leads.count()).toBe(1);
    expect((await db.leads.toArray())[0]?.externalKey).toBe('колл-центр a::21300000001');
  });

  it('удаляет старый телефон из карты дедупликации внутри одной пачки', async () => {
    await commitImport('seed.xlsx', await buildPreview([row], mapping), mapping, DEFAULT_STAGES[0]!.id);
    const moved = { ...row, Телефон: '+7 999 000-00-01' };
    const replacement = { ...row, Организация: 'Новый контакт', 'ID записи': '' };
    const preview = await buildPreview([moved, replacement], mapping);

    expect(preview.map((item) => item.action)).toEqual(['update', 'create']);
    expect(await commitImport('batch.xlsx', preview, mapping, DEFAULT_STAGES[0]!.id)).toEqual({
      created: 1, updated: 1, skipped: 0, errors: 0,
    });
    expect(await db.contacts.count()).toBe(2);
    expect(await db.leads.count()).toBe(2);
    expect(await db.activities.count()).toBe(3);
  });

  it('не смешивает контакты, когда ID и телефон принадлежат разным записям', async () => {
    const another = { ...row, Телефон: '+7 999 000-00-02', 'ID записи': '21300000002' };
    await commitImport('seed.xlsx', await buildPreview([row, another], mapping), mapping, DEFAULT_STAGES[0]!.id);
    const conflicting = { ...row, Телефон: another.Телефон };
    const preview = await buildPreview([conflicting], mapping);

    expect(preview[0]).toMatchObject({ action: 'error', error: 'Телефон и ID записи относятся к разным контактам' });
    expect(await commitImport('conflict.xlsx', preview, mapping, DEFAULT_STAGES[0]!.id)).toEqual({
      created: 0, updated: 0, skipped: 0, errors: 1,
    });
    expect(await db.contacts.count()).toBe(2);
    expect(await db.activities.count()).toBe(2);
  });

  it('показывает дубли внутри одного файла как create/update', async () => {
    const previews = await buildPreview([row, { ...row, Организация: 'Обновлённое название' }], mapping);
    expect(previews.map((item) => item.action)).toEqual(['create', 'update']);
    const result = await commitImport('duplicates.xlsx', previews, mapping, DEFAULT_STAGES[0]!.id);
    expect(result).toEqual({ created: 1, updated: 1, skipped: 0, errors: 0 });
    expect(await db.leads.count()).toBe(1);
    expect((await db.activities.orderBy('createdAt').toArray()).map((item) => item.text)).toEqual([
      'Заявка создана из Excel', 'Заявка обновлена из Excel',
    ]);
  });

  it('переносит комментарий из файла и не дублирует его при повторном импорте', async () => {
    const withComment: ImportColumnMapping = { ...mapping, initialComment: 'Комментарий', createdAt: 'Дата' };
    const commentRow = { ...row, Комментарий: 'Звонили в июле, просили перезвонить', Дата: '14.07.2026' };

    await commitImport('calls.xlsx', await buildPreview([commentRow], withComment), withComment, 'stage-new');

    const comments = await db.comments.toArray();
    expect(comments.map((comment) => [comment.text, comment.author])).toEqual([['Звонили в июле, просили перезвонить', 'Импорт']]);
    // Дата из файла читается в местном поясе, поэтому и ожидание строится так же.
    expect(comments[0]?.createdAt).toBe(new Date(2026, 6, 14).toISOString());

    await commitImport('calls.xlsx', await buildPreview([commentRow], withComment), withComment, 'stage-new');

    expect(await db.comments.count()).toBe(1);
  });

  it('считает ошибкой строку, у которой ID и телефон разошлись уже после предпросмотра', async () => {
    const preview = await buildPreview([row], mapping);
    expect(preview[0]?.action).toBe('create');

    const now = new Date().toISOString();
    const contact = (id: string, phone: string) => ({
      id, organization: id, taxId: '', personName: '', position: '', phone, normalizedPhone: normalizePhone(phone),
      secondaryPhone: '', email: '', address: '', region: '', website: '', tags: [], customValues: {}, createdAt: now, updatedAt: now,
    });
    await db.contacts.bulkAdd([contact('contact-phone', '+7 909 322-87-04'), contact('contact-external', '+7 999 000-11-22')]);
    await db.leads.add({
      id: 'lead-external', contactId: 'contact-external', stageId: 'stage-new', externalId: '21300000001',
      externalKey: 'excel::21300000001', source: 'Excel', result: '', description: '', assignee: 'Я', createdAt: now, updatedAt: now,
    });

    const summary = await commitImport('calls.xlsx', preview, mapping, 'stage-new');

    expect(summary).toMatchObject({ created: 0, updated: 0, errors: 1 });
    expect(await db.contacts.count()).toBe(2);
    expect(await db.leads.count()).toBe(1);
  });
});

describe('теги партии', () => {
  it('проставляются всем заявкам файла и получают цвет в справочнике', async () => {
    const second = { ...row, Телефон: '+7 909 322-87-05', 'ID записи': '21300000002' };
    const preview = await buildPreview([row, second], mapping);

    await commitImport('calls.xlsx', preview, mapping, DEFAULT_STAGES[0]!.id, undefined, ['Акрато 25.08', ' Акрато 25.08 ', '']);

    const contacts = await db.contacts.toArray();
    expect(contacts).toHaveLength(2);
    expect(contacts.every((contact) => contact.tags.includes('Акрато 25.08'))).toBe(true);
    const tags = await db.tags.toArray();
    expect(tags).toHaveLength(1);
    expect(tags[0]?.color).toBeTruthy();
  });

  it('добавляются и при повторном импорте того же контакта', async () => {
    await commitImport('first.xlsx', await buildPreview([row], mapping), mapping, DEFAULT_STAGES[0]!.id);

    await commitImport('second.xlsx', await buildPreview([row], mapping), mapping, DEFAULT_STAGES[0]!.id, undefined, ['Повтор']);

    const contact = await db.contacts.toCollection().first();
    expect(contact?.tags).toContain('Повтор');
    expect(await db.contacts.count()).toBe(1);
  });
});

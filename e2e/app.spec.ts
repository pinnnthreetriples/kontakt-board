import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import { openApp, seriousAccessibilityIssues } from './helpers';

async function importFixtureBuffer(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Заявки');
  sheet.addRow(['Организация', 'Контакт', 'Телефон', 'ID записи']);
  sheet.addRow(['Клуб Тайфун', 'Анна', '+7 909 322-87-04', '21300000001']);
  sheet.addRow(['Клуб Тайфун обновлён', 'Анна', '+7 909 322-87-04', '21300000001']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test('основные разделы открываются и доступны с клавиатуры', async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole('heading', { name: 'Канбан' })).toBeVisible();
  await page.getByRole('link', { name: 'Звонки' }).click();
  await expect(page.getByText('Здесь собраны все назначенные звонки.')).toBeVisible();
  await page.keyboard.press('Control+i');
  await expect(page.getByText('Выберите Excel-файл')).toBeVisible();
});

test('ключевой экран не содержит серьёзных ошибок доступности', async ({ page }) => {
  await openApp(page, '/board');
  await expect(page.getByRole('heading', { name: 'Канбан' })).toBeVisible();
  expect(await seriousAccessibilityIssues(page)).toEqual([]);
});

test('импорт показывает дубль, сохраняет карточку и переживает перезагрузку', async ({ page }) => {
  await openApp(page, '/import');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'calls.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await importFixtureBuffer(),
  });
  await expect(page.getByText('2 строк')).toBeVisible();
  await page.getByRole('button', { name: 'Проверить данные' }).click();
  await expect(page.getByText('Новые: 1')).toBeVisible();
  await expect(page.getByText('Обновятся: 1')).toBeVisible();
  await page.getByRole('button', { name: 'Импортировать 2' }).click();
  await expect(page.getByRole('heading', { name: 'Импорт завершён' })).toBeVisible();
  await page.getByRole('link', { name: 'Канбан' }).click();
  await expect(page.getByText('Клуб Тайфун обновлён')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Клуб Тайфун обновлён')).toBeVisible();
});

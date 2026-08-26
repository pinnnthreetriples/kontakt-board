import { expect, test } from '@playwright/test';
import { createContact, leadCard, openApp } from './helpers';

test('контакт, добавленный вручную, попадает в список и на доску', async ({ page }) => {
  await openApp(page, '/contacts');
  await expect(page.getByText('Контактов пока нет')).toBeVisible();

  await createContact(page, 'Клуб Ромашка', '+7 909 322-87-11');
  await leadCard(page).getByRole('button', { name: 'Закрыть', exact: true }).click();

  const row = page.getByRole('row', { name: 'Открыть контакт Клуб Ромашка' });
  await expect(row).toBeVisible();
  await expect(row.getByText('+7 909 322-87-11')).toBeVisible();
  await expect(page.getByText('Всего контактов: 1')).toBeVisible();

  await page.getByRole('link', { name: 'Канбан' }).click();
  await expect(page.getByRole('button', { name: 'Открыть контакт Клуб Ромашка' })).toBeVisible();
});

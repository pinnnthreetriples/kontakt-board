import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Открывает приложение и дожидается оболочки.
 *
 * Первая загрузка в чистом профиле проверяется без перезагрузки намеренно: так тест
 * ловит возврат гонки сидирования, из-за которой приложение падало с ошибкой БД.
 */
export async function openApp(page: Page, route = '/board'): Promise<void> {
  await page.goto(`/#${route}`);
  await expect(page.getByText('Не удалось открыть локальную базу данных')).toBeHidden();
  await expect(page.getByRole('link', { name: 'Канбан' })).toBeVisible();
}

/** Карточка заявки: центрированный диалог без заголовка, узнаётся по кнопке тегов. */
export function leadCard(page: Page): Locator {
  return page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Изменить теги' }) });
}

/**
 * Создаёт контакт вручную со страницы «Все контакты».
 * После сохранения приложение само открывает карточку новой заявки.
 */
export async function createContact(page: Page, organization: string, phone: string): Promise<void> {
  await page.getByRole('button', { name: 'Добавить контакт' }).click();
  const form = page.getByRole('dialog', { name: 'Добавить контакт' });
  await form.getByRole('textbox', { name: 'Организация' }).fill(organization);
  await form.getByRole('textbox', { name: 'Телефон' }).fill(phone);
  await form.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(leadCard(page)).toBeVisible();
}

/** Открывает «Все контакты», создаёт заявку и оставляет её карточку открытой. */
export async function openFreshLeadCard(page: Page, organization: string, phone: string): Promise<Locator> {
  await openApp(page, '/contacts');
  await createContact(page, organization, phone);
  return leadCard(page);
}

/** Список исключений пуст: серьёзные нарушения доступности роняют прогон. */
const KNOWN_ISSUES: string[] = [];

export async function seriousAccessibilityIssues(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((item) => ['serious', 'critical'].includes(item.impact ?? '') && !KNOWN_ISSUES.includes(item.id))
    .map((item) => `${item.id}: ${item.help} -> ${item.nodes.map((node) => node.target.join(' ')).join(' | ')}`);
}

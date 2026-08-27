import { expect, test } from '@playwright/test';
import { leadCard, openApp, openFreshLeadCard, seriousAccessibilityIssues } from './helpers';

test('этап меняется кликом по кружку пайплайна, а по подписи — нет', async ({ page }) => {
  const card = await openFreshLeadCard(page, 'Клуб Этап', '+7 909 322-87-21');
  const won = card.getByRole('button', { name: 'Этап: Продажа' });
  const lost = card.getByRole('button', { name: 'Этап: Отказ' });
  await expect(card.getByRole('button', { name: 'Этап: Новая заявка' })).toHaveAttribute('aria-current', 'step');

  await won.click();
  await expect(won).toHaveAttribute('aria-current', 'step');
  await expect(card.getByText('Этап изменён на «Продажа»')).toBeVisible();

  // Кликабелен только кружок: подпись шага — обычный текст StepLabel.
  await card.getByText('Отказ', { exact: true }).click();
  await expect(card.getByText('Этап изменён на «Отказ»')).toHaveCount(0);
  await expect(won).toHaveAttribute('aria-current', 'step');
  await expect(lost).not.toHaveAttribute('aria-current', 'step');
});

test('приоритет меняется через чип и меню', async ({ page }) => {
  const card = await openFreshLeadCard(page, 'Клуб Приоритет', '+7 909 322-87-22');
  const chip = card.getByRole('button', { name: 'Приоритет заявки' });
  await expect(chip).toHaveText('Средний');

  await chip.click();
  await page.getByRole('menuitem', { name: 'Высокий' }).click();

  await expect(chip).toHaveText('Высокий');
  await expect(card.getByText('Приоритет: высокий')).toBeVisible();
});

test('тег создаётся из карточки и остаётся у контакта', async ({ page }) => {
  const card = await openFreshLeadCard(page, 'Клуб Тег', '+7 909 322-87-23');
  await card.getByRole('button', { name: 'Изменить теги' }).click();
  await page.getByRole('button', { name: '+ тег' }).click();
  await page.getByRole('textbox', { name: 'Название тега' }).fill('Оптовик');
  await page.getByRole('button', { name: 'Создать' }).click();
  await expect(page.getByRole('checkbox', { name: 'Оптовик' })).toBeChecked();
  await page.getByRole('button', { name: '+ тег' }).press('Escape');

  await expect(card.getByText('Оптовик')).toBeVisible();
  // Тег сохраняется сам, поэтому карточка не считается изменённой.
  await expect(card.getByRole('button', { name: 'Сохранить изменения' })).toBeDisabled();
  await card.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('link', { name: 'Канбан' }).click();
  await expect(page.getByText('Оптовик')).toBeVisible();
});

test('сообщение из чата появляется в ленте обсуждения', async ({ page }) => {
  const card = await openFreshLeadCard(page, 'Клуб Чат', '+7 909 322-87-24');
  await expect(card.getByText('Контакт добавлен вручную')).toBeVisible();

  await card.getByRole('textbox', { name: 'Отправить сообщение' }).fill('Договорились на вторник');
  await card.getByRole('button', { name: 'Отправить сообщение' }).click();

  await expect(card.getByText('Договорились на вторник')).toBeVisible();
  await expect(card.getByRole('textbox', { name: 'Отправить сообщение' })).toHaveValue('');
});

test('заявка удаляется только после подтверждения', async ({ page }) => {
  const card = await openFreshLeadCard(page, 'Клуб Удаление', '+7 909 322-87-25');
  await card.getByRole('button', { name: 'Удалить заявку' }).click();

  const confirm = page.getByRole('dialog', { name: 'Удалить заявку?' });
  await confirm.getByRole('button', { name: 'Отмена' }).click();
  await expect(card).toBeVisible();

  await card.getByRole('button', { name: 'Удалить заявку' }).click();
  await confirm.getByRole('button', { name: 'Удалить', exact: true }).click();

  await expect(leadCard(page)).toHaveCount(0);
  await expect(page.getByText('Контактов пока нет')).toBeVisible();
});

test('успешное сохранение показывает тост в правом нижнем углу', async ({ page }) => {
  const card = await openFreshLeadCard(page, 'Клуб Тост', '+7 909 322-87-26');
  await card.getByRole('textbox', { name: 'Комментарий' }).fill('Перезвонить после обеда');
  await card.getByRole('button', { name: 'Сохранить изменения' }).click();

  const toast = page.getByRole('alert');
  await expect(toast).toHaveText(/Изменения сохранены/);
  const box = await toast.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  // Якорь тоста — bottom/right: плашка целиком в правой нижней четверти экрана.
  expect(box!.x).toBeGreaterThan(viewport!.width / 2);
  expect(box!.y).toBeGreaterThan(viewport!.height / 2);
  expect(viewport!.width - (box!.x + box!.width)).toBeLessThan(80);
  expect(viewport!.height - (box!.y + box!.height)).toBeLessThan(80);
});

test('открытая карточка заявки не содержит серьёзных ошибок доступности', async ({ page }) => {
  const card = await openFreshLeadCard(page, 'Клуб Доступность', '+7 909 322-87-27');
  await expect(card.getByRole('button', { name: 'Изменить теги' })).toBeVisible();
  expect(await seriousAccessibilityIssues(page)).toEqual([]);
});

test('крайний срок сохраняется и виден на канбане', async ({ page }) => {
  const card = await openFreshLeadCard(page, 'Клуб Срок', '+7 909 322-87-72');
  const deadline = card.getByRole('group', { name: 'Крайний срок' });
  await deadline.click();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('31082026');
  await expect(deadline).toHaveText(/31\.08\.2026/);
  await card.getByRole('button', { name: 'Сохранить изменения' }).click();
  await expect(card.getByText('Изменения сохранены.')).toBeVisible();
  await card.getByRole('button', { name: 'Закрыть', exact: true }).click();

  await openApp(page, '/board');
  await expect(page.getByText('Срок: 31.08.2026')).toBeVisible();
});

test('после сохранения карточка закрывается без предупреждения', async ({ page }) => {
  const card = await openFreshLeadCard(page, 'Клуб Сохранение', '+7 909 322-87-73');
  // Пользователь поправил время звонка, но сам звонок не назначал.
  await card.getByRole('group', { name: 'Дата и время' }).click();
  await page.keyboard.press('ArrowUp');
  await card.getByRole('textbox', { name: 'Комментарий' }).fill('Перезвонить после обеда');
  await card.getByRole('button', { name: 'Сохранить изменения' }).click();
  await expect(card.getByText('Изменения сохранены.')).toBeVisible();

  await card.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Закрыть без сохранения?' })).toHaveCount(0);
});

test('незаписанная тема звонка всё ещё предупреждает при закрытии', async ({ page }) => {
  const card = await openFreshLeadCard(page, 'Клуб Звонок', '+7 909 322-87-74');
  await card.getByRole('textbox', { name: 'Тема звонка' }).fill('Уточнить бюджет');

  await card.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Закрыть без сохранения?' })).toBeVisible();
});

test('кнопка сохранения гаснет при возврате к исходным значениям', async ({ page }) => {
  const card = await openFreshLeadCard(page, 'Клуб Откат', '+7 909 322-87-75');
  const save = card.getByRole('button', { name: 'Сохранить изменения' });
  const comment = card.getByRole('textbox', { name: 'Комментарий' });
  await expect(save).toBeDisabled();

  await comment.fill('Черновик');
  await expect(save).toBeEnabled();
  await comment.fill('');
  await expect(save).toBeDisabled();

  await card.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Закрыть без сохранения?' })).toHaveCount(0);
});

test('тег не откатывается сохранением карточки', async ({ page }) => {
  const card = await openFreshLeadCard(page, 'Клуб Теги', '+7 909 322-87-76');
  await card.getByRole('textbox', { name: 'Организация' }).fill('Клуб Теги и правки');

  // Тег пишется в базу в обход черновика карточки, поэтому сохранение не должно его перетирать.
  await card.getByRole('button', { name: 'Изменить теги' }).click();
  await page.getByRole('button', { name: '+ тег' }).click();
  await page.getByRole('textbox', { name: 'Название тега' }).fill('Оптовик');
  await page.getByRole('button', { name: 'Создать' }).click();
  await expect(page.getByRole('checkbox', { name: 'Оптовик' })).toBeChecked();
  await page.getByRole('button', { name: '+ тег' }).press('Escape');

  await card.getByRole('button', { name: 'Сохранить изменения' }).click();
  await expect(card.getByText('Изменения сохранены.')).toBeVisible();
  await card.getByRole('button', { name: 'Закрыть', exact: true }).click();

  await openApp(page, '/board');
  await expect(page.getByText('Оптовик')).toBeVisible();
});

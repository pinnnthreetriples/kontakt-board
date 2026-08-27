import { expect, test } from '@playwright/test';
import { leadCard, openApp, openFreshLeadCard } from './helpers';

// Секунда тишины в WAV: браузер должен принять файл и начать играть, поэтому
// подсунуть произвольные байты нельзя, а бинарную фикстуру в репозиторий тащить незачем.
function silentWav(seconds = 1): Buffer {
  const rate = 8000;
  const samples = rate * seconds;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  return wav;
}

// Запись живёт в IndexedDB как Blob, а плеер получает blob-ссылку. Проверить это
// можно только в настоящем браузере: fake-indexeddb из unit-тестов Blob не хранит.
test('запись кол-центра прикрепляется к заявке по номеру в имени файла и играет в карточке', async ({ page }) => {
  const card = await openFreshLeadCard(page, 'Клуб Запись', '+7 909 322-87-31');
  await card.getByRole('button', { name: 'Закрыть' }).click();

  await openApp(page, '/import');
  await page.getByRole('button', { name: 'Загрузить только записи разговоров' }).click();
  await page.locator('input[type="file"]').first().setInputFiles({
    name: '21268751244_+79093228731_25.08.2026_12_28_01m40s.wav',
    mimeType: 'audio/wav',
    buffer: silentWav(),
  });
  await expect(page.getByText('Прикрепим: 1')).toBeVisible();
  await expect(page.getByText('Клуб Запись')).toBeVisible();
  await page.getByRole('button', { name: 'Прикрепить 1' }).click();
  await expect(page.getByRole('heading', { name: 'Записи прикреплены' })).toBeVisible();

  await openApp(page, '/board');
  await page.getByText('Клуб Запись').click();
  await expect(leadCard(page).getByLabel(/^Слушать запись разговора/)).toBeVisible();
  await expect(leadCard(page).getByLabel(/^Скачать запись разговора/)).toHaveAttribute('href', /^blob:/);
  await expect(leadCard(page).getByText('Прикреплена запись разговора')).toBeVisible();

  // Кнопка переключилась на «Пауза» — значит браузер принял файл и начал играть.
  await leadCard(page).getByLabel(/^Слушать запись разговора/).click();
  await expect(leadCard(page).getByLabel(/^Пауза, запись разговора/)).toBeVisible();

  // Файл должен переживать перезагрузку: он лежит в базе, а не в памяти страницы.
  await page.reload();
  await page.getByText('Клуб Запись').click();
  await expect(leadCard(page).getByLabel(/^Скачать запись разговора/)).toHaveAttribute('href', /^blob:/);
});

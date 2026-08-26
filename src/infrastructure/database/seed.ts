import type { Stage } from '../../shared/model/domain';
import { db } from './database';
import { stageColors } from '../../shared/design-system/tokens';

export const DEFAULT_STAGES: Stage[] = [
  { id: 'stage-new', name: 'Новая заявка', color: stageColors[0], order: 0, archived: false, kind: 'normal' },
  { id: 'stage-no-answer', name: 'Не дозвонились', color: stageColors[1], order: 1, archived: false, kind: 'no_answer' },
  { id: 'stage-thinking', name: 'Думает', color: stageColors[2], order: 2, archived: false, kind: 'normal' },
  { id: 'stage-call', name: 'Назначен звонок', color: stageColors[3], order: 3, archived: false, kind: 'normal' },
  { id: 'stage-won', name: 'Продажа', color: stageColors[4], order: 4, archived: false, kind: 'won' },
  { id: 'stage-lost', name: 'Отказ', color: stageColors[5], order: 5, archived: false, kind: 'lost' },
];

export async function ensureSeedData(): Promise<void> {
  // Проверка и запись в одной транзакции. StrictMode вызывает эффект дважды, и без
  // транзакции оба вызова видят пустую таблицу, а второй bulkAdd падает с BulkError.
  // То же самое ломало запуск при двух одновременно открытых вкладках.
  await db.transaction('rw', db.stages, db.preferences, async () => {
    if ((await db.stages.count()) === 0) await db.stages.bulkAdd(DEFAULT_STAGES);
    if ((await db.preferences.count()) === 0) {
      await db.preferences.add({ id: 'preferences', ownerName: 'Я', compactMode: false, notifyMinutesBefore: 15 });
    }
  });
}

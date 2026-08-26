import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../../infrastructure/database/database';
import { stageColors } from '../../../shared/design-system/tokens';
import { resetDatabase } from '../../../test/fixtures';
import { archiveStage, LastStageError, reorderStage, saveStage, StageInUseError } from './stage-service';

beforeEach(resetDatabase);

describe('stage-service', () => {
  it('нормализует порядок после удаления и добавления', async () => {
    await archiveStage('stage-thinking');
    await saveStage({ name: 'Переговоры', color: stageColors[0], kind: 'normal' });

    const active = await db.stages.filter((stage) => !stage.archived).sortBy('order');
    expect(active.map((stage) => stage.order)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(active.map((stage) => stage.order)).size).toBe(active.length);
  });

  it('перемещает этап по текущему индексу, даже если старый order был с дыркой', async () => {
    await db.stages.update('stage-call', { order: 20 });
    await reorderStage('stage-call', -1);
    const active = await db.stages.filter((stage) => !stage.archived).sortBy('order');
    expect(active.map((stage) => stage.order)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('не архивирует этап с карточками', async () => {
    await db.leads.add({
      id: 'lead-stage-test', contactId: 'missing-contact', stageId: 'stage-new', externalId: '', source: 'test',
      result: '', description: '', assignee: 'Я', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    await expect(archiveStage('stage-new')).rejects.toBeInstanceOf(StageInUseError);
  });

  it('не архивирует последний активный этап', async () => {
    const active = await db.stages.filter((stage) => !stage.archived).toArray();
    await db.stages.bulkUpdate(active.slice(1).map((stage) => ({ key: stage.id, changes: { archived: true, order: -1 } })));
    await expect(archiveStage(active[0]!.id)).rejects.toBeInstanceOf(LastStageError);
  });

  it('оставляет только один системный этап каждого назначения', async () => {
    await saveStage({ name: 'Успешно', color: stageColors[1], kind: 'won' });
    const wonStages = await db.stages.filter((stage) => !stage.archived && stage.kind === 'won').toArray();
    expect(wonStages).toHaveLength(1);
    expect(wonStages[0]?.name).toBe('Успешно');
  });

  it('игнорирует этап без названия', async () => {
    const before = await db.stages.count();

    await saveStage({ name: '   ', color: stageColors[0], kind: 'normal' });

    expect(await db.stages.count()).toBe(before);
  });

  it('переименовывает существующий этап, не создавая новый', async () => {
    await saveStage({ name: '  Первый контакт  ', color: stageColors[3], kind: 'normal' }, 'stage-new');

    expect(await db.stages.count()).toBe(6);
    expect((await db.stages.get('stage-new'))?.name).toBe('Первый контакт');
  });

  it('не двигает крайний этап за пределы списка и не знает чужих идентификаторов', async () => {
    await reorderStage('stage-new', -1);
    await reorderStage('stage-lost', 1);
    await reorderStage('нет такого этапа', 1);

    const active = await db.stages.filter((stage) => !stage.archived).sortBy('order');
    expect(active.map((stage) => stage.id)).toEqual(['stage-new', 'stage-no-answer', 'stage-thinking', 'stage-call', 'stage-won', 'stage-lost']);
  });
});

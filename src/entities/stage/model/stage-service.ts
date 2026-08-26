import { db } from '../../../infrastructure/database/database';
import { createId } from '../../../shared/lib/ids';
import type { Stage } from '../../../shared/model/domain';

export class StageInUseError extends Error {
  constructor(public readonly leadsCount: number) {
    super('Этап используется карточками');
  }
}

export class LastStageError extends Error {
  constructor() {
    super('Нельзя удалить последний активный этап');
  }
}

async function normalizeActiveStages(): Promise<void> {
  const active = await db.stages.filter((stage) => !stage.archived).sortBy('order');
  const updates = active.flatMap((stage, index) => stage.order === index ? [] : [db.stages.update(stage.id, { order: index })]);
  await Promise.all(updates);
}

export async function saveStage(values: Pick<Stage, 'name' | 'color' | 'kind'>, stageId?: string): Promise<void> {
  const name = values.name.trim();
  if (!name) return;
  await db.transaction('rw', db.stages, async () => {
    if (values.kind && values.kind !== 'normal') {
      const sameKind = await db.stages.filter((stage) => !stage.archived && stage.kind === values.kind && stage.id !== stageId).toArray();
      await Promise.all(sameKind.map((stage) => db.stages.update(stage.id, { kind: 'normal' })));
    }
    if (stageId) await db.stages.update(stageId, { ...values, name });
    else {
      const activeCount = await db.stages.filter((stage) => !stage.archived).count();
      await db.stages.add({ id: createId(), ...values, name, kind: values.kind ?? 'normal', order: activeCount, archived: false });
    }
    await normalizeActiveStages();
  });
}

export async function reorderStage(stageId: string, direction: -1 | 1): Promise<void> {
  await db.transaction('rw', db.stages, async () => {
    const active = await db.stages.filter((stage) => !stage.archived).sortBy('order');
    const index = active.findIndex((stage) => stage.id === stageId);
    const target = active[index + direction];
    const stage = active[index];
    if (!stage || !target) return;
    await db.stages.update(stage.id, { order: target.order });
    await db.stages.update(target.id, { order: stage.order });
    await normalizeActiveStages();
  });
}

export async function archiveStage(stageId: string): Promise<void> {
  await db.transaction('rw', [db.stages, db.leads], async () => {
    const activeCount = await db.stages.filter((stage) => !stage.archived).count();
    if (activeCount <= 1) throw new LastStageError();
    const leadsCount = await db.leads.where('stageId').equals(stageId).count();
    if (leadsCount > 0) throw new StageInUseError(leadsCount);
    await db.stages.update(stageId, { archived: true, order: -1 });
    await normalizeActiveStages();
  });
}

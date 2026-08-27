import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../infrastructure/database/database';
import type { Tag } from '../../../shared/model/domain';

const NO_TAGS: Tag[] = [];

/** Цвет тега — на самом чипе: точка рядом с названием была лишней деталью. */
export function tagChipSx(color: string | undefined) {
  return color ? { borderColor: color, color, '& .MuiChip-deleteIcon': { color } } : undefined;
}

/** Справочник тегов: имя -> цвет. Порядок соответствует порядку записей в базе. */
export function useTagColors(): Map<string, string> {
  const tags = useLiveQuery(() => db.tags.toArray(), []) ?? NO_TAGS;
  return useMemo(() => new Map(tags.map((tag) => [tag.name, tag.color])), [tags]);
}

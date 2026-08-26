import Dexie, { type EntityTable, type Transaction } from 'dexie';
import type {
  ActivityItem,
  AppPreferences,
  CallTask,
  Contact,
  ContactComment,
  CustomFieldDefinition,
  ImportJob,
  Lead,
  Stage,
  Tag,
} from '../../shared/model/domain';
import { stageColors } from '../../shared/design-system/tokens';

const DATABASE_SCHEMA = {
  contacts: 'id, organization, personName, phone, normalizedPhone, email, updatedAt, *tags',
  leads: 'id, contactId, stageId, externalId, &externalKey, source, assignee, createdAt, updatedAt',
  stages: 'id, order, archived',
  comments: 'id, leadId, createdAt',
  activities: 'id, leadId, kind, createdAt',
  calls: 'id, leadId, dueAt, completedAt, createdAt',
  customFields: 'id, name, archived',
  importJobs: 'id, createdAt',
  preferences: 'id',
};

const SCHEMA_WITH_TAGS = { ...DATABASE_SCHEMA, tags: 'id, &name' };

const SCHEMA_WITH_PRIORITY = { ...SCHEMA_WITH_TAGS, leads: `${DATABASE_SCHEMA.leads}, priority` };

async function repairStageInvariants(transaction: Transaction): Promise<void> {
  const stagesTable = transaction.table<Stage, string>('stages');
  const leadsTable = transaction.table<Lead, string>('leads');
  let stages = await stagesTable.toArray();
  let active = stages.filter((stage) => !stage.archived);
  if (active.length === 0) {
    const recovery: Stage = { id: 'stage-recovered', name: 'Новые', color: stageColors[0], order: 0, archived: false, kind: 'normal' };
    await stagesTable.put(recovery);
    stages = [...stages, recovery];
    active = [recovery];
  }
  active.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const usedKinds = new Set<Stage['kind']>();
  for (const [index, stage] of active.entries()) {
    const kind = stage.kind ?? 'normal';
    const normalizedKind = kind !== 'normal' && usedKinds.has(kind) ? 'normal' : kind;
    if (normalizedKind !== 'normal') usedKinds.add(normalizedKind);
    await stagesTable.update(stage.id, { order: index, kind: normalizedKind });
  }
  const activeIds = new Set(active.map((stage) => stage.id));
  const fallbackStage = active[0];
  if (!fallbackStage) throw new Error('Не удалось восстановить активный этап');
  const fallbackStageId = fallbackStage.id;
  await leadsTable.toCollection().modify((lead) => { if (!activeIds.has(lead.stageId)) lead.stageId = fallbackStageId; });
}

export class ContactBoardDatabase extends Dexie {
  contacts!: EntityTable<Contact, 'id'>;
  leads!: EntityTable<Lead, 'id'>;
  stages!: EntityTable<Stage, 'id'>;
  comments!: EntityTable<ContactComment, 'id'>;
  activities!: EntityTable<ActivityItem, 'id'>;
  calls!: EntityTable<CallTask, 'id'>;
  customFields!: EntityTable<CustomFieldDefinition, 'id'>;
  importJobs!: EntityTable<ImportJob, 'id'>;
  preferences!: EntityTable<AppPreferences, 'id'>;
  tags!: EntityTable<Tag, 'id'>;

  constructor(name = 'contact-board') {
    super(name);
    this.version(1).stores({
      contacts: 'id, organization, personName, phone, normalizedPhone, email, updatedAt, *tags',
      leads: 'id, contactId, stageId, externalId, source, assignee, createdAt, updatedAt',
      stages: 'id, order, archived',
      comments: 'id, leadId, createdAt',
      activities: 'id, leadId, kind, createdAt',
      calls: 'id, leadId, dueAt, completedAt, createdAt',
      customFields: 'id, name, archived',
      importJobs: 'id, createdAt',
      preferences: 'id',
    });
    this.version(2).stores(DATABASE_SCHEMA).upgrade(async (transaction) => {
      const seenExternalKeys = new Set<string>();
      await transaction.table<Lead, string>('leads').toCollection().modify((lead) => {
        if (!lead.externalId) return;
        const candidate = `${lead.source.trim().toLowerCase()}::${lead.externalId.trim()}`;
        if (!seenExternalKeys.has(candidate)) {
          lead.externalKey = candidate;
          seenExternalKeys.add(candidate);
        }
      });
    });
    this.version(3).stores(DATABASE_SCHEMA).upgrade(async (transaction) => {
      const kindsById: Record<string, Stage['kind']> = {
        'stage-no-answer': 'no_answer',
        'stage-won': 'won',
        'stage-lost': 'lost',
      };
      await transaction.table<Stage, string>('stages').toCollection().modify((stage) => {
        stage.kind = kindsById[stage.id] ?? 'normal';
      });
    });
    this.version(4).stores(DATABASE_SCHEMA).upgrade(async (transaction) => {
      const table = transaction.table<Lead, string>('leads');
      const leads = await table.toArray();
      const usedKeys = new Set(leads.flatMap((lead) => lead.externalKey ? [lead.externalKey] : []));
      for (const lead of leads.filter((item) => item.externalId.trim() && !item.externalKey).sort((left, right) => left.id.localeCompare(right.id))) {
        const source = lead.source.trim() || 'Excel';
        const originalExternalId = lead.externalId.trim();
        let externalId = originalExternalId;
        let key = `${source.toLowerCase()}::${externalId}`;
        let duplicateIndex = 1;
        while (usedKeys.has(key)) {
          externalId = `${originalExternalId} [дубликат ${lead.id.slice(0, 8)}-${duplicateIndex}]`;
          key = `${source.toLowerCase()}::${externalId}`;
          duplicateIndex += 1;
        }
        usedKeys.add(key);
        await table.update(lead.id, { source, externalId, externalKey: key });
      }
      await repairStageInvariants(transaction);
    });
    this.version(5).stores(DATABASE_SCHEMA).upgrade(repairStageInvariants);
    // Справочник тегов собирается из тех, что уже проставлены контактам.
    this.version(6).stores(SCHEMA_WITH_TAGS).upgrade(async (transaction) => {
      const contacts = await transaction.table<Contact, string>('contacts').toArray();
      const names = [...new Set(contacts.flatMap((contact) => contact.tags))].filter(Boolean);
      await transaction.table<Tag, string>('tags').bulkAdd(names.map((name, index) => ({
        id: `tag-${index}`, name, color: stageColors[index % stageColors.length] ?? stageColors[0],
      })));
    });
    // Приоритет появился позже: у старых заявок его нет, проставляем средний.
    this.version(7).stores(SCHEMA_WITH_PRIORITY).upgrade(async (transaction) => {
      await transaction.table<Lead, string>('leads').toCollection().modify((lead) => {
        lead.priority ??= 'normal';
      });
    });
  }
}

export const db = new ContactBoardDatabase();

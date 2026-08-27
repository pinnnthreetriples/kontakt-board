export interface Contact {
  id: string;
  organization: string;
  taxId: string;
  personName: string;
  position: string;
  phone: string;
  normalizedPhone: string;
  secondaryPhone: string;
  email: string;
  address: string;
  region: string;
  website: string;
  tags: string[];
  customValues: Record<string, string | number | boolean>;
  createdAt: string;
  updatedAt: string;
}

export type LeadPriority = 'low' | 'normal' | 'high';

export interface Lead {
  id: string;
  contactId: string;
  stageId: string;
  externalId: string;
  externalKey?: string;
  source: string;
  result: string;
  description: string;
  assignee: string;
  priority?: LeadPriority;
  /** Крайний срок работы с заявкой, дата в формате YYYY-MM-DD. */
  deadline?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Stage {
  id: string;
  name: string;
  color: string;
  order: number;
  archived: boolean;
  kind?: 'normal' | 'no_answer' | 'won' | 'lost';
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface ContactComment {
  id: string;
  leadId: string;
  text: string;
  author: string;
  createdAt: string;
}

export interface ActivityItem {
  id: string;
  leadId: string;
  kind: 'created' | 'updated' | 'stage_changed' | 'commented' | 'call_scheduled' | 'call_completed' | 'imported' | 'proposal_sent';
  text: string;
  author: string;
  createdAt: string;
}

export interface CallTask {
  id: string;
  leadId: string;
  dueAt: string;
  note: string;
  completedAt?: string;
  createdAt: string;
}

export interface CallRecording {
  id: string;
  leadId: string;
  fileName: string;
  /** Время звонка из имени файла кол-центра, иначе время загрузки. */
  recordedAt: string;
  blob: Blob;
}

export type CustomFieldType = 'text' | 'number' | 'date' | 'select' | 'boolean';

export interface CustomFieldDefinition {
  id: string;
  name: string;
  type: CustomFieldType;
  showOnCard: boolean;
  filterable: boolean;
  archived: boolean;
}

export interface ImportJob {
  id: string;
  fileName: string;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  createdAt: string;
}

export interface AppPreferences {
  id: 'preferences';
  ownerName: string;
  compactMode: boolean;
  notifyMinutesBefore: number;
}

export interface LeadView {
  lead: Lead;
  contact: Contact;
  nextCall?: CallTask;
  commentsCount: number;
  cardFields: Array<{ label: string; value: string }>;
  filterFields: Array<{ label: string; value: string }>;
}

export interface ImportColumnMapping {
  organization?: string;
  taxId?: string;
  personName?: string;
  position?: string;
  phone?: string;
  secondaryPhone?: string;
  email?: string;
  address?: string;
  region?: string;
  website?: string;
  tags?: string;
  externalId?: string;
  result?: string;
  description?: string;
  assignee?: string;
  source?: string;
  createdAt?: string;
  initialComment?: string;
}

export interface ParsedSheet {
  name: string;
  headers: string[];
  rows: Array<Record<string, unknown>>;
}

export interface ImportPreviewRow {
  rowNumber: number;
  organization: string;
  personName: string;
  phone: string;
  externalId: string;
  action: 'create' | 'update' | 'skip' | 'error';
  error?: string;
  raw: Record<string, unknown>;
}

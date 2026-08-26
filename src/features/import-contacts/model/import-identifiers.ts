import type { Lead } from '../../../shared/model/domain';

export function normalizeSource(value: string): string {
  return value.trim().toLowerCase();
}

export function externalKey(source: string, id: string): string | undefined {
  const normalizedId = id.trim();
  return normalizedId ? `${normalizeSource(source)}::${normalizedId}` : undefined;
}

export function sourceLabel(value: string): string {
  return value.trim() || 'Excel';
}

export function storedExternalKey(lead: Lead): string | undefined {
  return externalKey(lead.source, lead.externalId);
}

export function identifiersConflict(externalContactId: string | undefined, phoneContactId: string | undefined): boolean {
  return Boolean(externalContactId && phoneContactId && externalContactId !== phoneContactId);
}

import { db } from '../infrastructure/database/database';
import { DEFAULT_STAGES, ensureSeedData } from '../infrastructure/database/seed';
import { createId } from '../shared/lib/ids';
import { normalizePhone } from '../shared/lib/phone';
import type { Contact, Lead } from '../shared/model/domain';

export async function resetDatabase(): Promise<void> {
  await db.delete();
  await db.open();
  await ensureSeedData();
}

export async function createLeadFixture(index = 0): Promise<{ contact: Contact; lead: Lead }> {
  const now = new Date().toISOString();
  const phone = `+7 909 322-87-${String(index).padStart(2, '0')}`;
  const contact: Contact = {
    id: createId(), organization: `Клуб ${index + 1}`, taxId: '', personName: `Контакт ${index + 1}`, position: '', phone,
    normalizedPhone: normalizePhone(phone), secondaryPhone: '', email: '', address: '', region: 'Кировская область', website: '',
    tags: [], customValues: {}, createdAt: now, updatedAt: now,
  };
  const lead: Lead = {
    id: createId(), contactId: contact.id, stageId: DEFAULT_STAGES[0]!.id, externalId: `fixture-${index}`, externalKey: `тест::fixture-${index}`, source: 'Тест',
    result: 'Лид', description: '', assignee: 'Я', createdAt: now, updatedAt: now,
  };
  await db.transaction('rw', [db.contacts, db.leads], async () => {
    await db.contacts.add(contact);
    await db.leads.add(lead);
  });
  return { contact, lead };
}

import { LeadNotFoundError } from '../../../entities/lead/model/lead-service';
import { db } from '../../../infrastructure/database/database';
import { createId } from '../../../shared/lib/ids';

interface ProposalOutcome {
  /** Имя получателя, как его вернул MAX. Пустое — подставляется номер. */
  recipient: string;
  phone: string;
  /** Мост не смог подтвердить доставку: сообщение могло уйти, а могло и нет. */
  uncertain: boolean;
}

/**
 * След отправки КП пишется в существующую историю заявки: событие само появится
 * в ленте обсуждения. Отдельная таблица для этого не нужна.
 */
export async function recordProposalSent(leadId: string, outcome: ProposalOutcome): Promise<void> {
  const now = new Date().toISOString();
  const author = (await db.preferences.get('preferences'))?.ownerName.trim() || 'Я';
  const recipient = outcome.recipient.trim() || outcome.phone.trim();
  const text = outcome.uncertain
    ? `КП в MAX: статус доставки неизвестен, получатель ${recipient}`
    : `КП отправлено в MAX, получатель ${recipient}`;
  await db.transaction('rw', [db.activities, db.leads], async () => {
    const lead = await db.leads.get(leadId);
    if (!lead) throw new LeadNotFoundError();
    await db.activities.add({ id: createId(), leadId, kind: 'proposal_sent', text, author, createdAt: now });
    await db.leads.update(leadId, { updatedAt: now });
  });
}

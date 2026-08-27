import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../../infrastructure/database/database';
import { createLeadFixture, resetDatabase } from '../../../test/fixtures';
import { updatePreferences } from '../../manage-settings/model/settings-service';
import { recordProposalSent } from './proposal-service';

beforeEach(resetDatabase);

describe('proposal-service', () => {
  it('пишет событие об отправленном КП в историю заявки', async () => {
    const { lead } = await createLeadFixture();
    await updatePreferences({ ownerName: 'Мария' });
    await recordProposalSent(lead.id, { recipient: 'Иван Петров', phone: '+79093228700', uncertain: false });
    const activities = await db.activities.where('leadId').equals(lead.id).toArray();
    const proposal = activities.find((item) => item.kind === 'proposal_sent');
    expect(proposal?.text).toBe('КП отправлено в MAX, получатель Иван Петров');
    expect(proposal?.author).toBe('Мария');
  });

  it('отдельно помечает неизвестный статус доставки', async () => {
    const { lead } = await createLeadFixture();
    await recordProposalSent(lead.id, { recipient: 'Иван Петров', phone: '+79093228700', uncertain: true });
    const proposal = (await db.activities.where('leadId').equals(lead.id).toArray()).find((item) => item.kind === 'proposal_sent');
    expect(proposal?.text).toContain('статус доставки неизвестен');
  });

  it('подставляет номер, если MAX не вернул имя получателя', async () => {
    const { lead } = await createLeadFixture();
    await recordProposalSent(lead.id, { recipient: '  ', phone: ' +79093228700 ', uncertain: false });
    const proposal = (await db.activities.where('leadId').equals(lead.id).toArray()).find((item) => item.kind === 'proposal_sent');
    expect(proposal?.text).toBe('КП отправлено в MAX, получатель +79093228700');
  });

  it('обновляет дату изменения заявки временем самой отправки', async () => {
    const { lead } = await createLeadFixture();
    await recordProposalSent(lead.id, { recipient: 'Иван Петров', phone: '+79093228700', uncertain: false });
    const updated = await db.leads.get(lead.id);
    const proposal = (await db.activities.where('leadId').equals(lead.id).toArray()).find((item) => item.kind === 'proposal_sent');
    // Сравнение с датой из фикстуры было бы нестабильным: обе записи могут
    // попасть в одну и ту же миллисекунду. Важно, что заявку тронула отправка.
    expect(updated?.updatedAt).toBe(proposal?.createdAt);
  });

  it('не пишет событие для несуществующей заявки', async () => {
    await expect(recordProposalSent('нет такой заявки', { recipient: 'Иван', phone: '+79093228700', uncertain: false }))
      .rejects.toThrow('Заявка не найдена');
    expect(await db.activities.count()).toBe(0);
  });
});

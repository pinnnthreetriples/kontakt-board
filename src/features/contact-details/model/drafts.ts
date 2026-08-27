import type { Contact, Lead } from '../../../shared/model/domain';

export type ContactDraft = Pick<Contact, 'organization' | 'taxId' | 'personName' | 'position' | 'phone' | 'secondaryPhone' | 'email' | 'address' | 'region' | 'website' | 'tags' | 'customValues'>;
export type LeadDraft = Pick<Lead, 'result' | 'description' | 'assignee'> & { deadline: string };

export const EMPTY_DRAFT: ContactDraft = { organization: '', taxId: '', personName: '', position: '', phone: '', secondaryPhone: '', email: '', address: '', region: '', website: '', tags: [], customValues: {} };
const EMPTY_LEAD_DRAFT: LeadDraft = { result: '', description: '', assignee: 'Я', deadline: '' };

export function leadDraftFrom(lead: Lead | undefined): LeadDraft {
  if (!lead) return EMPTY_LEAD_DRAFT;
  return { result: lead.result, description: lead.description, assignee: lead.assignee, deadline: lead.deadline ?? '' };
}

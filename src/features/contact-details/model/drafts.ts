import type { Contact, Lead } from '../../../shared/model/domain';

export type ContactDraft = Pick<Contact, 'organization' | 'taxId' | 'personName' | 'position' | 'phone' | 'secondaryPhone' | 'email' | 'address' | 'region' | 'website' | 'tags' | 'customValues'>;
export type LeadDraft = Pick<Lead, 'result' | 'description' | 'assignee'>;

export const EMPTY_DRAFT: ContactDraft = { organization: '', taxId: '', personName: '', position: '', phone: '', secondaryPhone: '', email: '', address: '', region: '', website: '', tags: [], customValues: {} };
export const EMPTY_LEAD_DRAFT: LeadDraft = { result: '', description: '', assignee: 'Я' };

import { z } from 'zod';
import OpenAI from 'openai';
import { BaseOpenAIAgent, ZodTool } from './base-openai-agent.js';
import { GoogleAuthService } from '../services/google-auth.js';
import { google, people_v1 } from 'googleapis';

interface ContactDetails {
  resourceName: string;
  firstName: string;
  lastName?: string;
  emailAddresses: string[];
  phoneNumbers?: string[];
  organizations?: string[];
  jobTitles?: string[];
  birthday?: string;
}

interface ContactUpdate {
  firstName?: string;
  lastName?: string;
  emailAddresses?: string[];
  phoneNumbers?: string[];
  birthdayYear?: number;
  birthdayMonth?: number;
  birthdayDay?: number;
  organizationName?: string;
  organizationTitle?: string;
}

export class ContactsAgent extends BaseOpenAIAgent {
  private peopleService!: people_v1.People;

  constructor(client: OpenAI) {
    const zodTools: ZodTool<any>[] = [
      {
        name: 'findContact',
        schema: z.object({
          query: z.string().describe('Name or email to search for'),
        }).required().describe('Find a contact by name or email'),
        implementation: async ({ query }) => {
          const contacts = await this.searchContacts(query);
          if (contacts.length === 0) {
            throw new Error(`No contacts found matching "${query}"`);
          }
          if (contacts.length > 1) {
            return {
              message: 'Multiple contacts found. Please be more specific:',
              contacts: contacts.map(c => ({
                firstName: c.firstName,
                lastName: c.lastName,
                email: c.emailAddresses[0],
                resourceName: c.resourceName
              }))
            };
          }
          // Return full details of the single match
          return contacts[0];
        }
      },
      {
        name: 'updateContact',
        schema: z.object({
          query: z.string().describe('Name or email of the contact to update'),
          firstName: z.string().optional().describe('New first name'),
          lastName: z.string().optional().describe('New last name'),
          emailAddresses: z.array(z.string()).optional().describe('New list of email addresses'),
          phoneNumbers: z.array(z.string()).optional().describe('New list of phone numbers'),
          birthdayYear: z.number().optional().describe('Birthday year (e.g., 1990)'),
          birthdayMonth: z.number().optional().describe('Birthday month (1-12)'),
          birthdayDay: z.number().optional().describe('Birthday day (1-31)'),
          organizationName: z.string().optional().describe('Company or organization name'),
          organizationTitle: z.string().optional().describe('Job title in the organization')
        }).required().describe('Update specific fields of a contact'),
        implementation: async ({ query, ...updates }) => {
          // First find the contact
          const contacts = await this.searchContacts(query);
          if (contacts.length === 0) {
            throw new Error(`No contacts found matching "${query}"`);
          }
          if (contacts.length > 1) {
            return {
              message: 'Multiple contacts found. Please be more specific:',
              contacts: contacts.map(c => ({
                firstName: c.firstName,
                lastName: c.lastName,
                email: c.emailAddresses[0],
                resourceName: c.resourceName
              }))
            };
          }

          // Validate birthday values if any are provided
          if (updates.birthdayMonth || updates.birthdayDay || updates.birthdayYear) {
            const month = updates.birthdayMonth ?? 1;
            const day = updates.birthdayDay ?? 1;
            const year = updates.birthdayYear;
            
            if (month < 1 || month > 12) throw new Error('Month must be between 1 and 12');
            if (day < 1 || day > 31) throw new Error('Day must be between 1 and 31');
            if (year && year < 1900) throw new Error('Year must be 1900 or later');
          }

          const result = await this.updateContact(contacts[0].resourceName, updates);
          return {
            message: `Successfully updated contact: ${result.firstName}${result.lastName ? ` ${result.lastName}` : ''}`,
            contact: result
          };
        }
      }
    ];

    super(client, {
      name: 'Contacts',
      description: 'A contacts agent that can find and retrieve Google contact information',
      systemPrompt: `You are a helpful contacts assistant that can find and update contact information.
        
        Usage patterns:
        1. To find contacts: Use findContact with name or email
           - Returns full contact details if single match found
           - Returns list of matches if multiple found
        2. To update contacts: Use updateContact with name/email and the fields to update
        
        Always use findContact first to get contact information.
        Never try to directly access a contact by name - must search first.
        
        Example responses:
        "I found Dani's contact: Email: dani@example.com, Phone: 555-0123"
        "I found multiple matches for 'John'. Please specify which one:
         - John Smith (john.smith@example.com)
         - John Doe (john.doe@example.com)"`,
      zodTools
    });

    this.initializeContacts();
  }

  private async initializeContacts() {
    try {
      const authService = GoogleAuthService.getInstance();
      const auth = await authService.getAuthenticatedClient();
      this.peopleService = google.people({ version: 'v1', auth });
    } catch (error) {
      console.error('Failed to initialize contacts service:', error);
      throw error;
    }
  }

  private async searchContacts(query: string): Promise<ContactDetails[]> {
    try {
      const response = await this.peopleService.people.searchContacts({
        query,
        readMask: 'names,emailAddresses,phoneNumbers,organizations,birthdays',
        sources: ['READ_SOURCE_TYPE_CONTACT']
      });

      return (response.data.results || []).map(result => this.formatContact(result.person!));
    } catch (error) {
      console.error('Failed to search contacts:', error);
      throw error;
    }
  }

  private formatContact(person: people_v1.Schema$Person): ContactDetails {
    const name = person.names?.[0];
    let birthday: string | undefined;
    if (person.birthdays?.[0]) {
      const bd = person.birthdays[0].date;
      if (bd) {
        birthday = bd.year 
          ? `${bd.year}-${String(bd.month).padStart(2, '0')}-${String(bd.day).padStart(2, '0')}`
          : `${String(bd.month).padStart(2, '0')}-${String(bd.day).padStart(2, '0')}`;
      }
    }

    return {
      resourceName: person.resourceName!,
      firstName: name?.givenName ?? 'Unknown',
      lastName: name?.familyName ?? undefined,
      emailAddresses: (person.emailAddresses || [])
        .map(email => email.value!)
        .filter(Boolean),
      phoneNumbers: person.phoneNumbers
        ?.map(phone => phone.value!)
        .filter(Boolean),
      organizations: person.organizations
        ?.map(org => org.name!)
        .filter(Boolean),
      jobTitles: person.organizations
        ?.map(org => org.title!)
        .filter(Boolean),
      birthday
    };
  }

  private async updateContact(resourceName: string, updates: ContactUpdate): Promise<ContactDetails> {
    try {
      // First get the existing contact
      const existing = await this.peopleService.people.get({
        resourceName,
        personFields: 'names,emailAddresses,phoneNumbers,organizations,birthdays,metadata'
      });

      // Prepare the update mask and request body
      const updateMask: string[] = [];
      const requestBody: any = {
        etag: existing.data.etag,
        metadata: existing.data.metadata
      };

      // Handle name updates
      if (updates.firstName || updates.lastName) {
        updateMask.push('names');
        const existingName = existing.data.names?.[0] || {};
        const firstName = updates.firstName ?? existingName.givenName;
        const lastName = updates.lastName ?? existingName.familyName;
        
        requestBody.names = [{
          ...existingName,
          metadata: existingName.metadata,
          givenName: firstName,
          familyName: lastName,
          displayName: lastName ? `${firstName} ${lastName}` : firstName
        }];
      }

      // Handle email updates - preserve existing emails unless explicitly updating
      if (updates.emailAddresses) {
        updateMask.push('emailAddresses');
        requestBody.emailAddresses = updates.emailAddresses.map(email => ({
          value: email,
          type: 'other',
          metadata: existing.data.emailAddresses?.[0]?.metadata
        }));
      }

      // Handle phone updates - preserve existing phones unless explicitly updating
      if (updates.phoneNumbers) {
        updateMask.push('phoneNumbers');
        requestBody.phoneNumbers = updates.phoneNumbers.map(phone => ({
          value: phone,
          type: 'other'
        }));
      }

      // Handle birthday update - only update specified fields
      if (updates.birthdayYear || updates.birthdayMonth || updates.birthdayDay) {
        updateMask.push('birthdays');
        const existingBirthday = existing.data.birthdays?.[0]?.date || {};
        requestBody.birthdays = [{
          date: {
            year: updates.birthdayYear ?? existingBirthday.year,
            month: updates.birthdayMonth ?? existingBirthday.month,
            day: updates.birthdayDay ?? existingBirthday.day
          }
        }];
      }

      // Handle organization update - only update specified fields
      if (updates.organizationName || updates.organizationTitle) {
        updateMask.push('organizations');
        const existingOrg = existing.data.organizations?.[0] || {};
        requestBody.organizations = [{
          ...existingOrg,
          name: updates.organizationName ?? existingOrg.name,
          title: updates.organizationTitle ?? existingOrg.title
        }];
      }

      // Only proceed if there are actual updates
      if (updateMask.length === 0) {
        throw new Error('No valid updates provided');
      }

      // Perform the update
      const response = await this.peopleService.people.updateContact({
        resourceName,
        updatePersonFields: updateMask.join(','),
        requestBody
      });

      return this.formatContact(response.data);
    } catch (error) {
      console.error('Failed to update contact:', error);
      throw error;
    }
  }
} 
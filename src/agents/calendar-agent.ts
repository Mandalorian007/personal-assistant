import { z } from 'zod';
import OpenAI from 'openai';
import { BaseOpenAIAgent, ZodTool } from './base-openai-agent.js';
import { GoogleAuthService } from '../services/google-auth.js';
import { calendar_v3, google } from 'googleapis';

interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  attendees: string[];
  location?: string;
  calendarLink?: string;
  meetLink?: string;
  description?: string;
}

export class CalendarAgent extends BaseOpenAIAgent {
  private calendar!: calendar_v3.Calendar;

  constructor(client: OpenAI) {
    const zodTools: ZodTool<any>[] = [
      {
        name: 'getMeetingsInRange',
        schema: z.object({
          startDate: z.string().describe('Start date in YYYY-MM-DD format'),
          endDate: z.string().describe('End date in YYYY-MM-DD format')
        }).required().describe('Get meetings within a date range'),
        implementation: async ({ startDate, endDate }) => {
          // Ensure dates are parsed in local timezone
          const start = new Date(`${startDate}T00:00:00`);
          const end = new Date(`${endDate}T23:59:59`);
          return await this.getMeetingsInRange(start, end);
        }
      },
      {
        name: 'scheduleMeeting',
        schema: z.object({
          title: z.string().describe('Title of the meeting'),
          startTime: z.string().describe('Start time in ISO format (YYYY-MM-DDTHH:mm:ss)'),
          endTime: z.string().optional().describe('End time in ISO format (optional, defaults to 30 minutes after start)'),
          attendees: z.array(z.string()).optional().describe('List of attendee email addresses'),
          description: z.string().optional().describe('Meeting description'),
          location: z.string().optional().describe('Physical location if not virtual')
        }).required().describe('Schedule a new meeting'),
        implementation: async ({ title, startTime, endTime, attendees, description, location }) => {
          const start = new Date(startTime);
          const end = endTime ? new Date(endTime) : new Date(start.getTime() + 30 * 60000); // 30 minutes
          return await this.scheduleMeeting({
            title,
            startTime: start,
            endTime: end,
            attendees,
            description,
            location
          });
        }
      },
      {
        name: 'updateMeeting',
        schema: z.object({
          title: z.string().describe('Title of the meeting to find and update'),
          updates: z.object({
            newTitle: z.string().optional(),
            startTime: z.string().optional(),
            endTime: z.string().optional(),
            attendees: z.array(z.string()).optional(),
            description: z.string().optional(),
            location: z.string().optional()
          }).partial().required()
        }).required().describe('Update an existing meeting (must specify title to find it)'),
        implementation: async ({ title, updates }) => {
          const event = await this.findEventByTitleOrId(title);
          if (!event) {
            throw new Error(`No meeting found with title "${title}"`);
          }

          const result = await this.updateMeeting(event.id, updates);
          return {
            message: `Successfully updated meeting: ${title}`,
            event: result
          };
        }
      },
      {
        name: 'findMeeting',
        schema: z.object({
          title: z.string().optional().describe('Title or keywords to search for'),
          startTime: z.string().optional().describe('Start time to search around'),
          timeMin: z.string().optional().describe('Start of search range'),
          timeMax: z.string().optional().describe('End of search range')
        }).required().describe('Find meetings matching the criteria'),
        implementation: async ({ startTime, timeMin, timeMax, ...rest }) => {
          return await this.findMeeting({
            ...rest,
            startTime: startTime ? new Date(startTime) : undefined,
            timeMin: timeMin ? new Date(timeMin) : undefined,
            timeMax: timeMax ? new Date(timeMax) : undefined
          });
        }
      },
      {
        name: 'deleteMeeting',
        schema: z.object({
          title: z.string().describe('Title of the meeting to find and delete')
        }).required().describe('Delete an existing meeting by title'),
        implementation: async ({ title }) => {
          const event = await this.findEventByTitleOrId(title);
          if (!event) {
            throw new Error(`No meeting found with title "${title}"`);
          }

          await this.deleteMeeting(event.id);
          return { message: `Successfully deleted meeting: ${title}` };
        }
      }
    ];

    const today = new Date();
    const todayStr = today.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      timeZone: 'America/New_York'
    });

    super(client, {
      name: 'Calendar',
      description: 'A calendar agent that can provide information about your Google Calendar events',
      systemPrompt: `You are a decisive calendar assistant that takes immediate action.
        Today is ${todayStr} (Eastern Time).
        
        Calendar Search (getMeetingsInRange):
        - Use to find meetings within a date range
        - Today if no date specified
        - Returns all meetings in the specified range
        
        Meeting Creation (scheduleMeeting):
        - 30 minute duration by default
        - Includes Google Meet unless physical location given
        - Business hours (9 AM - 5 PM) if AM/PM not specified
        - Today if no date given
        - Skip attendees/Meet for reminders ("remind me to", "set reminder")
        
        Meeting Updates/Deletions:
        - To update a meeting: Use updateMeeting with the meeting title and desired changes
        - To delete a meeting: Use deleteMeeting with just the meeting title
        - No need to find IDs first - the system will handle that automatically
        
        Example commands:
        - "Update the 'Team Meeting' to start at 3pm"
        - "Remove John from the 'Sprint Planning' attendees"
        - "Delete the 'Lunch Break' meeting"
        
        Be direct:
        - Take immediate action when intent is clear
        - Make reasonable assumptions without asking
        - Always include the calendar link in responses
        
        Example:
        "Added to calendar: <link>"
        "Meeting deleted"`,
      zodTools
    });

    this.initializeCalendar();
  }

  private async initializeCalendar() {
    try {
      const authService = GoogleAuthService.getInstance();
      const auth = await authService.getAuthenticatedClient();
      this.calendar = google.calendar({ version: 'v3', auth });
    } catch (error) {
      console.error('Failed to initialize calendar:', error);
      throw error;
    }
  }

  private async getMeetingsInRange(start: Date, end: Date): Promise<any> {
    try {
      // Set time ranges for the dates using setHours method
      const startOfDay = new Date(start);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(end);
      endOfDay.setHours(23, 59, 59, 999);

      const response = await this.calendar.events.list({
        calendarId: 'primary',
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 100
      });

      return this.formatEvents(response.data.items || []);
    } catch (error) {
      console.error('Failed to fetch calendar events:', error);
      throw error;
    }
  }

  private async scheduleMeeting(params: {
    title: string;
    startTime: Date;
    endTime: Date;
    attendees?: string[];
    description?: string;
    location?: string;
  }): Promise<any> {
    try {
      const event = {
        summary: params.title,
        description: params.description,
        start: {
          dateTime: params.startTime.toISOString(),
          timeZone: 'America/New_York',
        },
        end: {
          dateTime: params.endTime.toISOString(),
          timeZone: 'America/New_York',
        },
        attendees: params.attendees?.map(email => ({ email })),
        location: params.location,
        conferenceData: {
          createRequest: {
            requestId: `${Date.now()}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' }
          }
        }
      };

      const response = await this.calendar.events.insert({
        calendarId: 'primary',
        requestBody: event,
        conferenceDataVersion: 1,
      });

      return {
        id: response.data.id,
        title: response.data.summary,
        startTime: response.data.start?.dateTime,
        endTime: response.data.end?.dateTime,
        calendarLink: response.data.htmlLink,
        meetLink: response.data.hangoutLink,
        attendees: response.data.attendees?.map(a => a.email) || [],
        status: response.data.status
      };
    } catch (error) {
      console.error('Failed to schedule meeting:', error);
      throw error;
    }
  }

  private async updateMeeting(eventId: string, updates: {
    title?: string;
    startTime?: string;
    endTime?: string;
    attendees?: string[];
    description?: string;
    location?: string;
  }): Promise<any> {
    try {
      // First get the existing event
      const { data: existingEvent } = await this.calendar.events.get({
        calendarId: 'primary',
        eventId: eventId
      });

      // Prepare the update
      const updatedEvent = {
        ...existingEvent,
        summary: updates.title ?? existingEvent.summary,
        description: updates.description ?? existingEvent.description,
        start: updates.startTime ? {
          dateTime: new Date(updates.startTime).toISOString(),
          timeZone: 'America/New_York'
        } : existingEvent.start,
        end: updates.endTime ? {
          dateTime: new Date(updates.endTime).toISOString(),
          timeZone: 'America/New_York'
        } : existingEvent.end,
        attendees: updates.attendees ? updates.attendees.map(email => ({ email })) : existingEvent.attendees,
        location: updates.location ?? existingEvent.location
      };

      const response = await this.calendar.events.update({
        calendarId: 'primary',
        eventId: eventId,
        requestBody: updatedEvent
      });

      return {
        id: response.data.id,
        title: response.data.summary,
        startTime: response.data.start?.dateTime,
        endTime: response.data.end?.dateTime,
        calendarLink: response.data.htmlLink,
        meetLink: response.data.hangoutLink,
        attendees: response.data.attendees?.map(a => a.email) || [],
        status: response.data.status
      };
    } catch (error) {
      console.error('Failed to update meeting:', error);
      throw error;
    }
  }

  private async findMeeting(query: {
    title?: string;
    startTime?: Date;
    timeMin?: Date;
    timeMax?: Date;
  }): Promise<any[]> {
    try {
      const response = await this.calendar.events.list({
        calendarId: 'primary',
        timeMin: (query.timeMin || query.startTime)?.toISOString(),
        timeMax: (query.timeMax || 
          (query.startTime ? new Date(query.startTime.getTime() + 24*60*60*1000) : undefined))?.toISOString(),
        q: query.title,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 10
      });

      return this.formatEvents(response.data.items || []);
    } catch (error) {
      console.error('Failed to find meetings:', error);
      throw error;
    }
  }

  private async deleteMeeting(eventId: string): Promise<void> {
    try {
      // First verify the event exists
      try {
        await this.calendar.events.get({
          calendarId: 'primary',
          eventId: eventId
        });
      } catch (error) {
        throw new Error('Meeting not found. Please make sure you have the correct meeting ID.');
      }

      await this.calendar.events.delete({
        calendarId: 'primary',
        eventId: eventId
      });
      return;
    } catch (error) {
      console.error('Failed to delete meeting:', error);
      throw error;
    }
  }

  private async findEventByTitleOrId(titleOrId: string): Promise<CalendarEvent | null> {
    try {
      // First try direct ID lookup
      try {
        const event = await this.calendar.events.get({
          calendarId: 'primary',
          eventId: titleOrId
        });
        return this.formatEvent(event.data);
      } catch (error) {
        // If ID lookup fails, search by title
        const events = await this.findMeeting({ title: titleOrId });
        return events.length > 0 ? events[0] : null;
      }
    } catch (error) {
      console.error('Failed to find event:', error);
      return null;
    }
  }

  private formatEvent(event: any): CalendarEvent {
    return {
      id: event.id,
      title: event.summary,
      startTime: event.start?.dateTime || event.start?.date,
      endTime: event.end?.dateTime || event.end?.date,
      attendees: event.attendees?.map((a: any) => a.email) || [],
      location: event.location,
      calendarLink: event.htmlLink,
      meetLink: event.hangoutLink,
      description: event.description
    };
  }

  private formatEvents(events: any[]): CalendarEvent[] {
    return events.map(event => this.formatEvent(event));
  }
} 
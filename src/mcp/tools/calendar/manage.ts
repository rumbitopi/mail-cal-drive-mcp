/**
 * Calendar management MCP tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  getProviderRegistry,
  CreateEventInput,
  UpdateEventInput,
} from '../../../providers/index.js';
import { logger } from '../../../logger.js';

/**
 * Register calendar management tools with the MCP server.
 */
export function registerCalendarManageTools(server: McpServer): void {
  // create_event - Create a new calendar event
  server.tool(
    'create_event',
    'Create a new calendar event',
    {
      accountId: z.string().describe('The account ID'),
      calendarId: z.string().optional().describe('Calendar ID (default: primary)'),
      title: z.string().describe('Event title'),
      description: z.string().optional().describe('Event description'),
      location: z.string().optional().describe('Event location'),
      startTime: z.string().describe('Start time (ISO 8601)'),
      endTime: z.string().describe('End time (ISO 8601)'),
      isAllDay: z.boolean().optional().describe('All-day event (default: false)'),
      timeZone: z.string().optional().describe('Time zone (default: UTC)'),
      attendees: z
        .array(
          z.object({
            email: z.string().describe('Attendee email'),
            optional: z.boolean().optional().describe('Optional attendee'),
          })
        )
        .optional()
        .describe('Event attendees'),
      visibility: z.enum(['public', 'private']).optional().describe('Event visibility'),
      addConference: z.boolean().optional().describe('Add video conference link'),
    },
    async (args) => {
      try {
        const registry = getProviderRegistry();
        const provider = await registry.getProvider(args.accountId);

        if (!provider) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'Account not found or not connected' }),
              },
            ],
            isError: true,
          };
        }

        if (!provider.calendar) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'Account does not support calendar' }),
              },
            ],
            isError: true,
          };
        }

        const input: CreateEventInput = {
          title: args.title,
          startTime: args.startTime,
          endTime: args.endTime,
        };

        if (args.description) input.description = args.description;
        if (args.location) input.location = args.location;
        if (args.isAllDay !== undefined) input.isAllDay = args.isAllDay;
        if (args.timeZone) input.timeZone = args.timeZone;
        if (args.attendees) input.attendees = args.attendees;
        if (args.visibility) input.visibility = args.visibility;
        if (args.addConference !== undefined) input.addConference = args.addConference;

        const event = await provider.calendar.createEvent(args.calendarId ?? null, input);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  event: {
                    id: event.id,
                    title: event.title,
                    startTime: event.startTime.toISOString(),
                    endTime: event.endTime.toISOString(),
                    meetingLink: event.meetingLink,
                    calendarId: event.calendarId,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('create_event failed', error);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // update_event - Update an existing event
  server.tool(
    'update_event',
    'Update an existing calendar event',
    {
      accountId: z.string().describe('The account ID'),
      eventId: z.string().describe('The event ID'),
      calendarId: z.string().optional().describe('Calendar ID (default: primary)'),
      title: z.string().optional().describe('New event title'),
      description: z.string().optional().describe('New event description'),
      location: z.string().optional().describe('New event location'),
      startTime: z.string().optional().describe('New start time (ISO 8601)'),
      endTime: z.string().optional().describe('New end time (ISO 8601)'),
      isAllDay: z.boolean().optional().describe('All-day event'),
      timeZone: z.string().optional().describe('Time zone'),
      attendees: z
        .array(
          z.object({
            email: z.string().describe('Attendee email'),
            optional: z.boolean().optional().describe('Optional attendee'),
          })
        )
        .optional()
        .describe('Updated attendees (replaces existing)'),
      visibility: z.enum(['public', 'private']).optional().describe('Event visibility'),
      notifyAttendees: z.boolean().optional().describe('Send update notifications'),
    },
    async (args) => {
      try {
        const registry = getProviderRegistry();
        const provider = await registry.getProvider(args.accountId);

        if (!provider) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'Account not found or not connected' }),
              },
            ],
            isError: true,
          };
        }

        if (!provider.calendar) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'Account does not support calendar' }),
              },
            ],
            isError: true,
          };
        }

        const updates: UpdateEventInput = {};

        if (args.title) updates.title = args.title;
        if (args.description) updates.description = args.description;
        if (args.location) updates.location = args.location;
        if (args.startTime) updates.startTime = args.startTime;
        if (args.endTime) updates.endTime = args.endTime;
        if (args.isAllDay !== undefined) updates.isAllDay = args.isAllDay;
        if (args.timeZone) updates.timeZone = args.timeZone;
        if (args.attendees) updates.attendees = args.attendees;
        if (args.visibility) updates.visibility = args.visibility;
        if (args.notifyAttendees !== undefined) updates.notifyAttendees = args.notifyAttendees;

        const event = await provider.calendar.updateEvent(args.eventId, updates, args.calendarId);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  event: {
                    id: event.id,
                    title: event.title,
                    startTime: event.startTime.toISOString(),
                    endTime: event.endTime.toISOString(),
                    updated: event.updated?.toISOString(),
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('update_event failed', error);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // delete_event - Delete an event
  server.tool(
    'delete_event',
    'Delete a calendar event',
    {
      accountId: z.string().describe('The account ID'),
      eventId: z.string().describe('The event ID'),
      calendarId: z.string().optional().describe('Calendar ID (default: primary)'),
      notifyAttendees: z.boolean().optional().describe('Send cancellation notices (default: true)'),
    },
    async (args) => {
      try {
        const registry = getProviderRegistry();
        const provider = await registry.getProvider(args.accountId);

        if (!provider) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'Account not found or not connected' }),
              },
            ],
            isError: true,
          };
        }

        if (!provider.calendar) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'Account does not support calendar' }),
              },
            ],
            isError: true,
          };
        }

        await provider.calendar.deleteEvent(args.eventId, args.calendarId, args.notifyAttendees ?? true);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                eventId: args.eventId,
                deleted: true,
              }),
            },
          ],
        };
      } catch (error) {
        logger.error('delete_event failed', error);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );
}

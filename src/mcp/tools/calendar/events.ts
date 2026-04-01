/**
 * Calendar event MCP tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getProviderRegistry } from '../../../providers/index.js';
import { logger } from '../../../logger.js';

/**
 * Register calendar event tools with the MCP server.
 */
export function registerCalendarEventTools(server: McpServer): void {
  // list_events - List events in a date range
  server.tool(
    'list_events',
    'List calendar events within a date range',
    {
      accountId: z.string().describe('The account ID'),
      calendarId: z.string().optional().describe('Calendar ID (default: primary)'),
      startDate: z.string().describe('Start date (ISO 8601)'),
      endDate: z.string().describe('End date (ISO 8601)'),
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

        const start = new Date(args.startDate);
        const end = new Date(args.endDate);
        const events = await provider.calendar.listEvents(args.calendarId ?? null, start, end);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  accountId: args.accountId,
                  calendarId: args.calendarId ?? 'primary',
                  startDate: args.startDate,
                  endDate: args.endDate,
                  events: events.map((e) => ({
                    id: e.id,
                    title: e.title,
                    description: e.description,
                    location: e.location,
                    startTime: e.startTime.toISOString(),
                    endTime: e.endTime.toISOString(),
                    isAllDay: e.isAllDay,
                    timeZone: e.timeZone,
                    status: e.status,
                    visibility: e.visibility,
                    meetingLink: e.meetingLink,
                    attendees: e.attendees?.map((a) => ({
                      email: a.email,
                      name: a.name,
                      status: a.status,
                      isOrganizer: a.isOrganizer,
                    })),
                  })),
                  count: events.length,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('list_events failed', error);
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

  // get_event - Get full event details
  server.tool(
    'get_event',
    'Get full details of a calendar event',
    {
      accountId: z.string().describe('The account ID'),
      eventId: z.string().describe('The event ID'),
      calendarId: z.string().optional().describe('Calendar ID (default: primary)'),
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

        const event = await provider.calendar.getEvent(args.eventId, args.calendarId);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  id: event.id,
                  accountId: event.accountId,
                  calendarId: event.calendarId,
                  title: event.title,
                  description: event.description,
                  location: event.location,
                  startTime: event.startTime.toISOString(),
                  endTime: event.endTime.toISOString(),
                  isAllDay: event.isAllDay,
                  timeZone: event.timeZone,
                  status: event.status,
                  visibility: event.visibility,
                  meetingLink: event.meetingLink,
                  conferenceData: event.conferenceData,
                  attendees: event.attendees?.map((a) => ({
                    email: a.email,
                    name: a.name,
                    status: a.status,
                    isOrganizer: a.isOrganizer,
                    isOptional: a.isOptional,
                    comment: a.comment,
                  })),
                  organizer: event.organizer,
                  recurrence: event.recurrence,
                  iCalUID: event.iCalUID,
                  created: event.created?.toISOString(),
                  updated: event.updated?.toISOString(),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('get_event failed', error);
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

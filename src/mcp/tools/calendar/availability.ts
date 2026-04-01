/**
 * Calendar availability MCP tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getProviderRegistry } from '../../../providers/index.js';
import { logger } from '../../../logger.js';

/**
 * Register calendar availability tools with the MCP server.
 */
export function registerCalendarAvailabilityTools(server: McpServer): void {
  // find_free_time - Find available time slots across accounts
  server.tool(
    'find_free_time',
    'Find available time slots in a date range across one or more accounts',
    {
      accountIds: z.array(z.string()).describe('The account IDs to check'),
      startDate: z.string().describe('Start of search range (ISO 8601)'),
      endDate: z.string().describe('End of search range (ISO 8601)'),
      duration: z.number().describe('Required duration in minutes'),
      calendarIds: z
        .array(z.string())
        .optional()
        .describe('Calendars to check per account (default: primary)'),
    },
    async (args) => {
      try {
        const registry = getProviderRegistry();
        const start = new Date(args.startDate);
        const end = new Date(args.endDate);
        const durationMs = args.duration * 60 * 1000;
        const errors: string[] = [];

        // Collect all busy slots from all accounts
        const allBusySlots: { start: Date; end: Date }[] = [];

        for (const accountId of args.accountIds) {
          try {
            const provider = await registry.getProvider(accountId);

            if (!provider) {
              errors.push(`${accountId}: Account not found or not connected`);
              continue;
            }

            if (!provider.calendar || !provider.calendar.getFreeBusy) {
              errors.push(`${accountId}: Account does not support calendar`);
              continue;
            }

            const busySlots = await provider.calendar.getFreeBusy(
              start,
              end,
              args.calendarIds
            );

            for (const slot of busySlots) {
              allBusySlots.push({ start: slot.start, end: slot.end });
            }
          } catch (error) {
            errors.push(
              `${accountId}: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        }

        // Sort busy slots by start time
        allBusySlots.sort((a, b) => a.start.getTime() - b.start.getTime());

        // Merge overlapping busy slots
        const mergedBusy: { start: Date; end: Date }[] = [];
        for (const slot of allBusySlots) {
          if (mergedBusy.length === 0) {
            mergedBusy.push(slot);
          } else {
            const last = mergedBusy[mergedBusy.length - 1]!;
            if (slot.start <= last.end) {
              // Overlapping or adjacent, extend the last slot
              last.end = new Date(Math.max(last.end.getTime(), slot.end.getTime()));
            } else {
              mergedBusy.push(slot);
            }
          }
        }

        // Find free slots between busy periods
        const freeSlots: { start: Date; end: Date }[] = [];
        let currentStart = start;

        for (const busy of mergedBusy) {
          if (busy.start.getTime() - currentStart.getTime() >= durationMs) {
            freeSlots.push({
              start: new Date(currentStart),
              end: new Date(busy.start),
            });
          }
          if (busy.end > currentStart) {
            currentStart = busy.end;
          }
        }

        // Check for free time after last busy slot
        if (end.getTime() - currentStart.getTime() >= durationMs) {
          freeSlots.push({
            start: new Date(currentStart),
            end: new Date(end),
          });
        }

        const result: any = {
          accountIds: args.accountIds,
          startDate: args.startDate,
          endDate: args.endDate,
          duration: args.duration,
          freeSlots: freeSlots.map((slot) => ({
            start: slot.start.toISOString(),
            end: slot.end.toISOString(),
            durationMinutes: Math.round(
              (slot.end.getTime() - slot.start.getTime()) / 60000
            ),
          })),
          count: freeSlots.length,
        };

        if (errors.length > 0) {
          result.errors = errors;
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('find_free_time failed', error);
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

  // check_conflicts - Check for scheduling conflicts across accounts
  server.tool(
    'check_conflicts',
    'Check for scheduling conflicts in a time range across one or more accounts',
    {
      accountIds: z.array(z.string()).describe('The account IDs to check'),
      startTime: z.string().describe('Proposed start time (ISO 8601)'),
      endTime: z.string().describe('Proposed end time (ISO 8601)'),
      calendarIds: z
        .array(z.string())
        .optional()
        .describe('Calendars to check per account (default: primary)'),
      excludeEventId: z.string().optional().describe('Exclude this event from conflict check'),
    },
    async (args) => {
      try {
        const registry = getProviderRegistry();
        const start = new Date(args.startTime);
        const end = new Date(args.endTime);
        const errors: string[] = [];

        // Collect all conflicts from all accounts
        const allConflicts: Array<{
          accountId: string;
          event: {
            id: string;
            title: string;
            startTime: string;
            endTime: string;
          };
          overlapStart: string;
          overlapEnd: string;
        }> = [];

        for (const accountId of args.accountIds) {
          try {
            const provider = await registry.getProvider(accountId);

            if (!provider) {
              errors.push(`${accountId}: Account not found or not connected`);
              continue;
            }

            if (!provider.calendar || !provider.calendar.checkConflicts) {
              errors.push(`${accountId}: Account does not support calendar`);
              continue;
            }

            const result = await provider.calendar.checkConflicts(
              start,
              end,
              args.calendarIds,
              args.excludeEventId
            );

            // Add accountId to each conflict for identification
            for (const c of result.conflicts) {
              allConflicts.push({
                accountId,
                event: {
                  id: c.event.id,
                  title: c.event.title,
                  startTime: c.event.startTime.toISOString(),
                  endTime: c.event.endTime.toISOString(),
                },
                overlapStart: c.overlapStart.toISOString(),
                overlapEnd: c.overlapEnd.toISOString(),
              });
            }
          } catch (error) {
            errors.push(
              `${accountId}: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        }

        const result: any = {
          accountIds: args.accountIds,
          startTime: args.startTime,
          endTime: args.endTime,
          hasConflict: allConflicts.length > 0,
          conflicts: allConflicts,
          conflictCount: allConflicts.length,
        };

        if (errors.length > 0) {
          result.errors = errors;
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('check_conflicts failed', error);
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

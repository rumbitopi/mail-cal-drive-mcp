/**
 * Google Calendar provider.
 */

import { google, calendar_v3 } from 'googleapis';
import { Auth } from 'googleapis';
import { ICalendarProvider } from '../base.js';
import {
  Calendar,
  CalendarEvent,
  Attendee,
  CreateEventInput,
  UpdateEventInput,
  FreeBusySlot,
  ConflictResult,
  NotFoundError,
  RecurrenceRule,
} from '../types.js';
import { logger } from '../../logger.js';
import { parseRRule, toRRuleString } from '../../utils/recurrence.js';

/**
 * Google Calendar provider implementation.
 */
export class GoogleCalendarProvider implements ICalendarProvider {
  readonly accountId: string;
  readonly capabilities = ['calendar'] as const;
  private calendar: calendar_v3.Calendar;

  constructor(accountId: string, auth: Auth.OAuth2Client) {
    this.accountId = accountId;
    this.calendar = google.calendar({ version: 'v3', auth });
  }

  async listCalendars(): Promise<Calendar[]> {
    const response = await this.calendar.calendarList.list();
    const calendars = response.data.items || [];

    return calendars.map((cal) => this.mapCalendar(cal));
  }

  async listEvents(
    calendarId: string | null,
    start: Date,
    end: Date
  ): Promise<CalendarEvent[]> {
    const id = calendarId || 'primary';

    const response = await this.calendar.events.list({
      calendarId: id,
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true, // Expand recurring events
      orderBy: 'startTime',
      maxResults: 250,
    });

    const events = response.data.items || [];
    return events.map((evt) => this.mapEvent(evt, id));
  }

  async getEvent(eventId: string, calendarId?: string): Promise<CalendarEvent> {
    const id = calendarId || 'primary';

    const response = await this.calendar.events.get({
      calendarId: id,
      eventId,
    });

    if (!response.data) {
      throw new NotFoundError('google', `Event ${eventId}`);
    }

    return this.mapEvent(response.data, id);
  }

  async createEvent(
    calendarId: string | null,
    event: CreateEventInput
  ): Promise<CalendarEvent> {
    const id = calendarId || 'primary';
    const gcalEvent = this.toGoogleEvent(event);

    const response = await this.calendar.events.insert({
      calendarId: id,
      requestBody: gcalEvent,
      conferenceDataVersion: event.addConference ? 1 : 0,
    });

    logger.debug('Event created', { eventId: response.data.id, calendarId: id });
    return this.mapEvent(response.data, id);
  }

  async updateEvent(
    eventId: string,
    updates: UpdateEventInput,
    calendarId?: string
  ): Promise<CalendarEvent> {
    const id = calendarId || 'primary';

    // Get current event
    const current = await this.calendar.events.get({
      calendarId: id,
      eventId,
    });

    // Merge updates
    const gcalEvent = this.toGoogleEvent(updates);
    const merged = { ...current.data, ...gcalEvent };

    const response = await this.calendar.events.update({
      calendarId: id,
      eventId,
      requestBody: merged,
      sendUpdates: updates.notifyAttendees ? 'all' : 'none',
    });

    logger.debug('Event updated', { eventId, calendarId: id });
    return this.mapEvent(response.data, id);
  }

  async deleteEvent(
    eventId: string,
    calendarId?: string,
    notifyAttendees: boolean = true
  ): Promise<void> {
    const id = calendarId || 'primary';

    await this.calendar.events.delete({
      calendarId: id,
      eventId,
      sendUpdates: notifyAttendees ? 'all' : 'none',
    });

    logger.debug('Event deleted', { eventId, calendarId: id });
  }

  async getFreeBusy(
    start: Date,
    end: Date,
    calendarIds?: string[]
  ): Promise<FreeBusySlot[]> {
    const ids = calendarIds || ['primary'];

    const response = await this.calendar.freebusy.query({
      requestBody: {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        items: ids.map((id) => ({ id })),
      },
    });

    const slots: FreeBusySlot[] = [];
    const calendars = response.data.calendars || {};

    for (const [calId, data] of Object.entries(calendars)) {
      const busy = (data as any).busy || [];
      for (const slot of busy) {
        slots.push({
          accountId: this.accountId,
          calendarId: calId,
          start: new Date(slot.start),
          end: new Date(slot.end),
          status: 'busy',
        });
      }
    }

    return slots;
  }

  async findFreeTime(
    start: Date,
    end: Date,
    duration: number,
    calendarIds?: string[]
  ): Promise<{ start: Date; end: Date }[]> {
    const busySlots = await this.getFreeBusy(start, end, calendarIds);

    // Sort by start time
    busySlots.sort((a, b) => a.start.getTime() - b.start.getTime());

    // Find free slots
    const freeSlots: { start: Date; end: Date }[] = [];
    let currentStart = start;
    const durationMs = duration * 60 * 1000;

    for (const busy of busySlots) {
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

    if (end.getTime() - currentStart.getTime() >= durationMs) {
      freeSlots.push({
        start: new Date(currentStart),
        end: new Date(end),
      });
    }

    return freeSlots;
  }

  async checkConflicts(
    start: Date,
    end: Date,
    calendarIds?: string[],
    excludeEventId?: string
  ): Promise<ConflictResult> {
    const ids = calendarIds && calendarIds.length > 0 ? calendarIds : [null];
    const allConflicts: { event: CalendarEvent; overlapStart: Date; overlapEnd: Date }[] = [];

    // Check all specified calendars for conflicts
    for (const calId of ids) {
      const events = await this.listEvents(calId, start, end);

      const conflicts = events
        .filter((evt) => {
          if (evt.id === excludeEventId) return false;
          if (evt.status === 'cancelled') return false;
          return evt.startTime < end && evt.endTime > start;
        })
        .map((evt) => ({
          event: evt,
          overlapStart: new Date(Math.max(evt.startTime.getTime(), start.getTime())),
          overlapEnd: new Date(Math.min(evt.endTime.getTime(), end.getTime())),
        }));

      allConflicts.push(...conflicts);
    }

    return {
      hasConflict: allConflicts.length > 0,
      conflicts: allConflicts,
    };
  }

  /**
   * Convert our event input to Google Calendar format.
   */
  private toGoogleEvent(
    event: CreateEventInput | UpdateEventInput
  ): calendar_v3.Schema$Event {
    const gcalEvent: calendar_v3.Schema$Event = {};

    if (event.title !== undefined) {
      gcalEvent.summary = event.title;
    }
    if (event.description !== undefined) {
      gcalEvent.description = event.description;
    }
    if (event.location !== undefined) {
      gcalEvent.location = event.location;
    }
    if (event.startTime !== undefined) {
      if (event.isAllDay) {
        gcalEvent.start = { date: event.startTime.split('T')[0] };
      } else {
        gcalEvent.start = {
          dateTime: event.startTime,
          timeZone: event.timeZone || 'UTC',
        };
      }
    }
    if (event.endTime !== undefined) {
      if (event.isAllDay) {
        gcalEvent.end = { date: event.endTime.split('T')[0] };
      } else {
        gcalEvent.end = {
          dateTime: event.endTime,
          timeZone: event.timeZone || 'UTC',
        };
      }
    }
    if (event.attendees !== undefined) {
      gcalEvent.attendees = event.attendees.map((a) => ({
        email: a.email,
        optional: a.optional,
      }));
    }
    if (event.visibility !== undefined) {
      gcalEvent.visibility = event.visibility;
    }
    if (event.addConference) {
      gcalEvent.conferenceData = {
        createRequest: {
          requestId: `meet-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      };
    }
    if (event.recurrence) {
      // Convert our RecurrenceRule to RRULE string for Google Calendar
      const startDate = new Date(event.startTime || new Date());
      const rruleString = toRRuleString(startDate, {
        frequency: event.recurrence.frequency,
        interval: event.recurrence.interval,
        count: event.recurrence.count,
        until: event.recurrence.until?.toISOString(),
        byDay: event.recurrence.byDay,
        byMonth: event.recurrence.byMonth,
        byMonthDay: event.recurrence.byMonthDay,
      });
      // Google Calendar expects recurrence as array of RRULE strings (without DTSTART)
      const rruleLine = rruleString.split('\n').find((line) => line.startsWith('RRULE:'));
      if (rruleLine) {
        gcalEvent.recurrence = [rruleLine];
      }
    }

    return gcalEvent;
  }

  /**
   * Map Google calendar to our Calendar type.
   */
  private mapCalendar(cal: calendar_v3.Schema$CalendarListEntry): Calendar {
    const calendar: Calendar = {
      id: cal.id || '',
      accountId: this.accountId,
      name: cal.summary || '',
      isDefault: cal.primary || false,
      isReadOnly: cal.accessRole === 'reader' || cal.accessRole === 'freeBusyReader',
      timeZone: cal.timeZone || 'UTC',
      canEdit: cal.accessRole === 'owner' || cal.accessRole === 'writer',
      canShare: cal.accessRole === 'owner',
    };
    if (cal.description) calendar.description = cal.description;
    if (cal.backgroundColor) calendar.color = cal.backgroundColor;
    return calendar;
  }

  /**
   * Map Google event to our CalendarEvent type.
   */
  private mapEvent(evt: calendar_v3.Schema$Event, calendarId: string): CalendarEvent {
    const event: CalendarEvent = {
      id: evt.id || '',
      accountId: this.accountId,
      calendarId,
      title: evt.summary || '(No Title)',
      startTime: new Date(evt.start?.dateTime || evt.start?.date || ''),
      endTime: new Date(evt.end?.dateTime || evt.end?.date || ''),
      isAllDay: !!evt.start?.date,
      timeZone: evt.start?.timeZone || 'UTC',
      status: this.mapStatus(evt.status ?? undefined),
      visibility: (evt.visibility as any) || 'public',
      created: new Date(evt.created || ''),
      updated: new Date(evt.updated || ''),
    };

    if (evt.description) event.description = evt.description;
    if (evt.location) event.location = evt.location;
    if (evt.attendees) {
      event.attendees = evt.attendees.map((a) => this.mapAttendee(a));
    }
    if (evt.organizer) {
      const organizer: Attendee = {
        email: evt.organizer.email || '',
        status: 'accepted',
        isOrganizer: true,
        isOptional: false,
      };
      if (evt.organizer.displayName) organizer.name = evt.organizer.displayName;
      event.organizer = organizer;
    }
    if (evt.hangoutLink) {
      event.meetingLink = evt.hangoutLink;
      event.conferenceData = {
        type: 'meet',
        url: evt.hangoutLink,
      };
    }
    if (evt.iCalUID) event.iCalUID = evt.iCalUID;
    if (evt.recurrence && evt.recurrence.length > 0) {
      // Parse RRULE from Google Calendar recurrence array
      const rruleLine = evt.recurrence.find((r: string) => r.startsWith('RRULE:'));
      if (rruleLine) {
        const parsed = parseRRule(rruleLine);
        if (parsed) {
          event.recurrence = {
            frequency: parsed.frequency,
            interval: parsed.interval || 1,
            count: parsed.count,
            until: parsed.until ? new Date(parsed.until) : undefined,
            byDay: parsed.byDay,
            byMonth: parsed.byMonth,
            byMonthDay: parsed.byMonthDay,
          };
        }
      }
    }
    if (evt.recurringEventId) {
      event.recurrenceId = evt.recurringEventId;
    }

    return event;
  }

  /**
   * Map Google attendee to our Attendee type.
   */
  private mapAttendee(attendee: calendar_v3.Schema$EventAttendee): Attendee {
    const result: Attendee = {
      email: attendee.email || '',
      status: this.mapAttendeeStatus(attendee.responseStatus ?? undefined),
      isOrganizer: attendee.organizer || false,
      isOptional: attendee.optional || false,
    };
    if (attendee.displayName) result.name = attendee.displayName;
    if (attendee.comment) result.comment = attendee.comment;
    return result;
  }

  /**
   * Map Google response status to our status.
   */
  private mapAttendeeStatus(
    status?: string
  ): 'accepted' | 'declined' | 'tentative' | 'needsAction' {
    switch (status) {
      case 'accepted':
        return 'accepted';
      case 'declined':
        return 'declined';
      case 'tentative':
        return 'tentative';
      default:
        return 'needsAction';
    }
  }

  /**
   * Map Google event status to our status.
   */
  private mapStatus(status?: string): 'confirmed' | 'tentative' | 'cancelled' {
    switch (status) {
      case 'cancelled':
        return 'cancelled';
      case 'tentative':
        return 'tentative';
      default:
        return 'confirmed';
    }
  }
}

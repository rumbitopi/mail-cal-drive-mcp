/**
 * Microsoft 365 Calendar provider using Graph API.
 */

import { Client } from '@microsoft/microsoft-graph-client';
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
import { parseISO } from '../../utils/timezone.js';

/**
 * Microsoft Calendar provider implementation.
 */
export class MicrosoftCalendarProvider implements ICalendarProvider {
  readonly accountId: string;
  readonly capabilities = ['calendar'] as const;
  private client: Client;

  constructor(accountId: string, client: Client) {
    this.accountId = accountId;
    this.client = client;
  }

  async listCalendars(): Promise<Calendar[]> {
    const response = await this.client
      .api('/me/calendars')
      .select('id,name,color,isDefaultCalendar,canEdit,canShare')
      .get();

    return response.value.map((cal: any) => this.mapCalendar(cal));
  }

  async listEvents(
    calendarId: string | null,
    start: Date,
    end: Date
  ): Promise<CalendarEvent[]> {
    const path = calendarId
      ? `/me/calendars/${calendarId}/calendarView`
      : '/me/calendarView';

    const response = await this.client
      .api(path)
      .query({
        startDateTime: start.toISOString(),
        endDateTime: end.toISOString(),
      })
      .select(
        'id,subject,body,start,end,location,isAllDay,showAs,importance,sensitivity,organizer,attendees,recurrence,onlineMeeting,webLink,createdDateTime,lastModifiedDateTime'
      )
      .top(250)
      .orderby('start/dateTime')
      .get();

    return response.value.map((evt: any) =>
      this.mapEvent(evt, calendarId || 'default')
    );
  }

  async getEvent(eventId: string, calendarId?: string): Promise<CalendarEvent> {
    const path = calendarId
      ? `/me/calendars/${calendarId}/events/${eventId}`
      : `/me/events/${eventId}`;

    const response = await this.client
      .api(path)
      .select(
        'id,subject,body,start,end,location,isAllDay,showAs,importance,sensitivity,organizer,attendees,recurrence,onlineMeeting,webLink,createdDateTime,lastModifiedDateTime,iCalUId'
      )
      .get();

    if (!response) {
      throw new NotFoundError('microsoft', `Event ${eventId}`);
    }

    return this.mapEvent(response, calendarId || 'default');
  }

  async createEvent(
    calendarId: string | null,
    event: CreateEventInput
  ): Promise<CalendarEvent> {
    const path = calendarId
      ? `/me/calendars/${calendarId}/events`
      : '/me/events';

    const graphEvent = this.toGraphEvent(event);

    const response = await this.client.api(path).post(graphEvent);

    logger.debug('Event created', { eventId: response.id, calendarId });
    return this.mapEvent(response, calendarId || 'default');
  }

  async updateEvent(
    eventId: string,
    updates: UpdateEventInput,
    calendarId?: string
  ): Promise<CalendarEvent> {
    const path = calendarId
      ? `/me/calendars/${calendarId}/events/${eventId}`
      : `/me/events/${eventId}`;

    const graphEvent = this.toGraphEvent(updates);

    const response = await this.client.api(path).patch(graphEvent);

    logger.debug('Event updated', { eventId, calendarId });
    return this.mapEvent(response, calendarId || 'default');
  }

  async deleteEvent(
    eventId: string,
    calendarId?: string,
    notifyAttendees: boolean = true
  ): Promise<void> {
    const path = calendarId
      ? `/me/calendars/${calendarId}/events/${eventId}`
      : `/me/events/${eventId}`;

    // Graph API always notifies attendees on delete
    await this.client.api(path).delete();

    logger.debug('Event deleted', { eventId, calendarId });
  }

  async getFreeBusy(
    start: Date,
    end: Date,
    calendarIds?: string[]
  ): Promise<FreeBusySlot[]> {
    const slots: FreeBusySlot[] = [];
    const ids = calendarIds && calendarIds.length > 0 ? calendarIds : [null];

    // Get events from all specified calendars
    for (const calId of ids) {
      const events = await this.listEvents(calId, start, end);
      for (const evt of events) {
        if (evt.status !== 'cancelled') {
          slots.push({
            accountId: this.accountId,
            calendarId: evt.calendarId,
            start: evt.startTime,
            end: evt.endTime,
            status: this.mapShowAs(evt),
            eventTitle: evt.title,
          });
        }
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
    // Get all busy slots
    const busySlots = await this.getFreeBusy(start, end, calendarIds);

    // Sort by start time
    busySlots.sort((a, b) => a.start.getTime() - b.start.getTime());

    // Find free slots
    const freeSlots: { start: Date; end: Date }[] = [];
    let currentStart = start;
    const durationMs = duration * 60 * 1000;

    for (const busy of busySlots) {
      if (busy.status === 'free') continue;

      // Check if there's a gap before this busy slot
      if (busy.start.getTime() - currentStart.getTime() >= durationMs) {
        freeSlots.push({
          start: new Date(currentStart),
          end: new Date(busy.start),
        });
      }

      // Move current start to after this busy slot
      if (busy.end > currentStart) {
        currentStart = busy.end;
      }
    }

    // Check if there's time after the last busy slot
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

          // Check for overlap
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
   * Convert our event input to Graph API format.
   */
  private toGraphEvent(event: CreateEventInput | UpdateEventInput): any {
    const graphEvent: any = {};

    if (event.title !== undefined) {
      graphEvent.subject = event.title;
    }
    if (event.description !== undefined) {
      graphEvent.body = {
        contentType: 'html',
        content: event.description,
      };
    }
    if (event.location !== undefined) {
      graphEvent.location = {
        displayName: event.location,
      };
    }
    if (event.startTime !== undefined) {
      graphEvent.start = {
        dateTime: event.startTime,
        timeZone: event.timeZone || 'UTC',
      };
    }
    if (event.endTime !== undefined) {
      graphEvent.end = {
        dateTime: event.endTime,
        timeZone: event.timeZone || 'UTC',
      };
    }
    if (event.isAllDay !== undefined) {
      graphEvent.isAllDay = event.isAllDay;
    }
    if (event.attendees !== undefined) {
      graphEvent.attendees = event.attendees.map((a) => ({
        emailAddress: { address: a.email },
        type: a.optional ? 'optional' : 'required',
      }));
    }
    if (event.visibility !== undefined) {
      graphEvent.sensitivity = event.visibility === 'private' ? 'private' : 'normal';
    }
    if (event.addConference) {
      graphEvent.isOnlineMeeting = true;
      graphEvent.onlineMeetingProvider = 'teamsForBusiness';
    }
    if (event.recurrence) {
      // Convert our RecurrenceRule to Graph API recurrence format
      graphEvent.recurrence = this.toGraphRecurrence(event.recurrence, event.startTime);
    }

    return graphEvent;
  }

  /**
   * Convert our RecurrenceRule to Graph API recurrence format.
   */
  private toGraphRecurrence(rule: RecurrenceRule, startTime?: string): any {
    const recurrence: any = {
      pattern: {
        type: this.mapRecurrenceType(rule.frequency, rule.byDay),
        interval: rule.interval || 1,
      },
      range: {
        type: 'noEnd',
        startDate: startTime ? startTime.split('T')[0] : new Date().toISOString().split('T')[0],
      },
    };

    // Set pattern-specific fields
    if (rule.byDay && rule.byDay.length > 0) {
      recurrence.pattern.daysOfWeek = rule.byDay.map((d) => this.mapDayToGraph(d));
    }
    if (rule.byMonthDay && rule.byMonthDay.length > 0) {
      recurrence.pattern.dayOfMonth = rule.byMonthDay[0];
    }
    if (rule.byMonth && rule.byMonth.length > 0) {
      recurrence.pattern.month = rule.byMonth[0];
    }

    // Set range
    if (rule.count) {
      recurrence.range.type = 'numbered';
      recurrence.range.numberOfOccurrences = rule.count;
    } else if (rule.until) {
      recurrence.range.type = 'endDate';
      recurrence.range.endDate = rule.until.toISOString().split('T')[0];
    }

    return recurrence;
  }

  /**
   * Map our frequency to Graph recurrence pattern type.
   */
  private mapRecurrenceType(frequency: string, byDay?: string[]): string {
    if (frequency === 'weekly' && byDay && byDay.length > 0) {
      return 'weekly';
    }
    switch (frequency) {
      case 'daily':
        return 'daily';
      case 'weekly':
        return 'weekly';
      case 'monthly':
        return byDay ? 'relativeMonthly' : 'absoluteMonthly';
      case 'yearly':
        return byDay ? 'relativeYearly' : 'absoluteYearly';
      default:
        return 'daily';
    }
  }

  /**
   * Map day abbreviation to Graph API day name.
   */
  private mapDayToGraph(day: string): string {
    const mapping: Record<string, string> = {
      MO: 'monday',
      TU: 'tuesday',
      WE: 'wednesday',
      TH: 'thursday',
      FR: 'friday',
      SA: 'saturday',
      SU: 'sunday',
    };
    return mapping[day.toUpperCase()] || 'monday';
  }

  /**
   * Map Graph calendar to our Calendar type.
   */
  private mapCalendar(cal: any): Calendar {
    return {
      id: cal.id,
      accountId: this.accountId,
      name: cal.name,
      color: cal.color,
      isDefault: cal.isDefaultCalendar || false,
      isReadOnly: !cal.canEdit,
      timeZone: 'UTC', // Graph returns times in UTC
      canEdit: cal.canEdit || false,
      canShare: cal.canShare || false,
    };
  }

  /**
   * Map Graph event to our CalendarEvent type.
   */
  private mapEvent(evt: any, calendarId: string): CalendarEvent {
    // Use timezone-aware parsing instead of appending 'Z'
    const eventTz = evt.start.timeZone || 'UTC';
    const event: CalendarEvent = {
      id: evt.id,
      accountId: this.accountId,
      calendarId,
      title: evt.subject || '(No Title)',
      startTime: parseISO(evt.start.dateTime, eventTz),
      endTime: parseISO(evt.end.dateTime, eventTz),
      isAllDay: evt.isAllDay || false,
      timeZone: eventTz,
      status: this.mapStatus(evt.showAs),
      visibility: evt.sensitivity === 'private' ? 'private' : 'public',
      created: new Date(evt.createdDateTime),
      updated: new Date(evt.lastModifiedDateTime),
    };

    if (evt.body?.content) event.description = evt.body.content;
    if (evt.location?.displayName) event.location = evt.location.displayName;
    if (evt.attendees) event.attendees = evt.attendees.map((a: any) => this.mapAttendee(a));
    if (evt.organizer) event.organizer = this.mapAttendee(evt.organizer, true);
    if (evt.onlineMeeting?.joinUrl) {
      event.meetingLink = evt.onlineMeeting.joinUrl;
      event.conferenceData = { type: 'teams', url: evt.onlineMeeting.joinUrl };
    }
    if (evt.iCalUId) event.iCalUID = evt.iCalUId;
    if (evt.recurrence) {
      event.recurrence = this.mapGraphRecurrence(evt.recurrence);
    }
    if (evt.seriesMasterId) {
      event.recurrenceId = evt.seriesMasterId;
    }

    return event;
  }

  /**
   * Map Graph API recurrence to our RecurrenceRule.
   */
  private mapGraphRecurrence(recurrence: any): RecurrenceRule {
    const pattern = recurrence.pattern || {};
    const range = recurrence.range || {};

    const rule: RecurrenceRule = {
      frequency: this.mapGraphFrequency(pattern.type),
      interval: pattern.interval || 1,
    };

    // Map days of week
    if (pattern.daysOfWeek && pattern.daysOfWeek.length > 0) {
      rule.byDay = pattern.daysOfWeek.map((d: string) => this.mapGraphDay(d));
    }

    // Map day of month
    if (pattern.dayOfMonth) {
      rule.byMonthDay = [pattern.dayOfMonth];
    }

    // Map month
    if (pattern.month) {
      rule.byMonth = [pattern.month];
    }

    // Map range
    if (range.type === 'numbered' && range.numberOfOccurrences) {
      rule.count = range.numberOfOccurrences;
    } else if (range.type === 'endDate' && range.endDate) {
      rule.until = new Date(range.endDate);
    }

    return rule;
  }

  /**
   * Map Graph recurrence pattern type to our frequency.
   */
  private mapGraphFrequency(type: string): 'daily' | 'weekly' | 'monthly' | 'yearly' {
    switch (type) {
      case 'daily':
        return 'daily';
      case 'weekly':
        return 'weekly';
      case 'absoluteMonthly':
      case 'relativeMonthly':
        return 'monthly';
      case 'absoluteYearly':
      case 'relativeYearly':
        return 'yearly';
      default:
        return 'daily';
    }
  }

  /**
   * Map Graph day name to our abbreviation.
   */
  private mapGraphDay(day: string): string {
    const mapping: Record<string, string> = {
      monday: 'MO',
      tuesday: 'TU',
      wednesday: 'WE',
      thursday: 'TH',
      friday: 'FR',
      saturday: 'SA',
      sunday: 'SU',
    };
    return mapping[day.toLowerCase()] || 'MO';
  }

  /**
   * Map Graph attendee to our Attendee type.
   */
  private mapAttendee(attendee: any, isOrganizer: boolean = false): Attendee {
    return {
      email: attendee.emailAddress?.address || '',
      name: attendee.emailAddress?.name,
      status: this.mapAttendeeStatus(attendee.status?.response),
      isOrganizer,
      isOptional: attendee.type === 'optional',
    };
  }

  /**
   * Map Graph response status to our status.
   */
  private mapAttendeeStatus(
    response?: string
  ): 'accepted' | 'declined' | 'tentative' | 'needsAction' {
    switch (response) {
      case 'accepted':
        return 'accepted';
      case 'declined':
        return 'declined';
      case 'tentativelyAccepted':
        return 'tentative';
      default:
        return 'needsAction';
    }
  }

  /**
   * Map Graph showAs to event status.
   */
  private mapStatus(showAs?: string): 'confirmed' | 'tentative' | 'cancelled' {
    switch (showAs) {
      case 'tentative':
        return 'tentative';
      case 'free':
        return 'tentative';
      default:
        return 'confirmed';
    }
  }

  /**
   * Map showAs to free/busy status.
   */
  private mapShowAs(
    evt: CalendarEvent
  ): 'free' | 'busy' | 'tentative' | 'outOfOffice' {
    if (evt.status === 'tentative') return 'tentative';
    return 'busy';
  }
}

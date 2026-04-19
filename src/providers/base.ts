/**
 * Abstract provider interfaces.
 * All provider implementations must implement these interfaces.
 */

import {
  EmailFolder,
  EmailMessage,
  EmailAttachmentContent,
  EmailSearchCriteria,
  BulkMailAction,
  BulkMailResult,
  Calendar,
  CalendarEvent,
  CreateEventInput,
  UpdateEventInput,
  FreeBusySlot,
  ConflictResult,
  DriveFile,
  FileSearchCriteria,
  FileListResult,
  ShareInput,
  SharedUser,
  ShareLink,
  StorageQuota,
  Capability,
} from './types.js';

// ============================================
// Mail Provider Interface
// ============================================

export interface IMailProvider {
  readonly accountId: string;
  readonly capabilities: readonly ['mail'];

  /**
   * List all folders/labels for the account
   */
  listFolders(): Promise<EmailFolder[]>;

  /**
   * List messages in a folder with pagination
   */
  listMessages(
    folder?: string,
    limit?: number,
    pageToken?: string
  ): Promise<{ messages: EmailMessage[]; nextPageToken?: string }>;

  /**
   * Get a single message with full body
   */
  getMessage(messageId: string): Promise<EmailMessage>;

  /**
   * Get attachment content as base64
   */
  getAttachment(messageId: string, attachmentId: string): Promise<EmailAttachmentContent>;

  /**
   * Search messages across folders
   */
  searchMessages(criteria: EmailSearchCriteria): Promise<EmailMessage[]>;

  /**
   * Move a message to another folder
   */
  moveMessage(messageId: string, toFolder: string): Promise<void>;

  /**
   * Delete a message (trash or permanent)
   */
  deleteMessage(messageId: string, permanent?: boolean): Promise<void>;

  /**
   * Mark a message as read/unread
   */
  markRead(messageId: string, read: boolean): Promise<void>;

  /**
   * Mark a message as starred/unstarred
   */
  markStarred?(messageId: string, starred: boolean): Promise<void>;

  /**
   * Perform bulk operations with optional dry-run
   */
  bulkAction?(action: BulkMailAction): Promise<BulkMailResult>;
}

// ============================================
// Calendar Provider Interface
// ============================================

export interface ICalendarProvider {
  readonly accountId: string;
  readonly capabilities: readonly ['calendar'];

  /**
   * List all calendars for the account
   */
  listCalendars(): Promise<Calendar[]>;

  /**
   * List events in a date range
   */
  listEvents(
    calendarId: string | null,
    start: Date,
    end: Date
  ): Promise<CalendarEvent[]>;

  /**
   * Get a single event with full details
   */
  getEvent(eventId: string, calendarId?: string): Promise<CalendarEvent>;

  /**
   * Create a new event
   */
  createEvent(
    calendarId: string | null,
    event: CreateEventInput
  ): Promise<CalendarEvent>;

  /**
   * Update an existing event
   */
  updateEvent(
    eventId: string,
    updates: UpdateEventInput,
    calendarId?: string
  ): Promise<CalendarEvent>;

  /**
   * Delete an event
   */
  deleteEvent(
    eventId: string,
    calendarId?: string,
    notifyAttendees?: boolean
  ): Promise<void>;

  /**
   * Get free/busy information for a time range
   */
  getFreeBusy(start: Date, end: Date, calendarIds?: string[]): Promise<FreeBusySlot[]>;

  /**
   * Find available time slots
   */
  findFreeTime?(
    start: Date,
    end: Date,
    duration: number, // minutes
    calendarIds?: string[]
  ): Promise<{ start: Date; end: Date }[]>;

  /**
   * Check for conflicts with a proposed time
   */
  checkConflicts?(
    start: Date,
    end: Date,
    calendarIds?: string[],
    excludeEventId?: string
  ): Promise<ConflictResult>;
}

// ============================================
// Drive Provider Interface
// ============================================

export interface IDriveProvider {
  readonly accountId: string;
  readonly capabilities: readonly ['drive'];

  /**
   * List files/folders with pagination
   */
  listFiles(
    folderId?: string,
    limit?: number,
    pageToken?: string
  ): Promise<FileListResult>;

  /**
   * Get file metadata
   */
  getFile(fileId: string): Promise<DriveFile>;

  /**
   * Get file content as buffer
   */
  getFileContent(fileId: string): Promise<Buffer>;

  /**
   * Search files
   */
  searchFiles(criteria: FileSearchCriteria): Promise<DriveFile[]>;

  /**
   * Upload a new file
   */
  uploadFile(
    folderId: string | null,
    name: string,
    content: Buffer,
    mimeType: string
  ): Promise<DriveFile>;

  /**
   * Create a new folder
   */
  createFolder(parentId: string | null, name: string): Promise<DriveFile>;

  /**
   * Move a file/folder
   */
  moveFile(fileId: string, newParentId: string): Promise<DriveFile>;

  /**
   * Copy a file
   */
  copyFile(fileId: string, newParentId?: string, newName?: string): Promise<DriveFile>;

  /**
   * Rename a file/folder
   */
  renameFile(fileId: string, newName: string): Promise<DriveFile>;

  /**
   * Delete a file/folder (trash or permanent)
   */
  deleteFile(fileId: string, permanent?: boolean): Promise<void>;

  /**
   * Get sharing information
   */
  getSharing(fileId: string): Promise<SharedUser[]>;

  /**
   * Share a file
   */
  shareFile(fileId: string, input: ShareInput): Promise<SharedUser | ShareLink>;

  /**
   * Remove sharing
   */
  unshareFile(fileId: string, permissionId: string): Promise<void>;

  /**
   * Get storage quota information
   */
  getStorageQuota(): Promise<StorageQuota>;
}

// ============================================
// Combined Provider Interface
// ============================================

/**
 * A provider instance with its available capabilities.
 * Not all providers support all capabilities.
 */
export interface Provider {
  readonly accountId: string;
  readonly providerType: 'microsoft' | 'google' | 'imap';
  readonly capabilities: Capability[];

  mail?: IMailProvider;
  calendar?: ICalendarProvider;
  drive?: IDriveProvider;

  /**
   * Initialize the provider (create API clients, sub-providers)
   */
  initialize(): Promise<void>;

  /**
   * Check if the provider is connected and authenticated
   */
  isConnected(): Promise<boolean>;

  /**
   * Refresh authentication tokens if needed
   */
  refreshAuth?(): Promise<void>;

  /**
   * Disconnect and clean up resources
   */
  disconnect(): Promise<void>;
}

// ============================================
// Base Provider Class
// ============================================

/**
 * Abstract base class for providers with common functionality
 */
export abstract class BaseProvider implements Provider {
  abstract readonly accountId: string;
  abstract readonly providerType: 'microsoft' | 'google' | 'imap';
  abstract readonly capabilities: Capability[];

  mail?: IMailProvider;
  calendar?: ICalendarProvider;
  drive?: IDriveProvider;

  abstract initialize(): Promise<void>;
  abstract isConnected(): Promise<boolean>;
  abstract disconnect(): Promise<void>;

  /**
   * Check if a capability is supported
   */
  hasCapability(capability: Capability): boolean {
    return this.capabilities.includes(capability);
  }

  /**
   * Ensure a capability is available, throw if not
   */
  protected ensureCapability(capability: Capability): void {
    if (!this.hasCapability(capability)) {
      throw new Error(
        `Provider ${this.providerType} does not support ${capability} capability`
      );
    }
  }
}

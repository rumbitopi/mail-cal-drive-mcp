/**
 * Shared type definitions for all providers.
 * These types are used across Microsoft, Google, and IMAP implementations.
 */

// ============================================
// Account Types
// ============================================

export type Provider = 'microsoft' | 'google' | 'imap';
export type Capability = 'mail' | 'calendar' | 'drive';

export interface Account {
  id: string;
  name: string;
  provider: Provider;
  email: string;
  capabilities: Capability[];
  connected: boolean;
  lastSync?: Date;
}

// ============================================
// Email Types
// ============================================

export interface EmailAddress {
  name?: string;
  email: string;
}

export interface EmailAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
}

export interface EmailAttachmentContent {
  id: string;
  name: string;
  contentType: string;
  size: number;
  content: string; // base64-encoded
}

export interface EmailMessage {
  id: string;
  accountId: string;
  threadId?: string;
  subject: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  replyTo?: EmailAddress;
  date: Date;
  receivedDate?: Date;
  snippet: string;
  body?: string;
  bodyHtml?: string;
  isRead: boolean;
  isStarred?: boolean;
  hasAttachments: boolean;
  attachments?: EmailAttachment[];
  folder: string;
  labels?: string[];
  headers?: Record<string, string>;
}

export interface EmailFolder {
  id: string;
  name: string;
  path: string;
  type?: 'inbox' | 'sent' | 'drafts' | 'trash' | 'spam' | 'archive' | 'custom';
  unreadCount: number;
  totalCount: number;
  parentId?: string;
  children?: EmailFolder[];
}

export interface EmailSearchCriteria {
  accountIds?: string[];
  folder?: string;
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  hasAttachment?: boolean;
  isRead?: boolean;
  isStarred?: boolean;
  before?: Date;
  after?: Date;
  labels?: string[];
  limit?: number;
  offset?: number;
}

export interface BulkMailAction {
  action: 'move' | 'delete' | 'markRead' | 'markUnread' | 'star' | 'unstar' | 'archive';
  criteria: EmailSearchCriteria;
  targetFolder?: string; // For move action
  dryRun?: boolean;
}

export interface BulkMailResult {
  success: boolean;
  affected: number;
  messageIds: string[];
  errors?: string[];
}

// ============================================
// Calendar Types
// ============================================

export interface Calendar {
  id: string;
  accountId: string;
  name: string;
  description?: string;
  color?: string;
  isDefault: boolean;
  isReadOnly: boolean;
  timeZone: string;
  canEdit: boolean;
  canShare: boolean;
}

export interface Attendee {
  email: string;
  name?: string;
  status: 'accepted' | 'declined' | 'tentative' | 'needsAction';
  isOrganizer: boolean;
  isOptional: boolean;
  comment?: string;
}

export interface RecurrenceRule {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  until?: Date;
  count?: number;
  byDay?: string[]; // 'MO', 'TU', 'WE', etc.
  byMonthDay?: number[];
  byMonth?: number[];
  bySetPos?: number[];
  weekStart?: string;
}

export interface Reminder {
  method: 'email' | 'popup' | 'sms';
  minutesBefore: number;
}

export interface CalendarEvent {
  id: string;
  accountId: string;
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  startTime: Date;
  endTime: Date;
  isAllDay: boolean;
  timeZone: string;
  recurrence?: RecurrenceRule;
  recurrenceId?: string; // For recurring event instances
  attendees?: Attendee[];
  organizer?: Attendee;
  status: 'confirmed' | 'tentative' | 'cancelled';
  visibility: 'public' | 'private' | 'confidential';
  reminders?: Reminder[];
  meetingLink?: string;
  conferenceData?: {
    type: 'teams' | 'meet' | 'zoom' | 'other';
    url: string;
    phone?: string;
  };
  attachments?: {
    name: string;
    url: string;
    mimeType?: string;
  }[];
  created: Date;
  updated: Date;
  iCalUID?: string;
}

export interface CreateEventInput {
  title: string;
  description?: string;
  location?: string;
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  isAllDay?: boolean;
  timeZone?: string;
  recurrence?: RecurrenceRule;
  attendees?: { email: string; optional?: boolean }[];
  reminders?: Reminder[];
  visibility?: 'public' | 'private';
  addConference?: boolean;
}

export interface UpdateEventInput extends Partial<CreateEventInput> {
  notifyAttendees?: boolean;
}

export interface FreeBusySlot {
  accountId: string;
  calendarId: string;
  start: Date;
  end: Date;
  status: 'free' | 'busy' | 'tentative' | 'outOfOffice' | 'workingElsewhere';
  eventTitle?: string; // If visible
}

export interface ConflictResult {
  hasConflict: boolean;
  conflicts: {
    event: CalendarEvent;
    overlapStart: Date;
    overlapEnd: Date;
  }[];
}

// ============================================
// Drive Types
// ============================================

export interface User {
  id?: string;
  email?: string;
  displayName?: string;
}

export interface DriveFile {
  id: string;
  accountId: string;
  name: string;
  mimeType: string;
  size: number;
  isFolder: boolean;
  parentId?: string;
  path?: string;
  webUrl?: string;
  downloadUrl?: string;
  thumbnailUrl?: string;
  createdAt: Date;
  modifiedAt: Date;
  createdBy?: User;
  modifiedBy?: User;
  shared: boolean;
  sharingInfo?: SharingInfo;
  description?: string;
  starred?: boolean;
  trashed?: boolean;
  version?: string;
  md5Checksum?: string;
}

export interface DriveFolder extends DriveFile {
  isFolder: true;
  childCount?: number;
}

export interface SharingInfo {
  isShared: boolean;
  sharedWith?: SharedUser[];
  shareLink?: ShareLink;
  owner?: User;
}

export interface SharedUser {
  id: string;
  email: string;
  displayName?: string;
  role: 'owner' | 'writer' | 'commenter' | 'reader';
  type: 'user' | 'group' | 'domain' | 'anyone';
}

export interface ShareLink {
  url: string;
  type: 'view' | 'edit' | 'comment';
  scope: 'anonymous' | 'organization' | 'specific';
  expiresAt?: Date;
  password?: boolean;
}

export interface StorageQuota {
  accountId: string;
  used: number; // bytes
  total: number; // bytes (-1 for unlimited)
  usedPercentage: number;
  trash?: number; // bytes in trash
  breakdown?: {
    drive?: number;
    mail?: number;
    photos?: number;
    other?: number;
  };
}

export interface FileUploadInput {
  name: string;
  content: Buffer | string; // Buffer or base64 string
  mimeType: string;
  folderId?: string;
  description?: string;
}

export interface ShareInput {
  type: 'user' | 'group' | 'anyone' | 'organization';
  email?: string; // Required for user/group
  role: 'reader' | 'commenter' | 'writer';
  sendNotification?: boolean;
  message?: string;
  expiresAt?: string; // ISO 8601
}

export interface FileSearchCriteria {
  query?: string; // Name contains
  fullText?: string; // Content search
  mimeType?: string; // Exact or prefix (e.g., 'image/')
  folderId?: string; // Search within folder
  includeTrash?: boolean;
  modifiedAfter?: string; // ISO 8601
  modifiedBefore?: string; // ISO 8601
  owner?: string; // Email
  sharedWithMe?: boolean;
  starred?: boolean;
  limit?: number;
  pageToken?: string;
}

export interface FileListResult {
  files: DriveFile[];
  nextPageToken?: string;
  totalCount?: number;
}

// ============================================
// Pagination Types
// ============================================

export interface PaginatedResult<T> {
  items: T[];
  nextPageToken?: string;
  totalCount?: number;
  hasMore: boolean;
}

// ============================================
// Error Types
// ============================================

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: Provider,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class AuthenticationError extends ProviderError {
  constructor(provider: Provider, message: string = 'Authentication failed') {
    super(message, provider, 'AUTH_FAILED', 401, false);
    this.name = 'AuthenticationError';
  }
}

export class RateLimitError extends ProviderError {
  constructor(
    provider: Provider,
    public readonly retryAfter?: number
  ) {
    super('Rate limit exceeded', provider, 'RATE_LIMIT', 429, true);
    this.name = 'RateLimitError';
  }
}

export class NotFoundError extends ProviderError {
  constructor(provider: Provider, resource: string) {
    super(`${resource} not found`, provider, 'NOT_FOUND', 404, false);
    this.name = 'NotFoundError';
  }
}

export class PermissionError extends ProviderError {
  constructor(provider: Provider, action: string) {
    super(`Permission denied: ${action}`, provider, 'PERMISSION_DENIED', 403, false);
    this.name = 'PermissionError';
  }
}

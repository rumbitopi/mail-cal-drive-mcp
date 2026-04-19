/**
 * Google Gmail provider.
 */

import { google, gmail_v1 } from 'googleapis';
import { Auth } from 'googleapis';
import { IMailProvider } from '../base.js';
import {
  EmailFolder,
  EmailMessage,
  EmailAddress,
  EmailAttachmentContent,
  EmailSearchCriteria,
  BulkMailAction,
  BulkMailResult,
  NotFoundError,
} from '../types.js';
import { logger } from '../../logger.js';

/**
 * Google Gmail provider implementation.
 */
export class GoogleMailProvider implements IMailProvider {
  readonly accountId: string;
  readonly capabilities = ['mail'] as const;
  private gmail: gmail_v1.Gmail;

  constructor(accountId: string, auth: Auth.OAuth2Client) {
    this.accountId = accountId;
    this.gmail = google.gmail({ version: 'v1', auth });
  }

  async listFolders(): Promise<EmailFolder[]> {
    const response = await this.gmail.users.labels.list({ userId: 'me' });
    const labels = response.data.labels || [];

    return labels.map((label) => this.mapLabel(label));
  }

  async listMessages(
    folder: string = 'INBOX',
    limit: number = 50,
    pageToken?: string
  ): Promise<{ messages: EmailMessage[]; nextPageToken?: string }> {
    const labelId = await this.resolveLabelId(folder);

    const response = await this.gmail.users.messages.list({
      userId: 'me',
      labelIds: [labelId],
      maxResults: limit,
      pageToken,
    });

    const messages = response.data.messages || [];

    // Fetch full message details
    const fullMessages = await Promise.all(
      messages.map((msg) =>
        this.gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date'],
        })
      )
    );

    return {
      messages: fullMessages.map((res) => this.mapMessage(res.data, folder)),
      nextPageToken: response.data.nextPageToken ?? undefined,
    };
  }

  async getMessage(messageId: string): Promise<EmailMessage> {
    const response = await this.gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    if (!response.data) {
      throw new NotFoundError('google', `Message ${messageId}`);
    }

    return this.mapMessage(response.data, 'INBOX', true);
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<EmailAttachmentContent> {
    // Get attachment content
    const response = await this.gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: attachmentId,
    });

    if (!response.data || !response.data.data) {
      throw new NotFoundError('google', `Attachment ${attachmentId}`);
    }

    // Get attachment metadata from the message
    const msg = await this.gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const part = msg.data.payload?.parts?.find(
      (p) => p.body?.attachmentId === attachmentId
    );

    // Gmail returns URL-safe base64 — convert to standard base64
    const urlSafeBase64 = response.data.data;
    const standardBase64 = urlSafeBase64.replace(/-/g, '+').replace(/_/g, '/');

    return {
      id: attachmentId,
      name: part?.filename || 'attachment',
      contentType: part?.mimeType || 'application/octet-stream',
      size: response.data.size || 0,
      content: standardBase64,
    };
  }

  async searchMessages(criteria: EmailSearchCriteria): Promise<EmailMessage[]> {
    const queryParts: string[] = [];

    if (criteria.from) queryParts.push(`from:${criteria.from}`);
    if (criteria.to) queryParts.push(`to:${criteria.to}`);
    if (criteria.subject) queryParts.push(`subject:${criteria.subject}`);
    if (criteria.body) queryParts.push(criteria.body);
    if (criteria.hasAttachment) queryParts.push('has:attachment');
    if (criteria.isRead === true) queryParts.push('is:read');
    if (criteria.isRead === false) queryParts.push('is:unread');
    if (criteria.isStarred) queryParts.push('is:starred');
    if (criteria.after) queryParts.push(`after:${this.formatDate(criteria.after)}`);
    if (criteria.before) queryParts.push(`before:${this.formatDate(criteria.before)}`);
    if (criteria.labels) {
      for (const label of criteria.labels) {
        queryParts.push(`label:${label}`);
      }
    }

    const response = await this.gmail.users.messages.list({
      userId: 'me',
      q: queryParts.join(' '),
      maxResults: criteria.limit || 50,
    });

    const messages = response.data.messages || [];

    // Fetch metadata for each message
    const fullMessages = await Promise.all(
      messages.map((msg) =>
        this.gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date'],
        })
      )
    );

    return fullMessages.map((res) => this.mapMessage(res.data, 'search'));
  }

  async moveMessage(messageId: string, toFolder: string): Promise<void> {
    const labelId = await this.resolveLabelId(toFolder);

    // Get current labels
    const msg = await this.gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'minimal',
    });

    const currentLabels = msg.data.labelIds || [];

    // Remove folder labels, add new one
    const removeLabels = currentLabels.filter((l) =>
      ['INBOX', 'SENT', 'DRAFT', 'TRASH', 'SPAM'].includes(l)
    );

    await this.gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: [labelId],
        removeLabelIds: removeLabels,
      },
    });

    logger.debug('Message moved', { messageId, toFolder });
  }

  async deleteMessage(messageId: string, permanent: boolean = false): Promise<void> {
    if (permanent) {
      await this.gmail.users.messages.delete({
        userId: 'me',
        id: messageId,
      });
    } else {
      await this.gmail.users.messages.trash({
        userId: 'me',
        id: messageId,
      });
    }

    logger.debug('Message deleted', { messageId, permanent });
  }

  async markRead(messageId: string, read: boolean): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: read ? [] : ['UNREAD'],
        removeLabelIds: read ? ['UNREAD'] : [],
      },
    });

    logger.debug('Message marked', { messageId, read });
  }

  async markStarred(messageId: string, starred: boolean): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: starred ? ['STARRED'] : [],
        removeLabelIds: starred ? [] : ['STARRED'],
      },
    });

    logger.debug('Message starred', { messageId, starred });
  }

  async bulkAction(action: BulkMailAction): Promise<BulkMailResult> {
    const messages = await this.searchMessages(action.criteria);
    const messageIds = messages.map((m) => m.id);

    if (action.dryRun) {
      return {
        success: true,
        affected: messageIds.length,
        messageIds,
      };
    }

    const errors: string[] = [];
    let affected = 0;

    for (const messageId of messageIds) {
      try {
        switch (action.action) {
          case 'move':
            if (!action.targetFolder) {
              throw new Error('targetFolder required for move action');
            }
            await this.moveMessage(messageId, action.targetFolder);
            break;
          case 'delete':
            await this.deleteMessage(messageId, false);
            break;
          case 'markRead':
            await this.markRead(messageId, true);
            break;
          case 'markUnread':
            await this.markRead(messageId, false);
            break;
          case 'star':
            await this.markStarred(messageId, true);
            break;
          case 'unstar':
            await this.markStarred(messageId, false);
            break;
          case 'archive':
            await this.gmail.users.messages.modify({
              userId: 'me',
              id: messageId,
              requestBody: {
                removeLabelIds: ['INBOX'],
              },
            });
            break;
        }
        affected++;
      } catch (error) {
        errors.push(
          `${messageId}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    const result: BulkMailResult = {
      success: errors.length === 0,
      affected,
      messageIds: messageIds.slice(0, affected),
    };
    if (errors.length > 0) {
      result.errors = errors;
    }
    return result;
  }

  /**
   * Resolve label name to ID.
   */
  private async resolveLabelId(labelName: string): Promise<string> {
    // System labels
    const systemLabels: Record<string, string> = {
      inbox: 'INBOX',
      sent: 'SENT',
      drafts: 'DRAFT',
      trash: 'TRASH',
      spam: 'SPAM',
      starred: 'STARRED',
      important: 'IMPORTANT',
      unread: 'UNREAD',
    };

    const normalized = labelName.toLowerCase();
    if (systemLabels[normalized]) {
      return systemLabels[normalized];
    }

    // If already a valid ID, return it
    if (labelName === labelName.toUpperCase() || labelName.startsWith('Label_')) {
      return labelName;
    }

    // Search for custom label
    const labels = await this.listFolders();
    const label = labels.find(
      (l) => l.name.toLowerCase() === normalized || l.id === labelName
    );

    if (!label) {
      throw new NotFoundError('google', `Label ${labelName}`);
    }

    return label.id;
  }

  /**
   * Format date for Gmail search.
   */
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0]!;
  }

  /**
   * Map Gmail label to EmailFolder.
   */
  private mapLabel(label: gmail_v1.Schema$Label): EmailFolder {
    return {
      id: label.id || '',
      name: label.name || '',
      path: label.name || '',
      type: this.mapLabelType(label.id),
      unreadCount: label.messagesUnread || 0,
      totalCount: label.messagesTotal || 0,
    };
  }

  /**
   * Map label ID to folder type.
   */
  private mapLabelType(
    id?: string | null
  ): 'inbox' | 'sent' | 'drafts' | 'trash' | 'spam' | 'archive' | 'custom' | undefined {
    switch (id) {
      case 'INBOX':
        return 'inbox';
      case 'SENT':
        return 'sent';
      case 'DRAFT':
        return 'drafts';
      case 'TRASH':
        return 'trash';
      case 'SPAM':
        return 'spam';
      default:
        return 'custom';
    }
  }

  /**
   * Map Gmail message to EmailMessage.
   */
  private mapMessage(
    msg: gmail_v1.Schema$Message,
    folder: string,
    includeBody: boolean = false
  ): EmailMessage {
    const headers = msg.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

    const labels = msg.labelIds || [];
    const isRead = !labels.includes('UNREAD');
    const isStarred = labels.includes('STARRED');

    const message: EmailMessage = {
      id: msg.id || '',
      accountId: this.accountId,
      threadId: msg.threadId ?? undefined,
      subject: getHeader('Subject') || '(No Subject)',
      from: this.parseEmailAddress(getHeader('From')),
      to: this.parseEmailAddresses(getHeader('To')),
      date: new Date(parseInt(msg.internalDate || '0', 10)),
      snippet: msg.snippet || '',
      isRead,
      hasAttachments:
        msg.payload?.parts?.some((p) => p.filename && p.filename.length > 0) || false,
      folder,
      labels: labels.filter((l) => !['UNREAD', 'STARRED'].includes(l)),
    };

    if (isStarred) message.isStarred = isStarred;

    const ccHeader = getHeader('Cc');
    if (ccHeader) message.cc = this.parseEmailAddresses(ccHeader);

    if (msg.threadId) message.threadId = msg.threadId;

    if (includeBody) {
      const body = this.extractBody(msg.payload);
      if (body.text) message.body = body.text;
      if (body.html) message.bodyHtml = body.html;

      if (msg.payload?.parts) {
        message.attachments = msg.payload.parts
          .filter((p) => p.filename && p.filename.length > 0)
          .map((p) => ({
            id: p.body?.attachmentId || '',
            name: p.filename || '',
            contentType: p.mimeType || 'application/octet-stream',
            size: p.body?.size || 0,
          }));
      }
    }

    return message;
  }

  /**
   * Parse email address string.
   */
  private parseEmailAddress(str: string): EmailAddress {
    const match = str.match(/^(.+?)\s*<(.+)>$/);
    if (match) {
      return { name: match[1]?.trim(), email: match[2]! };
    }
    return { email: str.trim() };
  }

  /**
   * Parse comma-separated email addresses.
   */
  private parseEmailAddresses(str: string): EmailAddress[] {
    if (!str) return [];
    return str.split(',').map((s) => this.parseEmailAddress(s.trim()));
  }

  /**
   * Extract body from message payload.
   */
  private extractBody(
    payload?: gmail_v1.Schema$MessagePart
  ): { text?: string; html?: string } {
    if (!payload) return {};

    const result: { text?: string; html?: string } = {};

    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      result.text = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    } else if (payload.mimeType === 'text/html' && payload.body?.data) {
      result.html = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    } else if (payload.parts) {
      for (const part of payload.parts) {
        const partBody = this.extractBody(part);
        if (partBody.text && !result.text) result.text = partBody.text;
        if (partBody.html && !result.html) result.html = partBody.html;
      }
    }

    return result;
  }
}

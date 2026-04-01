/**
 * IMAP mail provider using ImapFlow.
 */

import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail } from 'mailparser';
import { IMailProvider } from '../base.js';
import {
  EmailFolder,
  EmailMessage,
  EmailAddress,
  EmailSearchCriteria,
  BulkMailAction,
  BulkMailResult,
  NotFoundError,
} from '../types.js';
import { ImapCredentials } from '../../auth/types.js';
import { logger } from '../../logger.js';

/**
 * IMAP mail provider implementation.
 */
export class ImapMailProvider implements IMailProvider {
  readonly accountId: string;
  readonly capabilities = ['mail'] as const;
  private credentials: ImapCredentials;
  private client: ImapFlow | null = null;

  constructor(credentials: ImapCredentials) {
    this.accountId = credentials.accountId;
    this.credentials = credentials;
  }

  /**
   * Get or create IMAP client.
   */
  private async getClient(): Promise<ImapFlow> {
    if (this.client) {
      return this.client;
    }

    this.client = new ImapFlow({
      host: this.credentials.host,
      port: this.credentials.port,
      secure: this.credentials.tls,
      auth: {
        user: this.credentials.username,
        pass: this.credentials.password,
      },
      logger: false, // Disable built-in logging
    });

    await this.client.connect();
    logger.debug('IMAP connected', { accountId: this.accountId, host: this.credentials.host });

    return this.client;
  }

  /**
   * Disconnect IMAP client.
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.logout();
      this.client = null;
      logger.debug('IMAP disconnected', { accountId: this.accountId });
    }
  }

  async listFolders(): Promise<EmailFolder[]> {
    const client = await this.getClient();
    const mailboxes = await client.list();

    const folders: EmailFolder[] = [];

    for (const mb of mailboxes) {
      // Get message counts via STATUS command
      let totalCount = 0;
      let unreadCount = 0;
      try {
        const status = await client.status(mb.path, { messages: true, unseen: true });
        totalCount = status.messages || 0;
        unreadCount = status.unseen || 0;
      } catch {
        // Some folders may not support STATUS, use defaults
      }

      folders.push({
        id: mb.path,
        name: mb.name,
        path: mb.path,
        type: this.mapFolderType(mb.specialUse),
        unreadCount,
        totalCount,
        parentId: mb.parentPath,
      });
    }

    return folders;
  }

  async listMessages(
    folder: string = 'INBOX',
    limit: number = 50,
    pageToken?: string
  ): Promise<{ messages: EmailMessage[]; nextPageToken?: string }> {
    const client = await this.getClient();

    // For IMAP, pageToken is the offset (stored as string)
    const offset = pageToken ? parseInt(pageToken, 10) : 0;

    const lock = await client.getMailboxLock(folder);
    try {
      const messages: EmailMessage[] = [];

      // Get message count
      const status = await client.status(folder, { messages: true });
      const total = status.messages || 0;

      if (total === 0) return { messages: [] };

      // Calculate sequence numbers (IMAP is 1-based, newest first)
      const start = Math.max(1, total - offset - limit + 1);
      const end = Math.max(1, total - offset);

      if (start > end) return { messages: [] };

      // Fetch messages
      for await (const msg of client.fetch(`${start}:${end}`, {
        envelope: true,
        flags: true,
        bodyStructure: true,
      })) {
        messages.push(this.mapMessage(msg, folder));
      }

      // Reverse to get newest first
      messages.reverse();

      // Calculate next page token
      const nextOffset = offset + limit;
      const nextPageToken = nextOffset < total ? String(nextOffset) : undefined;

      return { messages, nextPageToken };
    } finally {
      lock.release();
    }
  }

  async getMessage(messageId: string): Promise<EmailMessage> {
    const client = await this.getClient();

    // messageId format: "folder:uid"
    const [folder, uidStr] = messageId.split(':');
    if (!folder || !uidStr) {
      throw new NotFoundError('imap', `Invalid message ID: ${messageId}`);
    }

    const uid = parseInt(uidStr, 10);
    const lock = await client.getMailboxLock(folder);

    try {
      // Fetch full message
      const msg = await client.fetchOne(uid.toString(), {
        envelope: true,
        flags: true,
        source: true,
      }, { uid: true });

      if (!msg || !msg.source) {
        throw new NotFoundError('imap', `Message ${messageId}`);
      }

      // Parse the full message
      const parsed = await simpleParser(msg.source);
      return this.mapFullMessage(msg, parsed, folder);
    } finally {
      lock.release();
    }
  }

  async searchMessages(criteria: EmailSearchCriteria): Promise<EmailMessage[]> {
    const client = await this.getClient();
    const folder = criteria.folder || 'INBOX';

    const lock = await client.getMailboxLock(folder);
    try {
      // Build IMAP search criteria
      const searchCriteria: any = {};

      if (criteria.from) searchCriteria.from = criteria.from;
      if (criteria.to) searchCriteria.to = criteria.to;
      if (criteria.subject) searchCriteria.subject = criteria.subject;
      if (criteria.body) searchCriteria.body = criteria.body;
      if (criteria.isRead === true) searchCriteria.seen = true;
      if (criteria.isRead === false) searchCriteria.unseen = true;
      if (criteria.after) searchCriteria.since = criteria.after;
      if (criteria.before) searchCriteria.before = criteria.before;

      // Search
      const searchResult = await client.search(searchCriteria, { uid: true });

      // search() can return false if no messages match
      if (!searchResult || !Array.isArray(searchResult) || searchResult.length === 0) {
        return [];
      }

      // Fetch messages (limited)
      const limit = criteria.limit || 50;
      const limitedUids = searchResult.slice(0, limit);

      const messages: EmailMessage[] = [];
      for await (const msg of client.fetch(limitedUids.join(','), {
        envelope: true,
        flags: true,
        bodyStructure: true,
      }, { uid: true })) {
        messages.push(this.mapMessage(msg, folder));
      }

      return messages;
    } finally {
      lock.release();
    }
  }

  async moveMessage(messageId: string, toFolder: string): Promise<void> {
    const client = await this.getClient();

    const [folder, uidStr] = messageId.split(':');
    if (!folder || !uidStr) {
      throw new Error(`Invalid message ID: ${messageId}`);
    }

    const lock = await client.getMailboxLock(folder);
    try {
      await client.messageMove(uidStr, toFolder, { uid: true });
      logger.debug('IMAP message moved', { messageId, toFolder });
    } finally {
      lock.release();
    }
  }

  async deleteMessage(messageId: string, permanent: boolean = false): Promise<void> {
    const client = await this.getClient();

    const [folder, uidStr] = messageId.split(':');
    if (!folder || !uidStr) {
      throw new Error(`Invalid message ID: ${messageId}`);
    }

    const lock = await client.getMailboxLock(folder);
    try {
      if (permanent) {
        await client.messageDelete(uidStr, { uid: true });
      } else {
        // Move to Trash
        await client.messageMove(uidStr, 'Trash', { uid: true });
      }
      logger.debug('IMAP message deleted', { messageId, permanent });
    } finally {
      lock.release();
    }
  }

  async markRead(messageId: string, read: boolean): Promise<void> {
    const client = await this.getClient();

    const [folder, uidStr] = messageId.split(':');
    if (!folder || !uidStr) {
      throw new Error(`Invalid message ID: ${messageId}`);
    }

    const lock = await client.getMailboxLock(folder);
    try {
      if (read) {
        await client.messageFlagsAdd(uidStr, ['\\Seen'], { uid: true });
      } else {
        await client.messageFlagsRemove(uidStr, ['\\Seen'], { uid: true });
      }
      logger.debug('IMAP message marked', { messageId, read });
    } finally {
      lock.release();
    }
  }

  async markStarred(messageId: string, starred: boolean): Promise<void> {
    const client = await this.getClient();

    const [folder, uidStr] = messageId.split(':');
    if (!folder || !uidStr) {
      throw new Error(`Invalid message ID: ${messageId}`);
    }

    const lock = await client.getMailboxLock(folder);
    try {
      if (starred) {
        await client.messageFlagsAdd(uidStr, ['\\Flagged'], { uid: true });
      } else {
        await client.messageFlagsRemove(uidStr, ['\\Flagged'], { uid: true });
      }
      logger.debug('IMAP message starred', { messageId, starred });
    } finally {
      lock.release();
    }
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
            await this.moveMessage(messageId, 'Archive');
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
   * Map folder special use to type.
   */
  private mapFolderType(
    specialUse?: string
  ): 'inbox' | 'sent' | 'drafts' | 'trash' | 'spam' | 'archive' | 'custom' | undefined {
    switch (specialUse) {
      case '\\Inbox':
        return 'inbox';
      case '\\Sent':
        return 'sent';
      case '\\Drafts':
        return 'drafts';
      case '\\Trash':
        return 'trash';
      case '\\Junk':
        return 'spam';
      case '\\Archive':
        return 'archive';
      default:
        return 'custom';
    }
  }

  /**
   * Map IMAP message to EmailMessage.
   */
  private mapMessage(msg: any, folder: string): EmailMessage {
    const envelope = msg.envelope || {};
    const flags = msg.flags || new Set();

    return {
      id: `${folder}:${msg.uid}`,
      accountId: this.accountId,
      subject: envelope.subject || '(No Subject)',
      from: this.mapAddress(envelope.from?.[0]),
      to: (envelope.to || []).map((a: any) => this.mapAddress(a)),
      cc: (envelope.cc || []).map((a: any) => this.mapAddress(a)),
      date: envelope.date || new Date(),
      snippet: '', // Would need to fetch body preview
      isRead: flags.has('\\Seen'),
      isStarred: flags.has('\\Flagged'),
      hasAttachments: this.hasAttachments(msg.bodyStructure),
      folder,
    };
  }

  /**
   * Map full IMAP message with body.
   */
  private mapFullMessage(msg: any, parsed: ParsedMail, folder: string): EmailMessage {
    const base = this.mapMessage(msg, folder);
    const result: EmailMessage = { ...base };

    if (parsed.text) result.body = parsed.text;
    if (parsed.html) result.bodyHtml = parsed.html;
    if (parsed.attachments && parsed.attachments.length > 0) {
      result.attachments = parsed.attachments.map((a) => ({
        id: a.contentId || a.checksum || '',
        name: a.filename || 'attachment',
        contentType: a.contentType,
        size: a.size,
      }));
    }

    return result;
  }

  /**
   * Map IMAP address to EmailAddress.
   */
  private mapAddress(addr: any): EmailAddress {
    if (!addr) return { email: '' };
    return {
      name: addr.name,
      email: addr.address || '',
    };
  }

  /**
   * Check if message has attachments.
   */
  private hasAttachments(bodyStructure: any): boolean {
    if (!bodyStructure) return false;
    if (bodyStructure.disposition === 'attachment') return true;
    if (bodyStructure.childNodes) {
      return bodyStructure.childNodes.some((n: any) => this.hasAttachments(n));
    }
    return false;
  }
}

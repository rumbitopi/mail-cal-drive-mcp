/**
 * Microsoft 365 Mail provider using Graph API.
 */

import { Client } from '@microsoft/microsoft-graph-client';
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
 * Microsoft Mail provider implementation.
 */
export class MicrosoftMailProvider implements IMailProvider {
  readonly accountId: string;
  readonly capabilities = ['mail'] as const;
  private client: Client;

  constructor(accountId: string, client: Client) {
    this.accountId = accountId;
    this.client = client;
  }

  async listFolders(): Promise<EmailFolder[]> {
    const response = await this.client
      .api('/me/mailFolders')
      .select('id,displayName,parentFolderId,unreadItemCount,totalItemCount')
      .top(100)
      .get();

    return response.value.map((folder: any) => this.mapFolder(folder));
  }

  async listMessages(
    folder: string = 'inbox',
    limit: number = 50,
    pageToken?: string
  ): Promise<{ messages: EmailMessage[]; nextPageToken?: string }> {
    const folderId = await this.resolveFolderId(folder);

    let request;
    if (pageToken) {
      // pageToken is the @odata.nextLink URL
      request = this.client.api(pageToken);
    } else {
      request = this.client
        .api(`/me/mailFolders/${folderId}/messages`)
        .select(
          'id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,isRead,hasAttachments,flag'
        )
        .top(limit)
        .orderby('receivedDateTime desc');
    }

    const response = await request.get();

    return {
      messages: response.value.map((msg: any) => this.mapMessage(msg, folder)),
      nextPageToken: response['@odata.nextLink'],
    };
  }

  async getMessage(messageId: string): Promise<EmailMessage> {
    const response = await this.client
      .api(`/me/messages/${messageId}`)
      .select(
        'id,subject,from,toRecipients,ccRecipients,bccRecipients,replyTo,receivedDateTime,bodyPreview,body,isRead,hasAttachments,attachments,flag,parentFolderId'
      )
      .expand('attachments')
      .get();

    if (!response) {
      throw new NotFoundError('microsoft', `Message ${messageId}`);
    }

    return this.mapMessage(response, response.parentFolderId, true);
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<EmailAttachmentContent> {
    // No $select — contentBytes only exists on the fileAttachment subtype,
    // not the base attachment type. Let Graph return all fields.
    const meta = await this.client
      .api(`/me/messages/${messageId}/attachments/${attachmentId}`)
      .get();

    if (!meta) {
      throw new NotFoundError('microsoft', `Attachment ${attachmentId}`);
    }

    return {
      id: meta.id,
      name: meta.name,
      contentType: meta.contentType,
      size: meta.size,
      content: meta.contentBytes, // Graph API returns base64 on fileAttachment
    };
  }

  async searchMessages(criteria: EmailSearchCriteria): Promise<EmailMessage[]> {
    const filters: string[] = [];

    if (criteria.from) {
      filters.push(`from/emailAddress/address eq '${criteria.from}'`);
    }
    if (criteria.subject) {
      filters.push(`contains(subject, '${criteria.subject}')`);
    }
    if (criteria.isRead !== undefined) {
      filters.push(`isRead eq ${criteria.isRead}`);
    }
    if (criteria.hasAttachment !== undefined) {
      filters.push(`hasAttachments eq ${criteria.hasAttachment}`);
    }
    if (criteria.after) {
      filters.push(`receivedDateTime ge ${criteria.after.toISOString()}`);
    }
    if (criteria.before) {
      filters.push(`receivedDateTime le ${criteria.before.toISOString()}`);
    }

    let request = this.client
      .api('/me/messages')
      .select(
        'id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,hasAttachments,parentFolderId'
      )
      .top(criteria.limit || 50)
      .orderby('receivedDateTime desc');

    if (filters.length > 0) {
      request = request.filter(filters.join(' and '));
    }

    // If body search is specified, use $search instead
    if (criteria.body) {
      request = this.client
        .api('/me/messages')
        .search(`"${criteria.body}"`)
        .select(
          'id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,hasAttachments,parentFolderId'
        )
        .top(criteria.limit || 50);
    }

    const response = await request.get();
    return response.value.map((msg: any) => this.mapMessage(msg, msg.parentFolderId));
  }

  async moveMessage(messageId: string, toFolder: string): Promise<void> {
    const folderId = await this.resolveFolderId(toFolder);

    await this.client.api(`/me/messages/${messageId}/move`).post({
      destinationId: folderId,
    });

    logger.debug('Message moved', { messageId, toFolder });
  }

  async deleteMessage(messageId: string, permanent: boolean = false): Promise<void> {
    if (permanent) {
      await this.client.api(`/me/messages/${messageId}`).delete();
    } else {
      // Move to deleted items
      await this.moveMessage(messageId, 'deleteditems');
    }

    logger.debug('Message deleted', { messageId, permanent });
  }

  async markRead(messageId: string, read: boolean): Promise<void> {
    await this.client.api(`/me/messages/${messageId}`).patch({
      isRead: read,
    });

    logger.debug('Message marked', { messageId, read });
  }

  async markStarred(messageId: string, starred: boolean): Promise<void> {
    await this.client.api(`/me/messages/${messageId}`).patch({
      flag: {
        flagStatus: starred ? 'flagged' : 'notFlagged',
      },
    });

    logger.debug('Message starred', { messageId, starred });
  }

  async bulkAction(action: BulkMailAction): Promise<BulkMailResult> {
    // Search for matching messages
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
            await this.moveMessage(messageId, 'archive');
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
   * Resolve folder name to ID.
   */
  private async resolveFolderId(folderName: string): Promise<string> {
    // Well-known folder names
    const wellKnown: Record<string, string> = {
      inbox: 'inbox',
      sent: 'sentitems',
      sentitems: 'sentitems',
      drafts: 'drafts',
      trash: 'deleteditems',
      deleteditems: 'deleteditems',
      junk: 'junkemail',
      junkemail: 'junkemail',
      spam: 'junkemail',
      archive: 'archive',
    };

    const normalized = folderName.toLowerCase();
    if (wellKnown[normalized]) {
      return wellKnown[normalized];
    }

    // Search for custom folder
    const folders = await this.listFolders();
    const folder = folders.find(
      (f) => f.name.toLowerCase() === normalized || f.id === folderName
    );

    if (!folder) {
      throw new NotFoundError('microsoft', `Folder ${folderName}`);
    }

    return folder.id;
  }

  /**
   * Map Graph API folder to EmailFolder.
   */
  private mapFolder(folder: any): EmailFolder {
    return {
      id: folder.id,
      name: folder.displayName,
      path: folder.displayName,
      unreadCount: folder.unreadItemCount || 0,
      totalCount: folder.totalItemCount || 0,
      parentId: folder.parentFolderId,
    };
  }

  /**
   * Map Graph API message to EmailMessage.
   */
  private mapMessage(msg: any, folder: string, includeBody: boolean = false): EmailMessage {
    return {
      id: msg.id,
      accountId: this.accountId,
      subject: msg.subject || '(No Subject)',
      from: this.mapEmailAddress(msg.from?.emailAddress),
      to: (msg.toRecipients || []).map((r: any) => this.mapEmailAddress(r.emailAddress)),
      cc: (msg.ccRecipients || []).map((r: any) => this.mapEmailAddress(r.emailAddress)),
      date: new Date(msg.receivedDateTime),
      snippet: msg.bodyPreview || '',
      body: includeBody ? msg.body?.content : undefined,
      bodyHtml: includeBody && msg.body?.contentType === 'html' ? msg.body?.content : undefined,
      isRead: msg.isRead || false,
      isStarred: msg.flag?.flagStatus === 'flagged',
      hasAttachments: msg.hasAttachments || false,
      attachments: msg.attachments?.map((a: any) => ({
        id: a.id,
        name: a.name,
        contentType: a.contentType,
        size: a.size,
      })),
      folder,
    };
  }

  /**
   * Map email address object.
   */
  private mapEmailAddress(addr: any): EmailAddress {
    return {
      email: addr?.address || '',
      name: addr?.name,
    };
  }
}

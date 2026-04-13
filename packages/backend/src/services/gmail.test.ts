import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock googleapis before importing gmail service
vi.mock('googleapis', () => {
  const mockGmailClient = {
    users: {
      labels: {
        list: vi.fn(),
      },
      history: {
        list: vi.fn(),
      },
      messages: {
        get: vi.fn(),
        modify: vi.fn(),
      },
    },
  };
  return {
    google: {
      gmail: vi.fn().mockReturnValue(mockGmailClient),
    },
  };
});

vi.mock('node:fs', () => ({
  promises: {
    readFile: vi.fn().mockResolvedValue(JSON.stringify({ access_token: 'fake' })),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    rm: vi.fn(),
  },
}));

vi.mock('google-auth-library', () => {
  return {
    OAuth2Client: vi.fn().mockImplementation(() => ({
      generateAuthUrl: vi.fn().mockReturnValue('http://auth-url'),
      getToken: vi.fn().mockResolvedValue({ tokens: { access_token: 'fake' } }),
      setCredentials: vi.fn(),
      credentials: { access_token: 'fake' },
      revokeCredentials: vi.fn(),
    })),
  };
});

import { google } from 'googleapis';
import { createGmailService } from './gmail.js';

function getGmailMock() {
  return (google.gmail as any)();
}

describe('GmailService — new adapter methods', () => {
  let service: ReturnType<typeof createGmailService>;
  let gmailMock: ReturnType<typeof getGmailMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createGmailService('id', 'secret', 'http://redirect');
    gmailMock = getGmailMock();
  });

  describe('listLabels', () => {
    it('returns mapped labels from API', async () => {
      gmailMock.users.labels.list.mockResolvedValue({
        data: {
          labels: [
            { id: 'INBOX', name: 'INBOX' },
            { id: 'Label_1', name: 'Work' },
          ],
        },
      });

      const labels = await service.listLabels();
      expect(labels).toEqual([
        { id: 'INBOX', name: 'INBOX' },
        { id: 'Label_1', name: 'Work' },
      ]);
      expect(gmailMock.users.labels.list).toHaveBeenCalledWith({ userId: 'me' });
    });

    it('returns empty array when no labels', async () => {
      gmailMock.users.labels.list.mockResolvedValue({ data: {} });
      const labels = await service.listLabels();
      expect(labels).toEqual([]);
    });
  });

  describe('listHistory', () => {
    it('returns mapped history records', async () => {
      gmailMock.users.history.list.mockResolvedValue({
        data: {
          history: [
            {
              id: '101',
              messagesAdded: [{ message: { id: 'msg1', threadId: 't1' } }],
              messagesDeleted: [],
            },
          ],
          historyId: '102',
        },
      });

      const result = await service.listHistory('100');
      expect(result.historyId).toBe('102');
      expect(result.expired).toBeFalsy();
      expect(result.history).toHaveLength(1);
      expect(result.history[0].messagesAdded).toEqual([{ id: 'msg1', threadId: 't1' }]);
      expect(gmailMock.users.history.list).toHaveBeenCalledWith(
        expect.objectContaining({ startHistoryId: '100' })
      );
    });

    it('returns expired=true on 404 error', async () => {
      const err: any = new Error('Not Found');
      err.code = 404;
      gmailMock.users.history.list.mockRejectedValue(err);

      const result = await service.listHistory('100');
      expect(result.expired).toBe(true);
      expect(result.history).toHaveLength(0);
    });

    it('rethrows non-404 errors', async () => {
      gmailMock.users.history.list.mockRejectedValue(new Error('Server Error'));
      await expect(service.listHistory('100')).rejects.toThrow('Server Error');
    });
  });

  describe('fetchMessagesById', () => {
    it('returns parsed Email from API', async () => {
      gmailMock.users.messages.get.mockResolvedValue({
        data: {
          id: 'msg1',
          threadId: 't1',
          internalDate: '1700000000000',
          snippet: 'test',
          labelIds: ['INBOX'],
          payload: {
            headers: [
              { name: 'Subject', value: 'Test Subject' },
              { name: 'From', value: 'sender@example.com' },
            ],
            mimeType: 'text/plain',
            body: { data: Buffer.from('Hello World').toString('base64') },
          },
        },
      });

      const email = await service.fetchMessagesById('msg1');
      expect(email).not.toBeNull();
      expect(email?.id).toBe('msg1');
      expect(email?.subject).toBe('Test Subject');
      expect(email?.from).toBe('sender@example.com');
    });

    it('returns null on 404 error', async () => {
      const err: any = new Error('Not Found');
      err.code = 404;
      gmailMock.users.messages.get.mockRejectedValue(err);

      const email = await service.fetchMessagesById('missing');
      expect(email).toBeNull();
    });
  });

  describe('markRead', () => {
    it('calls messages.modify with removeLabelIds UNREAD', async () => {
      gmailMock.users.messages.modify.mockResolvedValue({ data: {} });
      await service.markRead('msg1');
      expect(gmailMock.users.messages.modify).toHaveBeenCalledWith({
        userId: 'me',
        id: 'msg1',
        requestBody: { removeLabelIds: ['UNREAD'] },
      });
    });
  });

  describe('markUnread', () => {
    it('calls messages.modify with addLabelIds UNREAD', async () => {
      gmailMock.users.messages.modify.mockResolvedValue({ data: {} });
      await service.markUnread('msg1');
      expect(gmailMock.users.messages.modify).toHaveBeenCalledWith({
        userId: 'me',
        id: 'msg1',
        requestBody: { addLabelIds: ['UNREAD'] },
      });
    });
  });

  describe('getRawMessage', () => {
    it('returns raw message data from API', async () => {
      const fakeData = { id: 'msg1', payload: { headers: [] }, labelIds: ['INBOX'] };
      gmailMock.users.messages.get.mockResolvedValue({ data: fakeData });

      const raw = await service.getRawMessage('msg1');
      expect(raw).toEqual(fakeData);
    });

    it('returns null on 404', async () => {
      const err: any = new Error('Not Found');
      err.code = 404;
      gmailMock.users.messages.get.mockRejectedValue(err);

      const raw = await service.getRawMessage('missing');
      expect(raw).toBeNull();
    });
  });
});

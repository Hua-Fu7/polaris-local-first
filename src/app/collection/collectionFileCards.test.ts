import { describe, expect, it } from 'vitest';
import type { Conversation } from '../../types/domain';
import { buildCollectionFileCards } from './collectionFileCards';

describe('buildCollectionFileCards', () => {
  it('derives non-image attachments into sorted collection file cards and respects collaborator scope and search', () => {
    const conversations: Conversation[] = [
      {
        id: 'c-1',
        title: '读设定文件',
        collaboratorId: 'pharos',
        pinnedAt: null,
        updatedAt: 10,
        messages: [
          {
            id: 'm-1',
            role: 'user',
            content: '看看这个',
            timestamp: 100,
            attachments: [
              {
                id: 'a-1',
                assetId: 'asset-file-1',
                kind: 'file',
                name: 'world-rule.md',
                mimeType: 'text/markdown',
                size: 128,
                textContent: '# room rule'
              },
              {
                id: 'a-2',
                assetId: 'asset-image-1',
                kind: 'image',
                name: 'cover.png',
                mimeType: 'image/png',
                size: 64
              }
            ]
          }
        ]
      },
      {
        id: 'c-2',
        title: '别的协作者',
        collaboratorId: 'nova',
        pinnedAt: null,
        updatedAt: 20,
        messages: [
          {
            id: 'm-2',
            role: 'user',
            content: 'zip',
            timestamp: 200,
            attachments: [
              {
                id: 'a-3',
                assetId: 'asset-file-2',
                kind: 'file',
                name: 'pack.zip',
                mimeType: 'application/zip',
                size: 512
              }
            ]
          }
        ]
      }
    ];

    const scoped = buildCollectionFileCards({
      conversations,
      collaboratorScopeId: 'pharos',
      searchTerm: ''
    });

    expect(scoped).toHaveLength(1);
    expect(scoped[0]).toMatchObject({
      id: 'm-1:a-1',
      conversationId: 'c-1',
      messageId: 'm-1',
      name: 'world-rule.md'
    });

    const searched = buildCollectionFileCards({
      conversations,
      collaboratorScopeId: null,
      searchTerm: 'zip'
    });

    expect(searched).toHaveLength(1);
    expect(searched[0]?.name).toBe('pack.zip');
  });
  it('skips voice message audio so mp3 clips never show up as attachments', () => {
    const conversations: Conversation[] = [
      {
        id: 'c-voice',
        title: '语音',
        collaboratorId: 'pharos',
        pinnedAt: null,
        updatedAt: 30,
        messages: [
          {
            id: 'm-voice',
            role: 'assistant',
            content: '',
            timestamp: 300,
            attachments: [
              {
                id: 'a-voice',
                assetId: 'asset-voice-1',
                kind: 'file',
                name: 'Polaris-voice-20261028.mp3',
                mimeType: 'audio/mpeg',
                size: 2048
              },
              {
                id: 'a-doc',
                assetId: 'asset-doc-1',
                kind: 'file',
                name: '报告.pdf',
                mimeType: 'application/pdf',
                size: 4096
              }
            ]
          }
        ]
      }
    ];

    const cards = buildCollectionFileCards({ conversations, searchTerm: '' });

    expect(cards.map((card) => card.name)).toEqual(['报告.pdf']);
  });
});

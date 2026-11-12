import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { isCompanionCollaboratorId } from '../../../engines/companion';
import { useI18n } from '../../../i18n';
import { usePersonaStore } from '../../../stores/personaStore';
import { useSpaceFrontstageBindings } from '../../../stores/spaceStoreFrontstageBindings';
import type { CollectionShelf, Persona } from '../../../types/domain';
import { CollaboratorSigil } from '../../collaborator/CollaboratorSigil';
import { CreateActionSheet } from '../../create/CreateActionSheet';
import { Icon, type IconName } from '../../Icon';
import { runSelectionAction } from '../../haptics';
import { CollaboratorCreatePicker } from '../../worlds/chat/collaborator/CollaboratorCreatePicker';
import { collectionRelativeDateLabel } from '../collectionUtils';
import { buildVisibleCollectionShelfNavItems } from './collectionShelfNav';

const SHELF_ICON_BY_ID = {
  dialogue: 'navDialogue',
  code: 'archiveBox',
  project: 'navWorkspace',
  image: 'heart',
  info: 'navInfo'
} satisfies Record<CollectionShelf, IconName>;

const MAX_DRAWER_CONVERSATIONS = 40;

export type CollaboratorScopeConversation = {
  id: string;
  title: string;
  updatedAt: number;
  pinnedAt: number | null;
};

type CollaboratorScopeStripProps = {
  open: boolean;
  personas: Persona[];
  conversationCounts: {
    byCollaboratorId: Record<string, number>;
    total: number;
  };
  collaboratorScopeId: string | null;
  collectionShelf: CollectionShelf;
  conversations: CollaboratorScopeConversation[];
  activeConversationId: string | null;
  editingConversationId: string | null;
  conversationTitleDraft: string;
  onConversationTitleDraftChange: (value: string) => void;
  onStartConversationRename: (conversationId: string, title: string) => void;
  onCommitConversationRename: (conversationId: string) => void;
  onCancelConversationRename: () => void;
  onConversationPinToggle: (conversationId: string) => void;
  onConversationDelete: (conversationId: string, title: string) => void;
  onSelectShelf: (shelf: CollectionShelf) => void;
  onOpenConversation: (conversationId: string) => void;
  onOpenGroupWorld: () => void;
  onClose: () => void;
  onCreateFromBuilder: () => void;
  onCreateCustomCollaborator: () => void;
  onOpenCalendar: () => void;
  onOpenHeatmap: () => void;
  onOpenSettings: () => void;
  onOpenCollaboratorPage: (collaboratorId: string) => void;
};

export function CollaboratorScopeStrip({
  open,
  personas,
  conversationCounts,
  collaboratorScopeId,
  collectionShelf,
  conversations,
  activeConversationId,
  editingConversationId,
  conversationTitleDraft,
  onConversationTitleDraftChange,
  onStartConversationRename,
  onCommitConversationRename,
  onCancelConversationRename,
  onConversationPinToggle,
  onConversationDelete,
  onSelectShelf,
  onOpenConversation,
  onOpenGroupWorld,
  onClose,
  onOpenCalendar,
  onOpenHeatmap,
  onCreateFromBuilder,
  onCreateCustomCollaborator,
  onOpenSettings,
  onOpenCollaboratorPage
}: CollaboratorScopeStripProps) {
  const { t, language, formatNumber } = useI18n();
  const frontstage = useSpaceFrontstageBindings();
  const setActiveCollaborator = usePersonaStore((state) => state.setActiveCollaborator);
  const [createPickerOpen, setCreatePickerOpen] = useState(false);
  const [editingOpen, setEditingOpen] = useState(false);
  const [allCollaboratorsOpen, setAllCollaboratorsOpen] = useState(false);

  const navItems = useMemo(
    () => buildVisibleCollectionShelfNavItems({ dialogue: false, info: false }, t),
    [t]
  );
  const visibleConversations = useMemo(() => {
    const sorted = [...conversations].sort((a, b) => {
      const aPinned = a.pinnedAt ?? 0;
      const bPinned = b.pinnedAt ?? 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      return b.updatedAt - a.updatedAt;
    });
    return sorted.slice(0, MAX_DRAWER_CONVERSATIONS);
  }, [conversations]);

  useEffect(() => {
    if (open) return;
    setCreatePickerOpen(false);
    setAllCollaboratorsOpen(false);
  }, [open]);

  if (!open) return null;

  const portalRoot = typeof document !== 'undefined'
    ? document.querySelector<HTMLElement>('.app-shell')
    : null;

  const formatSegmentCount = (count: number) => t('collection.scope.segmentCount', { count: formatNumber(count) });
  const currentCollaborator = collaboratorScopeId
    ? personas.find((persona) => persona.id === collaboratorScopeId) ?? null
    : null;

  const handleSelectDrawerCollaborator = (collaboratorId: string) => {
    frontstage.setFrontstageCollaboratorId(collaboratorId);
    frontstage.setEditingCollaboratorId(collaboratorId);
    if (!isCompanionCollaboratorId(collaboratorId)) {
      setActiveCollaborator(collaboratorId);
    }
    setCreatePickerOpen(false);
  };

  const handleOpenCollaboratorPage = (collaboratorId: string) => {
    frontstage.setFrontstageCollaboratorId(collaboratorId);
    frontstage.setEditingCollaboratorId(collaboratorId);
    if (!isCompanionCollaboratorId(collaboratorId)) {
      setActiveCollaborator(collaboratorId);
    }
    setCreatePickerOpen(false);
    onOpenCollaboratorPage(collaboratorId);
  };

  const rootView = (
    <>
      <div className="collaborator-scope-drawer-head">
        <div className="collaborator-scope-drawer-head-copy">
          <span>{t('collection.drawer.title')}</span>
        </div>
        <div className="collaborator-scope-drawer-actions">
          <button
            type="button"
            className={`collaborator-scope-drawer-edit ${editingOpen ? 'active' : ''}`}
            onClick={(event) => {
              runSelectionAction(() => {
                setCreatePickerOpen(false);
                setEditingOpen((current) => !current);
              }, { element: event.currentTarget });
            }}
          >
            {editingOpen ? t('collection.scope.done') : t('collection.scope.edit')}
          </button>
          <button
            type="button"
            className="collaborator-scope-drawer-settings"
            onClick={(event) => {
              runSelectionAction(() => {
                setCreatePickerOpen(false);
                setEditingOpen(false);
                onOpenSettings();
                onClose();
              }, { element: event.currentTarget });
            }}
          >
            <Icon name="settings" size={14} />
            <span>{t('collection.scope.settings')}</span>
          </button>
        </div>
      </div>

      <div className="collaborator-scope-drawer-list" aria-label={t('collection.drawer.title')}>
        <div className={`collaborator-scope-create-shell ${createPickerOpen ? 'collaborator-scope-create-shell--open' : ''}`}>
          <button
            type="button"
            className="collaborator-scope-compact-row"
            onClick={(event) => {
              runSelectionAction(() => {
                setEditingOpen(false);
                setCreatePickerOpen((current) => !current);
              }, { element: event.currentTarget });
            }}
            aria-expanded={createPickerOpen}
            aria-label={t('collection.scope.createCollaborator')}
          >
            <span className="collaborator-scope-compact-icon" aria-hidden="true">
              <Icon name="personaCreate" size={18} />
            </span>
            <span className="collaborator-scope-compact-label">{t('collection.scope.createCollaborator')}</span>
            <span className={`collaborator-scope-compact-chevron ${createPickerOpen ? 'is-open' : ''}`} aria-hidden="true">
              <Icon name="chevron" size={15} />
            </span>
          </button>
          <CreateActionSheet
            open={createPickerOpen}
            ariaLabel={t('collection.scope.createCollaborator')}
            className="collaborator-create-action-sheet"
            onClose={() => setCreatePickerOpen(false)}
          >
            <CollaboratorCreatePicker
              showCloseButton={false}
              onCloseCreatePicker={() => setCreatePickerOpen(false)}
              onCreateFromBuilder={() => {
                setCreatePickerOpen(false);
                onCreateFromBuilder();
                onClose();
              }}
              onCreateCustomCollaborator={() => {
                setCreatePickerOpen(false);
                onCreateCustomCollaborator();
                onClose();
              }}
            />
          </CreateActionSheet>
        </div>

        <button
          type="button"
          className="collaborator-scope-compact-row"
          onClick={(event) => {
            runSelectionAction(() => {
              setCreatePickerOpen(false);
              onOpenGroupWorld();
              onClose();
            }, { element: event.currentTarget });
          }}
        >
          <span className="collaborator-scope-compact-icon" aria-hidden="true">
            <Icon name="navGroup" size={18} />
          </span>
          <span className="collaborator-scope-compact-label">{t('collection.scope.groupChat')}</span>
          <span className="collaborator-scope-compact-chevron" aria-hidden="true">
            <Icon name="chevron" size={15} />
          </span>
        </button>

        <button
          type="button"
          className="collaborator-scope-compact-row"
          onClick={(event) => {
            runSelectionAction(() => {
              setCreatePickerOpen(false);
              setAllCollaboratorsOpen((current) => !current);
            }, { element: event.currentTarget });
          }}
          aria-expanded={allCollaboratorsOpen}
        >
          <span className="collaborator-scope-compact-icon" aria-hidden="true">
            <Icon name="persona" size={18} />
          </span>
          <span className="collaborator-scope-compact-label">{t('collection.scope.allCollaborators')}</span>
          <span className={`collaborator-scope-compact-chevron ${allCollaboratorsOpen ? 'is-open' : ''}`} aria-hidden="true">
            <Icon name="chevron" size={15} />
          </span>
        </button>

        {allCollaboratorsOpen ? (
          <div className="collaborator-scope-collaborator-list">
            {personas.map((persona) => {
              const conversationCount = conversationCounts.byCollaboratorId[persona.id] ?? 0;
              return (
                <div className="collaborator-scope-collaborator-shell" key={persona.id}>
                  <button
                    type="button"
                    className={`collaborator-scope-collaborator-row ${collaboratorScopeId === persona.id ? 'is-active' : ''}`}
                    onClick={(event) => {
                      runSelectionAction(() => handleSelectDrawerCollaborator(persona.id), { element: event.currentTarget });
                    }}
                  >
                    <span className="collaborator-scope-collaborator-mark" aria-hidden="true">
                      <CollaboratorSigil seed={persona.id} size={13} />
                    </span>
                    <span className="collaborator-scope-collaborator-name">{persona.name}</span>
                    <span className="collaborator-scope-collaborator-count">{formatSegmentCount(conversationCount)}</span>
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="collaborator-scope-nav-section">
        {currentCollaborator ? (
          <button
            type="button"
            className="collaborator-scope-current-row"
            onClick={(event) => {
              runSelectionAction(() => handleOpenCollaboratorPage(currentCollaborator.id), { element: event.currentTarget });
            }}
          >
            <span className="collaborator-scope-compact-icon" aria-hidden="true">
              <Icon name="persona" size={18} />
            </span>
            <span className="collaborator-scope-compact-label">{currentCollaborator.name}</span>
            <span className="collaborator-scope-compact-chevron" aria-hidden="true">
              <Icon name="chevron" size={15} />
            </span>
          </button>
        ) : null}

          {navItems.map((item) => {
            const active = collectionShelf === item.shelf;
            return (
              <button
                key={item.shelf}
                type="button"
                className={`collaborator-scope-nav-row ${active ? 'is-active' : ''}`}
                onClick={(event) => {
                  runSelectionAction(() => {
                    setCreatePickerOpen(false);
                    onSelectShelf(item.shelf);
                    onClose();
                  }, { element: event.currentTarget });
                }}
              >
                <span className="collaborator-scope-compact-icon" aria-hidden="true">
                  <Icon name={SHELF_ICON_BY_ID[item.shelf]} size={18} />
                </span>
                <span className="collaborator-scope-compact-label">{item.label}</span>
                <span className="collaborator-scope-compact-chevron" aria-hidden="true">
                  <Icon name="chevron" size={15} />
                </span>
              </button>
            );
          })}
          <button
            type="button"
            className="collaborator-scope-nav-row"
            onClick={(event) => {
              runSelectionAction(() => {
                setCreatePickerOpen(false);
                onOpenCalendar();
                onClose();
              }, { element: event.currentTarget });
            }}
          >
            <span className="collaborator-scope-compact-icon" aria-hidden="true">
              <Icon name="navCalendar" size={18} />
            </span>
            <span className="collaborator-scope-compact-label">日历</span>
            <span className="collaborator-scope-compact-chevron" aria-hidden="true">
              <Icon name="chevron" size={15} />
            </span>
          </button>
        {/* 给以后要加的东西留一格空，别挤在一起 */}
        <div className="collaborator-scope-drawer-gap" aria-hidden="true" />

        </div>

        <div className="collaborator-scope-chat-section">
          <p className="collaborator-scope-chat-label">{t('collection.drawer.conversations')}</p>
          <div className="collaborator-scope-chat-list">
            {visibleConversations.length === 0 ? (
              <p className="collaborator-scope-chat-empty">{t('collection.drawer.empty')}</p>
            ) : visibleConversations.map((conversation) => {
              const active = conversation.id === activeConversationId;
              const renaming = editingConversationId === conversation.id;
              if (!editingOpen) {
                return (
                  <button
                    key={conversation.id}
                    type="button"
                    className={`collaborator-scope-chat-row ${active ? 'is-active' : ''}`}
                    onClick={() => {
                      onOpenConversation(conversation.id);
                      onClose();
                    }}
                  >
                    <span className="collaborator-scope-chat-date">
                      {conversation.pinnedAt
                        ? t('common.pinned')
                        : collectionRelativeDateLabel(conversation.updatedAt, language)}
                    </span>
                    <span className="collaborator-scope-chat-title">{conversation.title}</span>
                  </button>
                );
              }

              return (
                <div key={conversation.id} className={`collaborator-scope-chat-row collaborator-scope-chat-row--editing ${active ? 'is-active' : ''}`}>
                  {renaming ? (
                    <div className="collaborator-scope-chat-rename">
                      <input
                        value={conversationTitleDraft}
                        onChange={(event) => onConversationTitleDraftChange(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') onCommitConversationRename(conversation.id);
                          if (event.key === 'Escape') onCancelConversationRename();
                        }}
                        autoFocus
                        aria-label={t('collection.dialogue.renameAria')}
                      />
                      <button type="button" onClick={() => onCommitConversationRename(conversation.id)} aria-label={t('collection.dialogue.saveRename')}>
                        <Icon name="check" size={14} />
                      </button>
                      <button type="button" onClick={onCancelConversationRename} aria-label={t('collection.dialogue.cancelRename')}>
                        <Icon name="x" size={14} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="collaborator-scope-chat-date">
                        {conversation.pinnedAt
                          ? t('common.pinned')
                          : collectionRelativeDateLabel(conversation.updatedAt, language)}
                      </span>
                      <span className="collaborator-scope-chat-title">{conversation.title}</span>
                      <div className="collaborator-scope-chat-actions">
                        <button type="button" onClick={() => onStartConversationRename(conversation.id, conversation.title)} aria-label={t('collection.dialogue.rename')}>
                          <Icon name="edit" size={14} />
                        </button>
                        <button type="button" className={conversation.pinnedAt ? 'is-active' : ''} onClick={() => onConversationPinToggle(conversation.id)} aria-label={conversation.pinnedAt ? t('collection.dialogue.unpin') : t('collection.dialogue.pin')}>
                          <Icon name="pin" size={14} />
                        </button>
                        <button type="button" onClick={() => onConversationDelete(conversation.id, conversation.title)} aria-label={t('collection.dialogue.delete')}>
                          <Icon name="trash" size={14} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );

  const drawer = (
    <section className="collaborator-scope-drawer collaborator-scope-drawer--open" aria-label={t('collection.scope.drawerAria')}>
      <button
        type="button"
        className="collaborator-scope-drawer-scrim"
        aria-label={t('collection.scope.closeDrawerAria')}
        onClick={(event) => {
          runSelectionAction(() => {
            setCreatePickerOpen(false);
            onClose();
          }, { element: event.currentTarget });
        }}
      />

      <aside className="collaborator-scope-drawer-panel" role="dialog" aria-modal="false" aria-label={t('collection.scope.dialogAria')}>
        {rootView}
      </aside>
    </section>
  );

  return portalRoot ? createPortal(drawer, portalRoot) : drawer;
}
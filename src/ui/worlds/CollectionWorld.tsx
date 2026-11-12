import { useEffect, useMemo, useState } from 'react';
import { runSelectionAction } from '../haptics';
import { useCollectionWorldController } from '../../app/collection/useCollectionWorldController';
import { CollaboratorScopeStrip } from '../collection/grid/CollaboratorScopeStrip';
import { COLLECTION_CREATE_EVENT } from '../../app/shell/collectionCreateCommands';
import { buildVisibleCollectionShelfNavItems } from '../collection/grid/collectionShelfNav';
import { DialogueCollectionShelf } from '../collection/grid/DialogueCollectionShelf';
import { CollaboratorInfoShelf } from '../collection/info/CollaboratorInfoShelf';
import { XinchaoPanel } from '../xinchao/XinchaoPanel';
import { CalendarWorld } from '../calendar/CalendarWorld';
import { HeatmapWorld } from '../heatmap/HeatmapWorld';
import { CodeProjectCollectionShelfPages } from './collection/CodeProjectCollectionShelfPages';
import { useI18n } from '../../i18n';

type CollectionWorldProps = {
  searchOpen: boolean;
  collaboratorSwitchOpen: boolean;
  onCollaboratorSwitchOpenChange: (open: boolean) => void;
  onOpenSettings: () => void;
  onDeleteCollaborator: (collaboratorId: string) => void;
  infoFullscreenOpen: boolean;
  onInfoFullscreenOpenChange: (open: boolean) => void;
  onDetailOpenChange: (open: boolean) => void;
  onOpenCollaboratorBuilderForCreate: () => void;
  onCreateCustomCollaborator: () => void;
  onOpenProviderSettings: () => void;
  onOpenDesktopLocalSettings: () => void;
  onCollectionDrawerNavigate: () => void;
};

export function CollectionWorld({
  searchOpen,
  collaboratorSwitchOpen,
  onCollaboratorSwitchOpenChange,
  onOpenSettings,
  onDeleteCollaborator,
  infoFullscreenOpen,
  onInfoFullscreenOpenChange,
  onDetailOpenChange,
  onOpenCollaboratorBuilderForCreate,
  onCreateCustomCollaborator,
  onOpenProviderSettings,
  onOpenDesktopLocalSettings,
  onCollectionDrawerNavigate
}: CollectionWorldProps) {
  const { t } = useI18n();
  const controller = useCollectionWorldController({
    confirm: (message) => window.confirm(message),
    alert: (message) => window.alert(message),
    downloadFile: (blob, fileName) => {
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      window.URL.revokeObjectURL(url);
    }
  });
  const collaboratorInfoShelfLabel = controller.currentCollaborator?.name.trim() || t('common.collaborator');
  const visibleShelfItems = useMemo(
    () =>
      buildVisibleCollectionShelfNavItems(
        {
          dialogue: true,
          info: true,
          code: true,
          project: true,
          image: true
        },
        t
      ).map((item) => {
        if (item.shelf === 'info') return { ...item, label: collaboratorInfoShelfLabel };
        if (item.shelf === 'image') return { ...item, label: '心潮' };
        return item;
      }),
    [collaboratorInfoShelfLabel, t]
  );
  const visibleShelfSet = useMemo(
    () => new Set(visibleShelfItems.map((item) => item.shelf)),
    [visibleShelfItems]
  );
  const [floatingActionHost, setFloatingActionHost] = useState<HTMLDivElement | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [heatmapOpen, setHeatmapOpen] = useState(false);
  const activeShelf = controller.collectionShelf;
  const setCollectionShelf = controller.setCollectionShelf;
  useEffect(() => {
    if (visibleShelfSet.has(activeShelf)) return;
    setCollectionShelf(visibleShelfItems[0]?.shelf ?? 'dialogue');
  }, [activeShelf, setCollectionShelf, visibleShelfItems, visibleShelfSet]);

  useEffect(() => {
    onDetailOpenChange(controller.collectionShelf === 'code' && controller.codeWorkshopOpen);
  }, [controller.codeWorkshopOpen, controller.collectionShelf, onDetailOpenChange]);

  useEffect(() => () => onDetailOpenChange(false), [onDetailOpenChange]);

  useEffect(() => {
    if (infoFullscreenOpen) {
      onInfoFullscreenOpenChange(false);
    }
  }, [infoFullscreenOpen, onInfoFullscreenOpenChange]);

  return (
    <section className={`world world-collection ${controller.collectionShelf === 'code' && controller.codeWorkshopOpen ? 'collection-world-workshop-open' : ''}`}>
      <CollaboratorScopeStrip
        open={collaboratorSwitchOpen}
        personas={controller.personas}
        conversationCounts={controller.collaboratorConversationCounts}
        collaboratorScopeId={controller.collaboratorScopeId}
        collectionShelf={controller.collectionShelf}
        conversations={controller.filteredConversations}
        activeConversationId={controller.activeConversationId}
        editingConversationId={controller.editingConversationId}
        conversationTitleDraft={controller.conversationTitleDraft}
        onConversationTitleDraftChange={controller.onConversationTitleDraftChange}
        onStartConversationRename={controller.onStartConversationRename}
        onCommitConversationRename={controller.onCommitConversationRename}
        onCancelConversationRename={controller.onCancelConversationRename}
        onConversationPinToggle={controller.onConversationPinToggle}
        onConversationDelete={controller.onConversationDelete}
        onSelectShelf={(shelf) => {
          onCollectionDrawerNavigate();
          setCalendarOpen(false);
          setHeatmapOpen(false);
          controller.setCollectionShelf(shelf);
        }}
        onOpenConversation={(conversationId) => {
          onCollectionDrawerNavigate();
          controller.onOpenConversation(conversationId);
        }}
        onOpenGroupWorld={() => {
          onCollectionDrawerNavigate();
          controller.onOpenGroupWorld();
        }}
        onOpenCalendar={() => {
          onCollectionDrawerNavigate();
          setHeatmapOpen(false);
          setCalendarOpen(true);
        }}
        onOpenHeatmap={() => {
          onCollectionDrawerNavigate();
          setCalendarOpen(false);
          setHeatmapOpen(true);
        }}

        onClose={() => onCollaboratorSwitchOpenChange(false)}
        onCreateFromBuilder={() => {
          onCollectionDrawerNavigate();
          onOpenCollaboratorBuilderForCreate();
        }}
        onCreateCustomCollaborator={() => {
          onCollectionDrawerNavigate();
          onCreateCustomCollaborator();
        }}
        onOpenSettings={() => {
          onOpenSettings();
        }}
        onOpenCollaboratorPage={() => {
          onCollectionDrawerNavigate();
          onCollaboratorSwitchOpenChange(false);
          setCalendarOpen(false);
          controller.setCollectionShelf('info');
        }}
      />

      <div className={`surface-motion-local-stage collection-shelf-stage ${searchOpen ? 'collection-shelf-stage--controls-open' : ''}`}>
        {searchOpen && controller.collectionShelf !== 'info' ? (
          <div className="collection-shelf-controls">
              <div className="search-wrap">
                <input
                  className="search-input"
                  value={controller.searchTerm}
                  onChange={(event) => controller.setSearchTerm(event.target.value)}
                  placeholder={
                    controller.collectionShelf === 'code'
                      ? t('collection.world.searchCode')
                      : controller.collectionShelf === 'project'
                        ? t('collection.world.searchProject')
                        : controller.collectionShelf === 'image'
                          ? t('collection.world.searchImage')
                          : t('collection.world.searchDialogue')
                  }
                />
                {controller.collectionShelf === 'code' && controller.codeSearchTagSuggestions.length > 0 ? (
                  <div className="collection-search-suggestions" aria-label={t('collection.world.searchSuggestionsAria')}>
                    {controller.codeSearchTagSuggestions.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className="chip collection-search-suggestion"
                        onClick={(event) => {
                          runSelectionAction(() => controller.setSearchTerm(tag), { element: event.currentTarget });
                        }}
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
          </div>
        ) : null}

        {!controller.ready ? (
          <div className="empty-state-floating collection-loading-state">
            <p className="empty-state-title">{t('collection.world.loadingRooms')}</p>
          </div>
        ) : (
          <div
            className="collection-shelf-rail"
            aria-label={t('collection.world.roomViewAria')}
          >
            {visibleShelfSet.has('info') && activeShelf === 'info' ? (
            <div
              className="collection-shelf-page collection-shelf-page--info collection-shelf-page--active"
              data-shelf-page="info"
            >
              <div className="collection-shelf-page-body collection-shelf-page-body--info">
                <CollaboratorInfoShelf
                  isAggregateScope={controller.isAggregateScope}
                  currentCollaboratorId={controller.currentCollaboratorId}
                  currentCollaborator={controller.currentCollaborator}
                  fullscreenOpen={false}
                  showChatAvatars={controller.showChatAvatars}
                  providers={controller.providers}
                  activeProviderId={controller.activeProviderId}
                  conversations={controller.conversations}
                  triggerRules={controller.triggerRules}
                  mcpServers={controller.mcpServers}
                  mcpToolTimeoutSeconds={controller.mcpToolTimeoutSeconds}
                  collaboratorOverviewItems={controller.collaboratorOverviewItems}
                  editing={searchOpen}
                  onUpdateCollaborator={controller.onUpdateCurrentCollaborator}
                  onSelectCollaborator={controller.onSelectCollaboratorScope}
          
                  onDeleteCollaborator={onDeleteCollaborator}
                  onSelectCollaboratorAvatar={controller.onSelectCurrentCollaboratorAvatar}
                  onToggleCollaboratorPinned={controller.onCollaboratorPinToggle}
                  onCreateFromBuilder={onOpenCollaboratorBuilderForCreate}
                  onCreateCustomCollaborator={onCreateCustomCollaborator}
                  onOpenProviderSettings={onOpenProviderSettings}
                  onCreateTriggerRule={controller.onCreateAutomationRule}
                  onUpdateTriggerRule={controller.onUpdateAutomationRule}
                  onDeleteTriggerRule={controller.onDeleteAutomationRule}
                  onTestTriggerRule={controller.onTestAutomationRule}
                  onCopyTriggerUrl={controller.onCopyAutomationTriggerUrl}
                  onCreateMcpServer={controller.onCreateMcpServer}
                  onUpdateMcpServer={controller.onUpdateMcpServer}
                />
              </div>
            </div>
            ) : null}

            {visibleShelfSet.has('dialogue') && activeShelf === 'dialogue' ? (
            <div
              className="collection-shelf-page collection-shelf-page--dialogue collection-shelf-page--active"
              data-shelf-page="dialogue"
            >
              <div className="collection-shelf-page-body">
                <DialogueCollectionShelf
                  cardsExpanded={searchOpen}
                  conversations={controller.filteredConversations}
                  conversationMessageSearchIndex={controller.conversationMessageSearchIndex}
                  personas={controller.personas}
                  roomProjects={controller.roomProjects}
                  activeConversationId={controller.activeConversationId}
                  editingConversationId={controller.editingConversationId}
                  conversationTitleDraft={controller.conversationTitleDraft}
                  exportingConversationArchive={controller.exportingConversationArchive}
                  onConversationTitleDraftChange={controller.onConversationTitleDraftChange}
                  onStartConversationRename={controller.onStartConversationRename}
                  onCommitConversationRename={controller.onCommitConversationRename}
                  onCancelConversationRename={controller.onCancelConversationRename}
                  onConversationPinToggle={controller.onConversationPinToggle}
                  onConversationDelete={controller.onConversationDelete}
                  onOpenConversation={controller.onOpenConversation}
                  onOpenConversationMessage={controller.onOpenConversationMessage}
                  onExportConversationArchive={controller.onExportConversationArchive}
                />
              </div>
            </div>
            ) : null}

            {(activeShelf === 'code' || activeShelf === 'project') && visibleShelfSet.has(activeShelf) ? (
              <CodeProjectCollectionShelfPages
                activeShelf={activeShelf}
                searchOpen={searchOpen}
                searchTerm={controller.searchTerm}
                onWorkshopOpenChange={controller.setCodeWorkshopOpen}
                onOpenCardsShelf={() => controller.setCollectionShelf('code')}
                onOpenDesktopLocalSettings={onOpenDesktopLocalSettings}
              />
            ) : null}

            {visibleShelfSet.has('image') && activeShelf === 'image' ? (
            <div
              className="collection-shelf-page collection-shelf-page--xinchao collection-shelf-page--active"
              data-shelf-page="xinchao"
            >
              <div className="collection-shelf-page-body collection-shelf-page-body--xinchao">
                <XinchaoPanel
                  collaboratorId={controller.currentCollaboratorId}
                  collaboratorName={controller.currentCollaborator?.name ?? ''}
                />
              </div>
            </div>
            ) : null}
          </div>
        )}
        <div ref={setFloatingActionHost} className="collection-floating-action-host" />
      </div>
      <CalendarWorld
        open={calendarOpen}
        collaboratorId={controller.currentCollaboratorId ?? 'default'}
        collaboratorName={controller.currentCollaborator?.name ?? ''}
        onClose={() => setCalendarOpen(false)}
      />
      <HeatmapWorld
        open={heatmapOpen}
        collaboratorName={controller.currentCollaborator?.name ?? ''}
        conversations={controller.scopedConversations}
        onClose={() => setHeatmapOpen(false)}
      />
    </section>
  );
}

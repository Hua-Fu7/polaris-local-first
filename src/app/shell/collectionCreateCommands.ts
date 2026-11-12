export const COLLECTION_CREATE_EVENT = 'polaris:collection-create';

export type CollectionCreateCommand = 'project' | 'code' | 'image' | 'dialogue';

export function requestCollectionCreate(command: CollectionCreateCommand) {
  window.dispatchEvent(new CustomEvent(COLLECTION_CREATE_EVENT, {
    detail: { command }
  }));
}
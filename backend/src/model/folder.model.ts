import type { FolderTree, ServiceTypeFolderNode, ServiceTypeFolderRow, ServiceTypeRow } from '@service-center/shared';

/**
 * Builds the folder tree. The database already refuses cycles; a folder whose
 * parent is missing from the input (e.g. archived and filtered out) is shown
 * at the top level rather than dropped, so nothing becomes unreachable.
 */
export const buildFolderTree = (
  folders: readonly ServiceTypeFolderRow[],
  serviceTypes: ReadonlyArray<Pick<ServiceTypeRow, 'id' | 'folder_id'>>,
  landingFolderId: string | null,
): FolderTree => {
  const nodes = new Map<string, ServiceTypeFolderNode>(
    folders.map((folder) => [folder.id, { ...folder, children: [], service_type_ids: [] }]),
  );
  const unfiled: string[] = [];
  for (const type of serviceTypes) {
    const node = type.folder_id ? nodes.get(type.folder_id) : undefined;
    if (node) node.service_type_ids.push(type.id);
    else unfiled.push(type.id);
  }

  const roots: ServiceTypeFolderNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const order = (list: ServiceTypeFolderNode[]): ServiceTypeFolderNode[] =>
    list
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      .map((node) => ({ ...node, children: order(node.children) }));

  return {
    folders: order(roots),
    unfiled_service_type_ids: unfiled,
    landing_folder_id: landingFolderId && nodes.has(landingFolderId) ? landingFolderId : null,
  };
};

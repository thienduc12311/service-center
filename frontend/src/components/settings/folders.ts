import type { ServiceTypeFolderNode } from '@service-center/shared';

/** One folder in a flattened tree, with how deep it sits (for indented pickers). */
export interface FlatFolder {
  node: ServiceTypeFolderNode;
  depth: number;
}

/** Every folder with its depth, for pickers. */
export const flattenFolders = (nodes: ServiceTypeFolderNode[], depth = 0): FlatFolder[] =>
  nodes.flatMap((node) => [{ node, depth }, ...flattenFolders(node.children, depth + 1)]);

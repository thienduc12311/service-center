// Metro needs to be told about the workspace root so it watches
// packages/shared and resolves hoisted dependencies.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;
// @service-center/shared is ESM with an "exports" map.
config.resolver.unstable_enablePackageExports = true;

module.exports = config;

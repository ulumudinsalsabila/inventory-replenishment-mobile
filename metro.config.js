const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// pnpm virtual store lives outside the project (see .npmrc virtual-store-dir),
// so packages that import undeclared deps (e.g. standard-navigation -> react)
// can't find them by walking up. Always fall back to the project's node_modules.
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  ...(config.resolver.nodeModulesPaths ?? []),
];

module.exports = config;

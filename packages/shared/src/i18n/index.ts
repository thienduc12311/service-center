/**
 * Shared internationalization contracts: the language registry, pure
 * resolution and formatting, catalogs, validation and the preference
 * lifecycle. No React, browser storage or native APIs live here — each
 * client wraps these in its own adapter (`frontend/src/i18n`,
 * `mobile/src/i18n`); the server uses `translatorFor`.
 */
export * from './locales.js';
export * from './resolve-locale.js';
export * from './format.js';
export * from './resources.js';
export * from './types.js';
export * from './engine.js';
export * from './validate.js';
export * from './errors.js';
export * from './preference-controller.js';
export * from './structured-text.js';

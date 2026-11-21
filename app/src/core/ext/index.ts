import { registerBuiltins } from './builtin';
import { PluginRegistry } from './registry';

export * from './semver';
export * from './version';
export * from './types';
export * from './manifest';
export * from './i18n';
export * from './plural-expr';
export * from './declarative';
export * from './registry';
export * from './builtin';
export * from './zipread';
export * from './package';
export * from './store';
export * from './sources';
export * from './host';
export * from './strings';

/** The plugins of the application. The built-in ones are in it from the start; the installed ones are added when the application starts (see `ui/ext.ts`). */
export const plugins = new PluginRegistry();
registerBuiltins(plugins);

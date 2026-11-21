import { setPluginQaRules } from '../qarules';
import { registerBuiltins } from './builtin';
import { declarativeRules } from './declqa';
import { i18n } from './i18n';
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
export * from './commands';
export * from './declqa';
export * from './glossaries';
export * from './catalog';

/** The plugins of the application. The built-in ones are in it from the start; the installed ones are added when the application starts (see `ui/ext.ts`). */
export const plugins = new PluginRegistry();
registerBuiltins(plugins);

/** The rules of QA that plugins bring are the application's rules while the plugin works (and in the language of the interface). */
const syncQaRules = (): void => setPluginQaRules(declarativeRules(plugins.list()));
plugins.subscribe(syncQaRules);
i18n.onChange(syncQaRules);
syncQaRules();

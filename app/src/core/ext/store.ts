import type { PluginSource } from './registry';
import type { PluginManifest, PluginPermission } from './types';

/** A plugin as it is kept between sessions: the package (as text) and what the user decided about it. */
export interface StoredPlugin {
  id: string;
  manifest: PluginManifest;
  manifestText: string;
  files: Record<string, string>;
  /** The user's switch. A plugin with code is installed switched off until the user has agreed to what it asks for. */
  enabled: boolean;
  /** The permissions the user gave (a subset of the manifest's `permissions`). */
  grants: PluginPermission[];
  source: PluginSource;
  installedAt: number;
  updatedAt: number;
}

/** Where installed plugins are kept. The browser build keeps them in IndexedDB (`ui/ext-store.ts`); tests keep them in memory. */
export interface PluginStore {
  all(): Promise<StoredPlugin[]>;
  put(p: StoredPlugin): Promise<void>;
  remove(id: string): Promise<void>;
}

export class MemoryPluginStore implements PluginStore {
  private m = new Map<string, StoredPlugin>();
  async all(): Promise<StoredPlugin[]> { return [...this.m.values()].map(p => structuredClone(p)); }
  async put(p: StoredPlugin): Promise<void> { this.m.set(p.id, structuredClone(p)); }
  async remove(id: string): Promise<void> { this.m.delete(id); }
}

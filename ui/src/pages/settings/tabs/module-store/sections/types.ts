import type { CatalogModule } from './moduleCatalog';

export interface ModuleStoreNode {
  node_id: string;
  checked_at: number;
  nginx_version: string;
  architecture: string;
  fresh: boolean;
  installable: boolean;
  error: string;
  modules: Array<{ name: string; available: boolean; loaded: boolean; source: string }>;
  job_id: number;
  job_action: string;
  job_state: string;
  job_message: string;
  job_logs?: string;
}

export type DependencyNode = ModuleStoreNode;


export function checkIsModuleLoaded(mod: CatalogModule, nodeModules?: Array<{ name: string; loaded: boolean }>): boolean {
  if (!nodeModules) return false;
  return nodeModules.some((m) => {
    if (!m.loaded) return false;
    if (m.name === mod.id || m.name === mod.packageName) return true;
    if (mod.aliases && mod.aliases.includes(m.name)) return true;
    return false;
  });
}

export function getModuleEvidence(
  mod: CatalogModule,
  nodeModules?: Array<{ name: string; loaded: boolean; source: string }>
): string | undefined {
  if (!nodeModules) return undefined;
  const match = nodeModules.find((m) => {
    if (m.name === mod.id || m.name === mod.packageName) return true;
    if (mod.aliases && mod.aliases.includes(m.name)) return true;
    return false;
  });
  return match?.source;
}

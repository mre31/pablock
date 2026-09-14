import { invoke } from '@tauri-apps/api/core';
export interface Status { initialized: boolean; unlocked: boolean; data_dir: string }
export interface Project { id: string; name: string; root: string; created_at: string; updated_at: string }
export interface Profile { id: string; project_id: string; path: string; name: string; kind: 'secret' | 'template' }
export interface Variable { key: string; has_value: boolean; updated_at: string }
export interface Version { id: string; key: string; action: string; source: string; created_at: string; has_value: boolean; current: boolean }
export interface Diff { added: string[]; changed: string[]; removed: string[]; unchanged: string[] }
export interface Preview { path: string; kind: 'secret' | 'template'; diff: Diff; warnings: string[] }
export interface Comparison { template: string; missing: string[]; extra: string[] }
type Requests = {
  status: { args: object; result: Status }; init: { args: { password: string }; result: null }; unlock: { args: { password: string }; result: null }; lock: { args: object; result: null };
  password: { args: { current: string; new: string }; result: null };
  projects: { args: object; result: Project[] }; add_project: { args: { path: string; name?: string }; result: Project };
  rename_project: { args: { project: string; name: string }; result: null }; remove_project: { args: { project: string }; result: null };
  scan: { args: { project: string }; result: Profile[] }; profiles: { args: { project: string }; result: Profile[] };
  rename_profile: { args: { profile: string; name: string }; result: null }; remove_profile: { args: { profile: string }; result: null };
  variables: { args: { profile: string }; result: Variable[] }; templates: { args: { profile: string }; result: Comparison[] };
  reveal: { args: { profile: string; key: string; version?: string }; result: string };
  set: { args: { profile: string; key: string; value: string }; result: null }; remove_secret: { args: { profile: string; key: string }; result: null };
  history: { args: { profile: string; key: string }; result: Version[] }; restore: { args: { profile: string; key: string; version: string }; result: null };
  delete_version: { args: { profile: string; key: string; version: string }; result: null }; clear_history: { args: { profile: string; key: string }; result: null };
  preview_import: { args: { project: string; files: string[]; replace: boolean }; result: Preview[] }; import: { args: { project: string; files: string[]; replace: boolean }; result: Preview[] };
  diff: { args: { profile: string; target?: string }; result: Diff }; export: { args: { profile: string; target?: string; overwrite: boolean }; result: Diff };
};
export function api<K extends keyof Requests>(op: K, args: Requests[K]['args']): Promise<Requests[K]['result']> { return invoke('vault_request', { request: { op, ...args } }); }
export function errorMessage(e: unknown): string { return e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e); }

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
  discover: { args: { project: string }; result: Profile[] };
  register_profiles: { args: { project: string; paths: string[] }; result: Profile[] };
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
export function api<K extends keyof Requests>(op: K, args: Requests[K]['args']): Promise<Requests[K]['result']> {
  const isTest =
    typeof globalThis !== 'undefined' &&
    Boolean(
      (globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env?.NODE_ENV === 'test' ||
      (typeof navigator !== 'undefined' && navigator.userAgent?.includes('jsdom'))
    );

  if (import.meta.env.DEV && !isTest && typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window) && new URLSearchParams(window.location.search).has('demo')) {
    return mockBrowserApi(op, args);
  }

  return invoke('vault_request', { request: { op, ...args } });
}

export function errorMessage(e: unknown): string {
  return e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e);
}

// In-browser mock store for web preview when not running inside Tauri
const demoProjects: Project[] = [
  { id: 'proj-fitness', name: 'fitness-monorepo', root: '/work/fitness-monorepo', created_at: '', updated_at: '' },
  { id: 'proj-pablock', name: 'pablock', root: '/home/mre/Projects/pablock', created_at: '', updated_at: '' },
  { id: 'proj-trackiett', name: 'trackiett', root: '/work/trackiett', created_at: '', updated_at: '' },
];

const demoProfiles: Record<string, Profile[]> = {
  'proj-pablock': [
    { id: 'prof-api', project_id: 'proj-pablock', path: 'apps/api/.env.production', name: 'apps/api/.env.production', kind: 'secret' },
    { id: 'prof-web', project_id: 'proj-pablock', path: 'apps/web/.env.local', name: 'apps/web/.env.local', kind: 'secret' },
    { id: 'prof-mobile', project_id: 'proj-pablock', path: 'apps/mobile/.env', name: 'apps/mobile/.env', kind: 'secret' },
    { id: 'prof-example', project_id: 'proj-pablock', path: '.env.example', name: '.env.example', kind: 'template' },
  ],
  'proj-fitness': [
    { id: 'prof-fit', project_id: 'proj-fitness', path: '.env', name: '.env', kind: 'secret' },
  ],
  'proj-trackiett': [
    { id: 'prof-track', project_id: 'proj-trackiett', path: '.env', name: '.env', kind: 'secret' },
  ],
};

const demoSecrets: Record<string, string> = {
  API_URL: 'https://api.pablock.dev/v1',
  JWT_SECRET: 'pab_sec_99f2a08c5826f1da4e',
  DATABASE_URL: 'postgresql://postgres:pablock_sec_pass_db@aws-0-eu.pooler.supabase.com:6543/postgres',
  RESEND_API_KEY: 're_8B2nQ7vX_92mK1pLsA3wZ6e',
  SENTRY_DSN: 'https://8a7f29b@o4501.ingest.sentry.io/4508',
  REDIS_URL: 'rediss://default:Ab821c9a_pass_key@eu-central.upstash.io:6379',
};

const demoVariables: Variable[] = [
  { key: 'API_URL', has_value: true, updated_at: '2024-10-24T14:32:00Z' },
  { key: 'JWT_SECRET', has_value: true, updated_at: '2024-10-24T11:03:00Z' },
  { key: 'DATABASE_URL', has_value: true, updated_at: '2024-10-23T09:17:00Z' },
  { key: 'RESEND_API_KEY', has_value: true, updated_at: '2024-10-22T16:45:00Z' },
  { key: 'SENTRY_DSN', has_value: true, updated_at: '2024-10-21T10:12:00Z' },
  { key: 'REDIS_URL', has_value: true, updated_at: '2024-10-20T18:30:00Z' },
];

let isUnlocked = true;

async function mockBrowserApi<K extends keyof Requests>(op: K, args: Requests[K]['args']): Promise<Requests[K]['result']> {
  const req = args as Record<string, unknown>;
  switch (op) {
    case 'status':
      return { initialized: true, unlocked: isUnlocked, data_dir: '/home/mre/.local/share/pablock' } as Requests[K]['result'];
    case 'unlock':
    case 'init':
      isUnlocked = true;
      return null as Requests[K]['result'];
    case 'lock':
      isUnlocked = false;
      return null as Requests[K]['result'];
    case 'projects':
      return [...demoProjects] as Requests[K]['result'];
    case 'profiles': {
      const proj = req.project as string;
      return (demoProfiles[proj] ?? []) as Requests[K]['result'];
    }
    case 'discover':
    case 'register_profiles':
    case 'scan': {
      const proj = req.project as string;
      return (demoProfiles[proj] ?? []) as Requests[K]['result'];
    }
    case 'variables':
      return [...demoVariables] as Requests[K]['result'];
    case 'reveal': {
      const key = req.key as string;
      return (demoSecrets[key] || 'sample_secret_key_value_example') as Requests[K]['result'];
    }
    case 'set': {
      const key = req.key as string;
      const value = req.value as string;
      demoSecrets[key] = value;
      const existing = demoVariables.find(v => v.key === key);
      if (existing) {
        existing.updated_at = new Date().toISOString();
      } else {
        demoVariables.unshift({ key, has_value: true, updated_at: new Date().toISOString() });
      }
      return null as Requests[K]['result'];
    }
    case 'remove_secret': {
      const key = req.key as string;
      const idx = demoVariables.findIndex(v => v.key === key);
      if (idx !== -1) {
        demoVariables.splice(idx, 1);
      }
      return null as Requests[K]['result'];
    }
    case 'preview_import':
    case 'import': {
      return [] as Requests[K]['result'];
    }
    default:
      return null as Requests[K]['result'];
  }
}

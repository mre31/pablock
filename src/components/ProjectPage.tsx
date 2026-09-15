import { useState, useImperativeHandle, forwardRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Pencil, Trash2, History, ScanLine, GitCompare, ChevronDown, FileText, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api, type Profile, type Variable, type Version, type Comparison } from '../api';
import { Confirm, date, ErrorNotice, Modal, Rename } from './common';
import { ImportDialog, ExportDialog } from './Transfer';
import { CypherSecret } from './CypherSecret';
import { ScanDialog } from './ScanDialog';

export interface ProjectPageHandle {
  scan: () => Promise<void>;
  openImport: () => void;
  openExport: () => void;
  selectedProfile?: Profile;
}

interface ProjectPageProps {
  filter?: string;
  onNotice?: (msg: string) => void;
  onError?: (err: unknown) => void;
}

export const ProjectPage = forwardRef<ProjectPageHandle, ProjectPageProps>(function ProjectPage(
  { filter = '', onNotice, onError },
  ref
) {
  const { projectId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const client = useQueryClient();

  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api('projects', {}) });
  const project = projects.data?.find(p => p.id === projectId);

  const profiles = useQuery({
    queryKey: ['profiles', projectId],
    queryFn: () => api('profiles', { project: projectId }),
    enabled: !!projectId,
  });

  const selected = profiles.data?.find(p => p.id === params.get('profile')) ?? profiles.data?.[0];

  const [dialog, setDialog] = useState<
    | { type: 'add' }
    | { type: 'edit'; variable: Variable }
    | { type: 'remove'; variable: Variable }
    | { type: 'history'; variable: string }
    | { type: 'import' }
    | { type: 'export' }
    | { type: 'rename' }
    | { type: 'delete_profile' }
    | null
  >(null);

  const [scanProfiles, setScanProfiles] = useState<Profile[] | null>(null);
  const [localError, setLocalError] = useState<unknown>();
  const [scanning, setScanning] = useState(false);

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['profiles', projectId] });
    await client.invalidateQueries({ queryKey: ['variables'] });
    await client.invalidateQueries({ queryKey: ['templates'] });
  };

  const handleScan = async () => {
    setScanning(true);
    setLocalError(undefined);
    try {
      const found = await api('discover', { project: projectId });
      setScanProfiles(found);
    } catch (e) {
      setLocalError(e);
      if (onError) onError(e);
    } finally {
      setScanning(false);
    }
  };

  const handleConfirmScan = async (selectedPaths: string[], importKeys: boolean) => {
    if (importKeys && selectedPaths.length > 0) {
      await api('import', { project: projectId, files: selectedPaths, replace: false });
    } else {
      await api('register_profiles', { project: projectId, paths: selectedPaths });
    }
    const msg = `Scan complete. ${selectedPaths.length} profiles registered.`;
    if (onNotice) onNotice(msg);
    await refresh();
    if (selectedPaths.length > 0 && !params.get('profile')) {
      const registered = await api('profiles', { project: projectId });
      const matched = registered.find(p => selectedPaths.includes(p.path));
      if (matched) {
        setParams({ profile: matched.id });
      }
    }
    setScanProfiles(null);
  };

  useImperativeHandle(ref, () => ({
    scan: handleScan,
    openImport: () => setDialog({ type: 'import' }),
    openExport: () => { if (selected?.kind === 'secret') setDialog({ type: 'export' }); else setLocalError('Select a secret profile to export values.'); },
    selectedProfile: selected,
  }));

  const variablesQuery = useQuery({
    queryKey: ['variables', selected?.id],
    queryFn: () => api('variables', { profile: selected!.id }),
    enabled: !!selected?.id,
  });

  const comparisons = useQuery({queryKey:['templates',selected?.id], queryFn:()=>api('templates',{profile:selected!.id}), enabled:selected?.kind==='secret'});
  useEffect(() => { setDialog(null); setScanProfiles(null); setLocalError(undefined); }, [projectId, selected?.id]);

  if (projects.isPending) return <div className="loading">Loading project…</div>;
  if (!project) {
    return (
      <div className="empty">
        <ErrorNotice error={projects.error ?? 'Project not found'} />
        <Link to="/" className="primary">Back to projects</Link>
      </div>
    );
  }

  const allVariables = variablesQuery.data ?? [];
  const filteredVariables = allVariables.filter(v =>
    v.key.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <>
      <ErrorNotice error={localError ?? profiles.error ?? variablesQuery.error} />

      {/* Profile Header Area */}
      <section className="profile-header-area">
        <div className="profile-info">
          <h1 className="profile-title">{selected ? selected.name : project.name}</h1>
          <p className="profile-breadcrumb">
            {project.name} / {selected ? selected.path : project.root}
          </p>
        </div>

        <div className="profile-meta-pills">
          {selected && <><span className="badge">{selected.kind}</span><button className="icon-tool-btn" aria-label="Rename profile" onClick={()=>setDialog({type:'rename'})}><Pencil size={15}/></button><button className="icon-tool-btn" aria-label="Delete profile" onClick={()=>setDialog({type:'delete_profile'})}><Trash2 size={15}/></button></>}
          <span className="pill-variable-count">
            {allVariables.length} variables
          </span>
        </div>
      </section>

      {/* Variables Panel */}
      <section className="variables-panel">
        <div className="variables-panel-header">
          <h2 className="variables-heading">Variables</h2>
          {selected && selected.kind === 'secret' && (
            <button
              className="add-variable-btn"
              type="button"
              onClick={() => setDialog({ type: 'add' })}
            >
              <Plus size={15} />
              <span>Add variable</span>
            </button>
          )}
        </div>

        <div className="table-wrapper">
          {profiles.data && profiles.data.length === 0 ? (
            <div className="empty">
              <h2>Find your environments</h2>
              <p>Scan the project to discover dotenv files, including files excluded by .gitignore.</p>
              <button
                className="primary"
                type="button"
                disabled={scanning}
                onClick={handleScan}
              >
                <ScanLine size={15} />
                <span>{scanning ? 'Scanning…' : 'Scan project'}</span>
              </button>
            </div>
          ) : !selected ? (
            <div className="empty">
              <p>Select an environment from the sidebar.</p>
            </div>
          ) : (
            <table className="env-table">
              <thead>
                <tr>
                  <th className="col-head th-key">Key</th>
                  <th className="col-head th-value">Value</th>
                  <th className="col-head th-modified">Last modified</th>
                  <th className="col-head th-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredVariables.map(v => (
                  <tr className="table-row" key={`${selected.id}:${v.key}:${v.updated_at}`}>
                    <td className="cell-key font-mono">{v.key}</td>
                    <td className="cell-value">
                      <CypherSecret
                        profileId={selected.id}
                        variableKey={v.key}
                        hasValue={v.has_value}
                        isTemplate={selected.kind === 'template'}
                      />
                    </td>
                    <td className="cell-modified">{date(v.updated_at)}</td>
                    <td className="cell-actions">
                      {selected.kind === 'secret' && (
                        <>
                          <button
                            className="icon-tool-btn"
                            type="button"
                            title="Edit"
                            aria-label={`Edit ${v.key}`}
                            onClick={() => setDialog({ type: 'edit', variable: v })}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            className="icon-tool-btn"
                            type="button"
                            title="Delete"
                            aria-label={`Delete ${v.key}`}
                            onClick={() => setDialog({ type: 'remove', variable: v })}
                          >
                            <Trash2 size={15} />
                          </button>
                          <button
                            className="icon-tool-btn"
                            type="button"
                            title="History"
                            aria-label={`History ${v.key}`}
                            onClick={() => setDialog({ type: 'history', variable: v.key })}
                          >
                            <History size={15} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {selected && filteredVariables.length === 0 && profiles.data && profiles.data.length > 0 && (
            <div className="empty small">
              <p>
                {filter
                  ? 'No matching variables found.'
                  : selected.kind === 'secret'
                  ? 'No variables in this profile. Click "+ Add variable" or import a file.'
                  : 'This template has no keys.'}
              </p>
            </div>
          )}
        </div>
      </section>

      <ErrorNotice error={comparisons.error}/>
      {selected?.kind==='template' && <p className="help" style={{ margin: '0 32px 16px 32px' }}>Template values are never stored. Scan or import again to refresh key names.</p>}
      {!!comparisons.data?.length && <TemplateComparison comparisons={comparisons.data} />}
      {dialog?.type==='rename' && selected && <Rename title="Rename profile" initial={selected.name} onClose={()=>setDialog(null)} onSave={async name=>{await api('rename_profile',{profile:selected.id,name});await refresh();}}/>}
      {dialog?.type==='delete_profile' && selected && <Confirm title="Delete profile?" description="This permanently deletes all values and versions in this profile. Source files stay on disk." onClose={()=>setDialog(null)} onConfirm={async()=>{await api('remove_profile',{profile:selected.id});setParams({});await refresh();}}/>}
      {/* Dialogs */}
      {dialog?.type === 'add' && selected && (
        <EditSecret profile={selected.id} onClose={() => setDialog(null)} onDone={refresh} />
      )}

      {dialog?.type === 'edit' && selected && (
        <EditSecret
          profile={selected.id}
          variable={dialog.variable}
          onClose={() => setDialog(null)}
          onDone={refresh}
        />
      )}

      {dialog?.type === 'remove' && selected && (
        <Confirm
          title={`Delete ${dialog.variable.key}?`}
          description="This adds a deleted version. You can restore a previous value from history."
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api('remove_secret', { profile: selected.id, key: dialog.variable.key });
            await refresh();
          }}
        />
      )}

      {dialog?.type === 'history' && selected && (
        <HistoryDialog
          profile={selected.id}
          variable={dialog.variable}
          onClose={() => setDialog(null)}
          onDone={refresh}
        />
      )}

      {dialog?.type === 'import' && (
        <ImportDialog
          project={projectId}
          paths={profiles.data?.map(p => p.path) ?? []}
          onClose={() => setDialog(null)}
          onDone={refresh}
        />
      )}

      {dialog?.type === 'export' && selected && (
        <ExportDialog profile={selected} onClose={() => setDialog(null)} />
      )}

      {scanProfiles && (
        <ScanDialog
          projectId={projectId}
          profiles={scanProfiles}
          onClose={() => setScanProfiles(null)}
          onConfirm={handleConfirmScan}
        />
      )}
    </>
  );
});

export default ProjectPage;

function EditSecret({
  profile,
  variable,
  onDone,
  onClose,
}: {
  profile: string;
  variable?: Variable;
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  const [key, setKey] = useState(variable?.key ?? '');
  const [value, setValue] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  return (
    <Modal title={variable ? 'Edit variable' : 'Add variable'} onClose={onClose}>
      <form
        onSubmit={async e => {
          e.preventDefault();
          setBusy(true);
          const secret = value;
          setValue('');
          try {
            await api('set', { profile, key, value: secret });
            await onDone();
            onClose();
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Variable name
          <input
            autoFocus={!variable}
            value={key}
            onChange={e => setKey(e.target.value)}
            disabled={!!variable}
            pattern="[A-Za-z_][A-Za-z0-9_]*"
            required
            placeholder="DATABASE_URL"
          />
        </label>
        <label>
          Value
          <textarea
            className={visible ? '' : 'secret-input'}
            value={value}
            onChange={e => setValue(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            rows={5}
            placeholder="Enter a value. Empty values are allowed."
          />
        </label>
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <button type="button" className="secondary" onClick={() => setVisible(!visible)}>
            {visible ? 'Hide value' : 'Show value'}
          </button>
          {variable?.has_value && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setValue(await api('reveal', { profile, key }));
                } catch (e) {
                  setError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Load current value
            </button>
          )}
        </div>
        <p className="help">Saving creates a new version. Multiline values are supported.</p>
        <ErrorNotice error={error} />
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            Save variable
          </button>
        </div>
      </form>
    </Modal>
  );
}

function HistoryDialog({
  profile,
  variable,
  onClose,
  onDone,
}: {
  profile: string;
  variable: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const q = useQuery({
    queryKey: ['history', profile, variable],
    queryFn: () => api('history', { profile, key: variable }),
  });
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<unknown>();

  const refresh = async () => {
    await onDone();
    await q.refetch();
  };

  return (
    <Modal title={`History · ${variable}`} onClose={onClose}>
      <p>Restore any version as a new current version.</p>
      <ErrorNotice error={q.error ?? error} />
      <div className="history-list">
        {q.data?.map(v => (
          <HistoryRow
            key={v.id}
            version={v}
            profile={profile}
            variable={variable}
            onDone={refresh}
          />
        ))}
      </div>
      {confirm ? (
        <div className="inline-confirm">
          <p>Permanently delete every old version? The current version will stay.</p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="secondary" onClick={() => setConfirm(false)}>
              Cancel
            </button>
            <button
              className="danger"
              onClick={async () => {
                try {
                  await api('clear_history', { profile, key: variable });
                  await refresh();
                  setConfirm(false);
                } catch (e) {
                  setError(e);
                }
              }}
            >
              Confirm clear history
            </button>
          </div>
        </div>
      ) : (
        <button
          disabled={(q.data?.length ?? 0) < 2}
          className="danger subtle"
          onClick={() => setConfirm(true)}
        >
          Clear old history
        </button>
      )}
    </Modal>
  );
}

function HistoryRow({
  version: v,
  profile,
  variable,
  onDone,
}: {
  version: Version;
  profile: string;
  variable: string;
  onDone: () => Promise<void>;
}) {
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'restore' | 'delete_version' | null>(null);

  return (
    <div className="history-item">
      <div className="history-item-top">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="badge">{v.action}</span>
          {v.current && <span className="badge current">Current</span>}
        </div>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{date(v.created_at)}</span>
      </div>
      <code className="version-id">{v.id}</code>
      <p className="help">Source: {v.source}</p>
      {value !== null && <pre className="history-value">{value}</pre>}
      <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
        {v.has_value && (
          <button
            className="secondary"
            disabled={busy}
            onClick={async () => {
              if (value !== null) {
                setValue(null);
                return;
              }
              setBusy(true);
              try {
                setValue(await api('reveal', { profile, key: variable, version: v.id }));
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {value === null ? 'Reveal version' : 'Hide version'}
          </button>
        )}
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setValue(null);
            setConfirm('restore');
          }}
        >
          Restore
        </button>
        {!v.current && (
          <button
            className="danger subtle"
            disabled={busy}
            onClick={() => {
              setValue(null);
              setConfirm('delete_version');
            }}
          >
            Delete version
          </button>
        )}
      </div>
      {confirm && (
        <div className="inline-confirm">
          <p>
            {confirm === 'restore'
              ? 'Create a new current version from this version?'
              : 'Permanently delete this version?'}
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="secondary" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(confirm, { profile, key: variable, version: v.id });
                  setConfirm(null);
                  await onDone();
                } catch (e) {
                  setError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirm === 'restore' ? 'Confirm restore' : 'Confirm deletion'}
            </button>
          </div>
        </div>
      )}
      <ErrorNotice error={error} />
    </div>
  );
}

function TemplateComparison({ comparisons }: { comparisons: Comparison[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const totalMissing = comparisons.reduce((sum, c) => sum + c.missing.length, 0);

  return (
    <div className="template-comparison-panel">
      <button
        type="button"
        className="template-comparison-header"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <div className="template-comparison-header-left">
          <GitCompare size={15} className="template-header-icon" />
          <span className="template-comparison-title">Template comparison</span>
          {totalMissing > 0 ? (
            <span className="comparison-badge warning">
              <AlertTriangle size={12} />
              <span>{totalMissing} missing</span>
            </span>
          ) : (
            <span className="comparison-badge success">
              <CheckCircle2 size={12} />
              <span>In sync</span>
            </span>
          )}
          <span className="comparison-template-count">
            {comparisons.length} {comparisons.length === 1 ? 'template' : 'templates'}
          </span>
        </div>
        <div className="template-comparison-header-right">
          <ChevronDown
            size={16}
            className={`template-chevron ${isOpen ? 'is-open' : ''}`}
          />
        </div>
      </button>

      {isOpen && (
        <div className="template-comparison-content">
          {comparisons.map(c => {
            const hasMissing = c.missing.length > 0;
            const hasExtra = c.extra.length > 0;

            return (
              <div key={c.template} className="template-item">
                <div className="template-item-top">
                  <div className="template-file-info">
                    <FileText size={13} className="template-file-icon" />
                    <code className="template-path">{c.template}</code>
                  </div>
                  <div className="template-status-pills">
                    {hasMissing ? (
                      <span className="pill-status missing">
                        {c.missing.length} missing
                      </span>
                    ) : (
                      <span className="pill-status sync">
                        All keys present
                      </span>
                    )}
                    {hasExtra && (
                      <span className="pill-status extra">
                        {c.extra.length} extra
                      </span>
                    )}
                  </div>
                </div>

                <div className="template-diff-body">
                  <div className="template-diff-row">
                    <span className="diff-label missing-label">
                      Missing ({c.missing.length}):
                    </span>
                    {hasMissing ? (
                      <div className="diff-chips">
                        {c.missing.map(key => (
                          <span key={key} className="key-chip missing">
                            {key}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="diff-none">None</span>
                    )}
                  </div>

                  <div className="template-diff-row">
                    <span className="diff-label extra-label">
                      Extra ({c.extra.length}):
                    </span>
                    {hasExtra ? (
                      <div className="diff-chips">
                        {c.extra.map(key => (
                          <span key={key} className="key-chip extra">
                            {key}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="diff-none">None</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Routes, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import {
  Folder,
  ChevronRight,
  Plus,
  Settings as SettingsIcon,
  Search,
  ScanLine,
  Upload,
  Download,
  Lock,
  FileText,
  ArrowRight,
  ShieldCheck,
  FolderPlus,
  Trash2,
  Pencil,
} from 'lucide-react';
import { api, type Project, type Profile } from './api';
import { Brand, Confirm, ErrorNotice, Modal, Rename } from './components/common';
import ProjectPage, { type ProjectPageHandle } from './components/ProjectPage';
import { ImportDialog, ExportDialog } from './components/Transfer';
import { Titlebar } from './components/Titlebar';
import { ScanDialog } from './components/ScanDialog';
import { triggerCipherFadeOut } from './utils/cipherAnimation';

export default function App() {
  const query = useQuery({ queryKey: ['status'], queryFn: () => api('status', {}) });
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [settings, setSettings] = useState(false);
  const [addProject, setAddProject] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState('');
  const [scanning, setScanning] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [scanDialogData, setScanDialogData] = useState<{ projectId: string; profiles: Profile[] } | null>(null);

  const [isLocking, setIsLocking] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('pablock_sidebar_width');
      return saved ? Math.max(180, Math.min(480, Number(saved))) : 260;
    } catch {
      return 260;
    }
  });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const projectPageRef = useRef<ProjectPageHandle>(null);
  const layoutRef = useRef<HTMLDivElement>(null);

  // Extract projectId from pathname
  const projectMatch = location.pathname.match(/^\/project\/([^/]+)/);
  const activeProjectId = projectMatch ? projectMatch[1] : undefined;
  const activeProfileId = searchParams.get('profile') || undefined;

  // Projects query
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => api('projects', {}),
    enabled: !!query.data?.unlocked,
  });

  const activeProject = projectsQuery.data?.find(p => p.id === activeProjectId);

  // Keyboard shortcut ⌘K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (query.isPending) return <><Titlebar/><div className="loading">Opening Pablock…</div></>;
  if (query.isError) {
    return (
      <><Titlebar/><main className="auth">
        <Brand />
        <ErrorNotice error={query.error} />
        <button className="primary" onClick={() => void query.refetch()}>
          Retry connection
        </button>
      </main></>
    );
  }

  if (!query.data.unlocked) {
    return (
      <><Titlebar/><Auth
        initialized={query.data.initialized}
        onOpen={async () => {
          client.clear();
          navigate('/');
          await client.invalidateQueries();
        }}
      /></>
    );
  }

  async function lock() {
    if (isLocking) return;
    setIsLocking(true);
    try {
      if (layoutRef.current) {
        await triggerCipherFadeOut(layoutRef.current);
      }
      await api('lock', {});
      setSettings(false);
      setAddProject(false);
      setImportOpen(false);
      setExportOpen(false);
      setScanDialogData(null);
      setSearchFilter('');
      client.clear();
      navigate('/');
      await client.invalidateQueries();
    } catch (e) {
      setError(e);
    } finally {
      setIsLocking(false);
    }
  }

  const handleScan = async () => {
    if (projectPageRef.current) {
      await projectPageRef.current.scan();
      return;
    }

    if (!activeProjectId) {
      if (projectsQuery.data && projectsQuery.data.length > 0) {
        const first = projectsQuery.data[0];
        navigate(`/project/${first.id}`);
      }
      return;
    }

    setScanning(true);
    setError(undefined);
    try {
      const found = await api('discover', { project: activeProjectId });
      setScanDialogData({ projectId: activeProjectId, profiles: found });
    } catch (e) {
      setError(e);
    } finally {
      setScanning(false);
    }
  };

  const handleConfirmScan = async (selectedPaths: string[], importKeys: boolean) => {
    if (!scanDialogData) return;
    const { projectId } = scanDialogData;
    if (importKeys && selectedPaths.length > 0) {
      await api('import', { project: projectId, files: selectedPaths, replace: false });
    } else {
      await api('register_profiles', { project: projectId, paths: selectedPaths });
    }
    setNotice(`Scan complete. ${selectedPaths.length} profiles registered.`);
    await client.invalidateQueries({ queryKey: ['profiles', projectId] });
    await client.invalidateQueries({ queryKey: ['variables'] });
    await client.invalidateQueries({ queryKey: ['templates'] });
    if (selectedPaths.length > 0 && !activeProfileId) {
      const registered = await api('profiles', { project: projectId });
      const matched = registered.find(p => selectedPaths.includes(p.path));
      if (matched) {
        setSearchParams({ profile: matched.id });
      }
    }
    setScanDialogData(null);
  };

  const handleImport = () => {
    if (projectPageRef.current) {
      projectPageRef.current.openImport();
    } else if (activeProjectId) {
      setImportOpen(true);
    }
  };

  const handleExport = () => {
    if (projectPageRef.current) {
      projectPageRef.current.openExport();
    } else if (activeProjectId) {
      setExportOpen(true);
    }
  };

  const handleSidebarResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(180, Math.min(500, startW + (moveEvent.clientX - startX)));
      setSidebarWidth(newWidth);
      try {
        localStorage.setItem('pablock_sidebar_width', String(newWidth));
      } catch {
        // ignore
      }
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div className="app-container">
      <Titlebar />
      <div className="app-layout" ref={layoutRef}>
      {/* Sol Panel: Nested Sidebar */}
      <aside className="sidebar" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
        <div className="sidebar-header">
          <Link to="/" className="sidebar-title">Projects</Link>
          <button
            className="add-btn"
            type="button"
            aria-label="Add project"
            title="Add project"
            onClick={() => setAddProject(true)}
          >
            <Plus size={14} />
          </button>
        </div>

        <nav className="sidebar-tree">
          {projectsQuery.data?.map(p => (
            <ProjectTreeItem
              key={p.id}
              project={p}
              isActiveProject={activeProjectId === p.id}
              activeProfileId={activeProfileId}
              onSelectProfile={(projId, profId) => {
                navigate(`/project/${projId}?profile=${profId}`);
              }}
              onSelectProject={projId => {
                navigate(`/project/${projId}`);
              }}
            />
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button
            className="settings-action"
            type="button"
            onClick={() => setSettings(true)}
          >
            <SettingsIcon size={16} />
            <span>Settings</span>
          </button>
        </div>
      </aside>

      <div
        className="sidebar-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onMouseDown={handleSidebarResizeMouseDown}
      />

      {/* Ana İçerik Alanı */}
      <main className="main-content">
        <header className="top-nav">
          <div className="search-container">
            <Search className="search-glyph" size={15} />
            <input
              ref={searchInputRef}
              type="text"
              className="search-field"
              placeholder="Search projects, variables..."
              aria-label="Search projects and variables"
              value={searchFilter}
              onChange={e => setSearchFilter(e.target.value)}
            />
            <span className="kbd-tag">Ctrl K</span>
          </div>

          <div className="nav-button-group">
            <button
              className="nav-btn"
              type="button"
              aria-label="Scan project"
              disabled={scanning}
              onClick={handleScan}
            >
              <ScanLine size={15} />
              <span>{scanning ? 'Scanning…' : 'Scan project'}</span>
            </button>

            <button
              className="nav-btn"
              type="button"
              aria-label="Import files"
              disabled={!activeProjectId}
              onClick={handleImport}
            >
              <Upload size={15} />
              <span>Import</span>
            </button>

            <button
              className="nav-btn"
              type="button"
              aria-label="Diff & export"
              disabled={!activeProjectId}
              onClick={handleExport}
            >
              <Download size={15} />
              <span>Export</span>
            </button>

            <button
              className={`nav-btn ${isLocking ? 'is-locking' : ''}`}
              type="button"
              aria-label="Lock vault"
              disabled={isLocking}
              onClick={() => void lock()}
            >
              <Lock size={14} />
              <span>{isLocking ? 'Locking…' : 'Lock'}</span>
            </button>
          </div>
        </header>

        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button onClick={() => setNotice('')} aria-label="Dismiss notification">
              ×
            </button>
          </div>
        )}

        <ErrorNotice error={error} />

        <Routes>
          <Route
            path="/"
            element={
              <ProjectsOverview
                filter={searchFilter}
                onAddProject={() => setAddProject(true)}
              />
            }
          />
          <Route
            path="/project/:projectId"
            element={
              <ProjectPage
                ref={projectPageRef}
                filter={searchFilter}
                onNotice={setNotice}
              />
            }
          />
          <Route
            path="*"
            element={
              <ProjectsOverview
                filter={searchFilter}
                onAddProject={() => setAddProject(true)}
              />
            }
          />
        </Routes>
      </main>

      {/* Global Dialogs */}
      {addProject && (
        <AddProject
          onClose={() => setAddProject(false)}
          onAdded={async id => {
            await client.invalidateQueries({ queryKey: ['projects'] });
            navigate(`/project/${id}`);
          }}
        />
      )}

      {settings && <PasswordDialog onClose={() => setSettings(false)} />}

      {importOpen && activeProjectId && (
        <ImportDialog
          project={activeProjectId}
          paths={[]}
          onClose={() => setImportOpen(false)}
          onDone={async () => {
            await client.invalidateQueries({ queryKey: ['profiles', activeProjectId] });
            await client.invalidateQueries({ queryKey: ['variables'] });
          }}
        />
      )}

      {exportOpen && activeProject && (
        <ExportDialog
          profile={{
            id: activeProfileId || '',
            project_id: activeProjectId || '',
            path: '.env',
            name: '.env',
            kind: 'secret',
          }}
          onClose={() => setExportOpen(false)}
        />
      )}

      {scanDialogData && (
        <ScanDialog
          projectId={scanDialogData.projectId}
          profiles={scanDialogData.profiles}
          onClose={() => setScanDialogData(null)}
          onConfirm={handleConfirmScan}
        />
      )}
      </div>
    </div>
  );
}

function ProjectTreeItem({
  project,
  isActiveProject,
  activeProfileId,
  onSelectProfile,
  onSelectProject,
}: {
  project: Project;
  isActiveProject: boolean;
  activeProfileId?: string;
  onSelectProfile: (projectId: string, profileId: string) => void;
  onSelectProject: (projectId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const profilesQuery = useQuery({
    queryKey: ['profiles', project.id],
    queryFn: () => api('profiles', { project: project.id }),
  });

  const profiles = profilesQuery.data ?? [];

  return (
    <div className={`tree-item project-item ${expanded ? 'is-expanded' : ''}`}>
      <div
        className={`tree-row ${isActiveProject ? 'project-active-row' : ''}`}
        role="button" tabIndex={0} aria-expanded={expanded}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded); onSelectProject(project.id); } }}
        onClick={() => {
          setExpanded(!expanded);
          onSelectProject(project.id);
        }}
      >
        <ChevronRight className={`chevron ${expanded ? 'chevron-open' : ''}`} size={13} />
        <Folder className="node-icon" size={16} />
        <span className="item-text">{project.name}</span>
      </div>

      {expanded && (
        <div className="nested-children">
          {profiles.map(prof => {
            const isSelected = activeProfileId === prof.id;
            return (
              <div
                key={prof.id}
                className={`tree-row file-row ${isSelected ? 'is-active' : ''}`}
                role="button" tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectProfile(project.id, prof.id); } }}
                onClick={e => {
                  e.stopPropagation();
                  onSelectProfile(project.id, prof.id);
                }}
              >
                <FileText className="node-icon" size={14} />
                <span className="item-text">{prof.path}</span>
                {prof.kind === 'template' && <span className="template-badge">Template</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProjectsOverview({
  filter,
  onAddProject,
}: {
  filter: string;
  onAddProject: () => void;
}) {
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: () => api('projects', {}) });
  const navigate = useNavigate();
  const client = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);

  const projects = (projectsQuery.data ?? []).filter(p =>
    p.name.toLowerCase().includes(filter.toLowerCase()) ||
    p.root.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <>
      <section className="profile-header-area">
        <div className="profile-info">
          <h1 className="profile-title">Your projects</h1>
          <p className="profile-breadcrumb">pablock / workspace</p>
        </div>
        <div className="profile-meta-pills">
          <span className="pill-variable-count">{projects.length} projects</span>
        </div>
      </section>

      <section className="variables-panel">
        <div className="variables-panel-header">
          <h2 className="variables-heading">Projects</h2>
          <button className="add-variable-btn" type="button" onClick={onAddProject}>
            <FolderPlus size={15} />
            <span>Add project</span>
          </button>
        </div>

        <div className="table-wrapper">
          {projectsQuery.isPending ? (
            <div className="empty">Loading projects…</div>
          ) : projects.length === 0 ? (
            <div className="empty">
              <h2>Add your first project</h2>
              <p>Choose a project directory, then scan for dotenv files.</p>
              <button className="primary" onClick={onAddProject}>
                <Plus size={15} />
                <span>Add project</span>
              </button>
            </div>
          ) : (
            <table className="env-table">
              <thead>
                <tr>
                  <th className="col-head th-key">Project name</th>
                  <th className="col-head th-value">Directory root</th>
                  <th className="col-head th-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {projects.map(p => (
                  <tr
                    key={p.id}
                    className="table-row"
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/project/${p.id}`)}
                  >
                    <td className="cell-key font-mono">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Folder size={16} color="var(--text-secondary)" />
                        <span>{p.name}</span>
                      </div>
                    </td>
                    <td className="cell-value font-mono text-muted" style={{ color: 'var(--text-muted)' }}>
                      {p.root}
                    </td>
                    <td className="cell-actions" onClick={e => e.stopPropagation()}>
                      <button className="icon-tool-btn" type="button" aria-label={`Rename ${p.name}`} onClick={() => setRenameTarget(p)}><Pencil size={15}/></button>
                      <button
                        className="icon-tool-btn"
                        type="button"
                        title="Delete project"
                        aria-label={`Delete ${p.name}`}
                        onClick={() => setDeleteTarget(p)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {renameTarget && <Rename title="Rename project" initial={renameTarget.name} onClose={() => setRenameTarget(null)} onSave={async name => { await api('rename_project', { project: renameTarget.id, name }); await client.invalidateQueries({queryKey:['projects']}); }}/>}
      {deleteTarget && (
        <Confirm
          title="Delete project?"
          description="This permanently deletes every stored value and version in this project. Source dotenv files stay on disk."
          onClose={() => setDeleteTarget(null)}
          onConfirm={async () => {
            await api('remove_project', { project: deleteTarget.id });
            await client.invalidateQueries({ queryKey: ['projects'] });
          }}
        />
      )}
    </>
  );
}

function Auth({
  initialized,
  onOpen,
}: {
  initialized: boolean;
  onOpen: () => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  return (
    <main className="auth">
      <Brand />
      <div className="auth-panel">
        <span className="eyebrow">YOUR LOCAL ENV VAULT</span>
        <h1>{initialized ? 'Welcome back.' : 'A safer home for your secrets.'}</h1>
        <p>
          {initialized
            ? 'Unlock your projects with your master password.'
            : 'Create a master password to encrypt your dotenv values on this machine.'}
        </p>

        <form
          onSubmit={async e => {
            e.preventDefault();
            if (!initialized && password !== confirm) {
              setError('Passwords do not match');
              return;
            }
            setBusy(true);
            const secret = password;
            setPassword('');
            setConfirm('');
            try {
              await api(initialized ? 'unlock' : 'init', { password: secret });
              await onOpen();
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Master password
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete={initialized ? 'current-password' : 'new-password'}
              required
              autoFocus
            />
          </label>

          {!initialized && (
            <>
              <label>
                Confirm password
                <input
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>
              <p className="help">
                There is no password recovery. Keep your master password somewhere safe.
              </p>
            </>
          )}

          <ErrorNotice error={error} />

          <button className="primary full" disabled={busy}>
            <span>{busy ? 'Opening vault…' : initialized ? 'Unlock vault' : 'Create vault'}</span>
            <ArrowRight size={16} />
          </button>
        </form>
      </div>

      <p className="auth-foot">
        <ShieldCheck size={16} />
        Local storage. No account. No cloud.
      </p>
    </main>
  );
}

function AddProject({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (id: string) => Promise<void>;
}) {
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  return (
    <Modal title="Add project" onClose={onClose}>
      <p>Enter the absolute path to your project directory.</p>
      <form
        onSubmit={async e => {
          e.preventDefault();
          setBusy(true);
          try {
            const p = await api('add_project', { path, name: name || undefined });
            await onAdded(p.id);
            onClose();
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Project directory
          <input
            autoFocus
            placeholder="/home/you/projects/my-app"
            value={path}
            onChange={e => setPath(e.target.value)}
            required
          />
        </label>
        <label>
          Display name <span style={{ color: 'var(--text-muted)' }}>optional</span>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={256}
          />
        </label>
        <p className="help">Pablock adds a .pablock.toml marker containing only the project ID.</p>
        <ErrorNotice error={error} />
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            Add project
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  return (
    <Modal title="Change master password" onClose={onClose}>
      <form
        onSubmit={async e => {
          e.preventDefault();
          if (next !== confirm) {
            setError('Passwords do not match');
            return;
          }
          setBusy(true);
          const args = { current, new: next };
          setCurrent('');
          setNext('');
          setConfirm('');
          try {
            await api('password', args);
            onClose();
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Current password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={e => setCurrent(e.target.value)}
          />
        </label>
        <label>
          New password
          <input
            type="password"
            autoComplete="new-password"
            required
            value={next}
            onChange={e => setNext(e.target.value)}
          />
        </label>
        <label>
          Confirm new password
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
          />
        </label>
        <p className="help">
          Your vault will be encrypted with the new password. There is no password recovery.
        </p>
        <ErrorNotice error={error} />
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            Change password
          </button>
        </div>
      </form>
    </Modal>
  );
}

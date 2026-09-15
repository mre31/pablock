import { useState } from 'react';
import { FileText, CheckCircle2 } from 'lucide-react';
import { api, type Preview, type Profile } from '../api';
import { DiffView, ErrorNotice, Modal } from './common';
interface ScanDialogProps {
  projectId: string; profiles: Profile[]; onClose: () => void;
  onConfirm: (selectedPaths: string[], importValues: boolean) => Promise<void>;
}
export function ScanDialog({ projectId, profiles, onClose, onConfirm }: ScanDialogProps) {
  const [selectedPaths, setSelectedPaths] = useState(profiles.map(p => p.path));
  const [importValues, setImportValues] = useState(true);
  const [preview, setPreview] = useState<Preview[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const togglePath = (path: string) => {
    setSelectedPaths(prev => prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]);
    setPreview(null);
  };
  async function confirm() {
    setBusy(true); setError(undefined);
    try {
      if (importValues && !preview) {
        setPreview(await api('preview_import', { project: projectId, files: selectedPaths, replace: false }));
      } else {
        await onConfirm(selectedPaths, importValues); onClose();
      }
    } catch (e) { setError(e); setPreview(null); } finally { setBusy(false); }
  }
  return <Modal title="Scan project" onClose={onClose}>
    <p>Found {profiles.length} dotenv profiles. Choose which profiles to register.</p>
    <div style={{border:'1px solid var(--border-default)',borderRadius:8,background:'#050505',overflow:'auto',marginBottom:16,maxHeight:240}}>
      {!profiles.length && <p style={{padding:16}}>No dotenv files found in this project.</p>}
      {profiles.map(p => <label key={p.path} className="checkbox" style={{display:'flex',gap:10,padding:'10px 14px',margin:0,borderBottom:'1px solid var(--border-subtle)',cursor:'pointer'}}>
        <input type="checkbox" checked={selectedPaths.includes(p.path)} onChange={()=>togglePath(p.path)} disabled={busy} aria-label={p.path}/>
        <FileText size={15}/><span className="font-mono" style={{flex:1,fontSize:13}}>{p.path}</span><span className="badge">{p.kind}</span>
      </label>)}
    </div>
    <label className="checkbox"><input type="checkbox" checked={importValues} disabled={busy} onChange={e=>{setImportValues(e.target.checked);setPreview(null);}}/>Import secret values into vault</label>
    <p className="help">{importValues?'Preview and merge values from selected files. Templates contribute key names only.':'Register selected profile paths and template keys. Secret values stay on disk.'}</p>
    {preview?.map(p=><section key={p.path}><h3>{p.path}</h3><DiffView diff={p.diff}/>{p.warnings.map(w=><p className="warning" key={w}>{w}</p>)}</section>)}
    <ErrorNotice error={error}/>
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="primary" disabled={busy||!selectedPaths.length} onClick={()=>void confirm()}><CheckCircle2 size={14}/><span>{busy?'Working…':importValues&&!preview?'Preview import':'Confirm'}</span></button></div>
  </Modal>;
}

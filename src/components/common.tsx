import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X, LockKeyhole } from 'lucide-react';
import { errorMessage, type Diff } from '../api';
export function Brand() { return <div className="brand"><span className="brand-icon"><LockKeyhole size={21}/></span><strong>pablock<span className="brand-dot">.</span></strong></div>; }
export function Modal({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(()=>{ const el=dialog.current!; el.showModal(); return ()=>el.close(); },[]);
  return <dialog ref={dialog} onCancel={onClose} aria-label={title}><div className="modal-heading"><h2>{title}</h2><button className="icon" aria-label="Close dialog" onClick={onClose}><X size={18}/></button></div>{children}</dialog>;
}
export function ErrorNotice({error}:{error:unknown}) { return error ? <div role="alert" className="error">{errorMessage(error)}</div> : null; }
export function DiffView({diff}:{diff:Diff}) { return <div className="diff-grid">{(['added','changed','removed','unchanged'] as const).map(kind=><div className={`diff-group ${kind}`} key={kind}><span>{kind} <b>{diff[kind].length}</b></span><ul>{diff[kind].map(key=><li key={key}>{key}</li>)}</ul></div>)}</div>; }
export function Confirm({title,description,onConfirm,onClose}:{title:string;description:string;onConfirm:()=>Promise<unknown>;onClose:()=>void}) {
  const [busy,setBusy]=useState(false); const [error,setError]=useState<unknown>();
  return <Modal title={title} onClose={onClose}><p>{description}</p><ErrorNotice error={error}/><div className="modal-actions"><button onClick={onClose}>Cancel</button><button className="danger" disabled={busy} onClick={async()=>{setBusy(true);try{await onConfirm();onClose();}catch(e){setError(e);}finally{setBusy(false);}}}>{busy?'Working…':'Confirm'}</button></div></Modal>;
}
export function Rename({title,initial,onSave,onClose}:{title:string;initial:string;onSave:(name:string)=>Promise<unknown>;onClose:()=>void}) {
  const [name,setName]=useState(initial); const [busy,setBusy]=useState(false);const [error,setError]=useState<unknown>();
  return <Modal title={title} onClose={onClose}><form onSubmit={async e=>{e.preventDefault();setBusy(true);try{await onSave(name);onClose();}catch(e){setError(e);}finally{setBusy(false);}}}><label>Display name<input value={name} onChange={e=>setName(e.target.value)} required maxLength={256} autoFocus/></label><ErrorNotice error={error}/><div className="modal-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Save name</button></div></form></Modal>;
}
export function date(value:string) { return value ? new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}) : 'Key names only'; }

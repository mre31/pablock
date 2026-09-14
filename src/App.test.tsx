import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import App from './App';
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn()}));
const project={id:'project-1',name:'My app',root:'/work/my-app',created_at:'',updated_at:''};
const profile={id:'profile-1',project_id:project.id,path:'.env',name:'.env',kind:'secret'};
const diff={added:['NEW_KEY'],changed:['TOKEN'],removed:[],unchanged:[]};
let initialized:boolean;let unlocked:boolean;let profiles:typeof profile[];let token:string;let revision:number;
let calls:{op:string;[key:string]:unknown}[];
beforeEach(()=>{
 initialized=true;unlocked=true;profiles=[profile];token='a-private-secret';revision=0;calls=[];
 vi.mocked(invoke).mockImplementation(async(_command,args)=>{
  const request=(args as {request:{op:string;[key:string]:unknown}}).request;calls.push(request);
  switch(request.op){
   case 'status':return {initialized,unlocked,data_dir:'/local/pablock'};
   case 'init':initialized=true;unlocked=true;return null;
   case 'unlock':unlocked=true;return null;
   case 'lock':unlocked=false;return null;
   case 'projects':return [project];
   case 'profiles':return profiles;
   case 'scan':profiles=[profile];return profiles;
   case 'variables':return [{key:'TOKEN',has_value:true,updated_at:`2026-01-01T10:00:0${revision}Z`}];
   case 'templates':return [];
   case 'reveal':return request.version?'previous-secret':token;
   case 'set':token=String(request.value);revision++;return null;
   case 'preview_import':return [{path:'.env',kind:'secret',diff,warnings:[]}];
   case 'import':revision++;return [];
   case 'diff':return diff;
   case 'export':return diff;
   case 'history':return [{id:'version-1',key:'TOKEN',action:'set',source:'manual',created_at:'2026-01-01T09:00:00Z',has_value:true,current:false},{id:'version-2',key:'TOKEN',action:'set',source:'manual',created_at:'2026-01-01T10:00:00Z',has_value:true,current:true}];
   case 'restore':token='previous-secret';revision++;return null;
   default:return null;
  }
 });
});
function setup(path='/project/project-1') {const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{gcTime:0}}});const user=userEvent.setup();render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><App/></MemoryRouter></QueryClientProvider>);return {user,client};}
describe('vault workflows',()=>{
 it('sets up a vault and removes password fields after opening',async()=>{
  initialized=false;unlocked=false;const {user,client}=setup('/');
  await user.type(await screen.findByLabelText('Master password'),'master-pass');await user.type(screen.getByLabelText('Confirm password'),'master-pass');await user.click(screen.getByRole('button',{name:'Create vault'}));
  expect(await screen.findByRole('heading',{name:/Your projects/})).toBeInTheDocument();expect(calls).toContainEqual({op:'init',password:'master-pass'});expect(JSON.stringify(client.getQueryCache().getAll().map(q=>q.state.data))).not.toContain('master-pass');expect(screen.queryByLabelText('Master password')).not.toBeInTheDocument();
 });
 it('scans the project and shows discovered profiles',async()=>{
  profiles=[];const {user}=setup();await user.click(await screen.findByRole('button',{name:'Scan project'}));expect(await screen.findByText('Scan complete. 1 profiles registered.')).toBeInTheDocument();expect(await screen.findByText('TOKEN')).toBeInTheDocument();expect(calls.some(c=>c.op==='scan'&&c.project==='project-1')).toBe(true);
 });
 it('previews replace import before applying changes',async()=>{
  const {user}=setup();await user.click(await screen.findByRole('button',{name:'Import files'}));const dialog=screen.getByRole('dialog',{name:'Import dotenv files'});await user.click(within(dialog).getByRole('radio',{name:/Replace/}));await user.click(within(dialog).getByRole('button',{name:'Preview import'}));expect(await within(dialog).findByText('NEW_KEY')).toBeInTheDocument();expect(calls.some(c=>c.op==='import')).toBe(false);await user.click(within(dialog).getByRole('button',{name:'Confirm import'}));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(calls).toContainEqual({op:'import',project:'project-1',files:['.env'],replace:true});
 });
 it('edits variables without putting values into the query cache',async()=>{
  const {user,client}=setup();await user.click(await screen.findByRole('button',{name:'Edit TOKEN'}));const dialog=screen.getByRole('dialog',{name:'Edit variable'});await user.type(within(dialog).getByLabelText('Value'),'new-secret');await user.click(within(dialog).getByRole('button',{name:'Save variable'}));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(calls).toContainEqual({op:'set',profile:'profile-1',key:'TOKEN',value:'new-secret'});expect(JSON.stringify(client.getQueryCache().getAll().map(q=>q.state.data))).not.toContain('new-secret');expect(screen.queryByText('new-secret')).not.toBeInTheDocument();
 });
 it('reveals a row, hides it, and clears displayed secrets on lock',async()=>{
  const {user,client}=setup();await user.click(await screen.findByRole('button',{name:'Reveal TOKEN'}));expect(await screen.findByText('a-private-secret')).toBeInTheDocument();expect(JSON.stringify(client.getQueryCache().getAll().map(q=>q.state.data))).not.toContain('a-private-secret');await user.click(screen.getByRole('button',{name:'Hide TOKEN'}));expect(screen.queryByText('a-private-secret')).not.toBeInTheDocument();await user.click(screen.getByRole('button',{name:'Lock vault'}));expect(await screen.findByRole('button',{name:'Unlock vault'})).toBeInTheDocument();expect(screen.queryByText('TOKEN')).not.toBeInTheDocument();
 });
 it('compares export and requests explicit overwrite selection',async()=>{
  const {user}=setup();await user.click(await screen.findByRole('button',{name:'Diff & export'}));const dialog=screen.getByRole('dialog',{name:'Diff & export'});await user.click(within(dialog).getByRole('button',{name:'Compare with disk'}));expect(await within(dialog).findByText('NEW_KEY')).toBeInTheDocument();expect(calls.some(c=>c.op==='export')).toBe(false);await user.click(within(dialog).getByRole('checkbox'));await user.click(within(dialog).getByRole('button',{name:'Export file'}));expect(await within(dialog).findByText('Export complete.')).toBeInTheDocument();expect(calls).toContainEqual({op:'export',profile:'profile-1',target:'.env',overwrite:true});
 });
 it('restores a historical version after confirmation',async()=>{
  const {user}=setup();await user.click(await screen.findByRole('button',{name:'History TOKEN'}));const dialog=screen.getByRole('dialog',{name:'History · TOKEN'});await within(dialog).findByText('version-1');await user.click(within(dialog).getAllByRole('button',{name:'Restore'})[0]);expect(calls.some(c=>c.op==='restore')).toBe(false);await user.click(within(dialog).getByRole('button',{name:'Confirm restore'}));await waitFor(()=>expect(calls).toContainEqual({op:'restore',profile:'profile-1',key:'TOKEN',version:'version-1'}));
 });
 it('shows backend errors without reporting success',async()=>{
  const {user}=setup();await screen.findByText('TOKEN');vi.mocked(invoke).mockRejectedValueOnce({code:6,message:'Disk is full'});await user.click(screen.getByRole('button',{name:'Scan project'}));expect(await screen.findByRole('alert')).toHaveTextContent('Disk is full');expect(screen.queryByText(/Scan complete/)).not.toBeInTheDocument();
 });
});

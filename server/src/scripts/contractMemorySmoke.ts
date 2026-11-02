import '../config/env';
import fs from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { writePdfFixture } from '../tests/pdfFixture';
import { SESSION_HEADER } from '../auth/session';

const root=path.resolve(__dirname,'../../../.codex_tmp'),stamp=Date.now(),directory=path.join(root,'contract-memory-fixtures-'+stamp),report=path.join(root,'contract-memory-'+stamp+'.json');
const records:any[]=[];
const rpc=(child:ChildProcess,type:string)=>{const id=randomUUID();return new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>{child.off('message',listener);reject(new Error('Benchmark IPC timeout'));},5000);const listener=(m:any)=>{if(m.id===id){clearTimeout(timer);child.off('message',listener);resolve(m.data??m);}};child.on('message',listener);child.send({type,id});});};
const save=()=>fs.writeFile(report,JSON.stringify({date:new Date().toISOString(),method:'Fresh dedicated backend process per sample; real Cookie login then cold contract path;25ms parentRSS sampling; identical PDF files;2 samples per condition; no large-file legacy baseline',records},null,2));
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
  await fs.mkdir(directory,{recursive:true});
  const pages=['Residential rental agreement. Monthly rent is 2000 yuan. The deposit is never refundable, even if the room is returned in good condition.','Landlord may enter without notice at any time.'];
  const files=[{kind:'ordinary',file:path.join(directory,'ordinary.pdf'),size:undefined},{kind:'9MiB',file:path.join(directory,'nine.pdf'),size:9*1024*1024}];
  for(const item of files)await writePdfFixture(item.file,pages,item.size);
  const password=process.env.RENTVERITY_TEST_PASSWORD||(await fs.readFile(path.resolve(__dirname,'../../../../账号信息.md'),'utf8')).match(/(?:密码|password|pwd)[ \t]*[:：=][ \t]*([^\r\n]+)/i)?.[1]?.trim();assert.ok(password);
  try{for(const item of files)for(const mode of ['baseline','current'])for(let repetition=1;repetition<=2;repetition++){
    const options={silent:true,windowsHide:true};const child=fork(path.join(__dirname,mode==='baseline'?'contractBaselineHarness.js':'contractTaskHarness.js'),mode==='baseline'?[]:['--mode=real','--root='+path.resolve(__dirname,'../../.private',`contract-memory-${stamp}-${item.kind}-${repetition}`)],options);child.stdout!.resume();child.stderr!.resume();
    let started=Date.now();
    try{
      const base=await new Promise<string>((resolve,reject)=>{child.on('message',(m:any)=>{if(m.type==='ready')resolve(m.base);if(m.type==='fatal')reject(new Error(m.code));});child.once('exit',()=>reject(new Error('Benchmark child exited early')));});
      const login=await fetch(base+'/auth/login',{method:'POST',headers:{Origin:'http://127.0.0.1:5173','Content-Type':'application/json'},body:JSON.stringify({username:process.env.RENTVERITY_TEST_USER||'test001',password})});const identity:any=await login.json();assert.equal(login.status,200);assert.ok(identity.success);
      const headers={Origin:'http://127.0.0.1:5173',Cookie:login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; '),[SESSION_HEADER]:identity.data.sessionId};
      const size=(await fs.stat(item.file)).size,id=randomUUID();const form=new FormData();form.append('file',await openAsBlob(item.file,{type:'application/pdf'}),'synthetic.pdf');await rpc(child,'reset');started=Date.now();let input:any;
      if(mode==='baseline'){
        const parse=await fetch(base+'/contracts/parse',{method:'POST',headers,body:form});input=await parse.json();assert.equal(parse.status,200,JSON.stringify(input));
        const analyze=await fetch(base+'/contracts/analyze',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({documentId:input.data.documentId})});const result:any=await analyze.json();assert.equal(analyze.status,200,JSON.stringify(result));assert.ok(result.success);
      }else{
        const upload=await fetch(base+'/contracts/tasks',{method:'POST',headers:{...headers,'X-Contract-Task-Id':id,'X-Contract-File-Size':String(size)},body:form});assert.equal(upload.status,202);
        for(let i=0;i<1000;i++){input=await(await fetch(base+'/contracts/tasks/'+id,{headers})).json();if(!['receiving','queued','parsing','analyzing'].includes(input.data.state)&&!input.data.cleanupPending)break;await sleep(100);}
        assert.equal(input.data.state,'completed');await fetch(base+'/contracts/tasks/'+id,{method:'DELETE',headers});
      }
      const metrics=await rpc(child,'metrics');const record={kind:item.kind,mode,repetition,fileBytes:size,passed:true,failure:null,elapsedMs:Date.now()-started,...metrics};records.push(record);await save();console.log(JSON.stringify(record));
    }catch(error){const metrics=child.connected?await rpc(child,'metrics').catch(()=>null):null;records.push({kind:item.kind,mode,repetition,passed:false,failure:error instanceof Error?error.message:'UNKNOWN',elapsedMs:Date.now()-started,...metrics});await save();throw error;}
    finally{if(child.connected){child.send({type:'close'});await new Promise(resolve=>child.once('exit',resolve));}}
  }}finally{assert.ok(path.resolve(directory).startsWith(root+path.sep));await fs.rm(directory,{recursive:true,force:true});}
  console.log(JSON.stringify({report,contractTasks:records.length,modelApiCalls:records.reduce((n,r)=>n+r.apiCalls,0),baselineTasks:records.filter(r=>r.mode==='baseline').length,currentTasks:records.filter(r=>r.mode==='current').length}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Benchmark failed');process.exitCode=1;});

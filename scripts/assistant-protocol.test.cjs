const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const cache=new Map();
function load(file){file=path.resolve(__dirname,'..',file);if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(source,{exports,require:name=>load(path.relative(path.resolve(__dirname,'..'),path.resolve(path.dirname(file),name+'.ts')))},{filename:file});return exports;}
const {AssistantStreamGuard,parseAssistantEvent}=load('src/utils/assistantProtocol.ts');
const correlation={requestId:'11111111-1111-4111-8111-111111111111',callId:'fixture-call'};
const filters={city:'西安市',location:'',maxPrice:3000,houseTypes:['一居室']};
const card={id:1,title:'合成资料',city:'西安市',houseType:'一居室',price:2500,area:null,location:'西安市',image:'',matchReasons:[]};
const frame=(event,data={},ids=correlation)=>({event,data:{...ids,...data}});
const summary={...correlation,queryState:'succeeded',answerState:'succeeded',queryCount:1,modelCalls:2,correctionCount:0,returned:1,total:1,elapsedMs:10,queryDurationMs:2,errorCode:null};
const queryEvents=(empty=false)=>[
  frame('start',{}, {...correlation,callId:null}),frame('context',{intent:'house_search',filters,needsClarification:false}),
  frame('execution',{queryState:'running',queryCount:1,returned:0,total:0,durationMs:0}),
  frame('execution',{queryState:'succeeded',queryCount:1,returned:empty?0:1,total:empty?0:1,durationMs:2}),
  frame('houses',{filters,total:empty?0:1,list:empty?[]:[card],notice:'真实来源由服务端保证',unavailablePreferences:[]})
];
const answerEvents=(patch={})=>[frame('generation',{answerState:'streaming'}),frame('delta',{text:'正文不能控制执行状态。'}),frame('generation',{answerState:'succeeded'}),frame('done',{...summary,...patch,complete:true})];
function accept(events){const guard=new AssistantStreamGuard();for(const event of events)guard.accept(parseAssistantEvent(event.event,event.data));return guard;}
test('search requires a corresponding successful result, including valid empty results',()=>{accept([...queryEvents(),...answerEvents()]);accept([...queryEvents(true),...answerEvents({returned:0,total:0})]);});
test('ordinary answers and clarification complete without manufacturing a search result',()=>{
  for(const clarification of [false,true])accept([frame('start',{}, {...correlation,callId:null}),frame('context',{intent:clarification?'house_search':'rental_qa',filters:clarification?{location:'',houseTypes:[]}:null,needsClarification:clarification}),frame('execution',{queryState:'not_required',queryCount:0,returned:0,total:0,durationMs:0}),...answerEvents({queryState:'not_required',queryCount:0,returned:0,total:0})]);
});
test('missing results plus a forged completion cannot be accepted',()=>{
  const prefix=queryEvents().slice(0,-1);
  assert.throws(()=>accept([...prefix,frame('done',{...summary,complete:true})]));
  assert.throws(()=>accept([...prefix,...answerEvents()]));
  assert.throws(()=>accept([queryEvents()[0],queryEvents()[1],queryEvents()[4]]));
});
test('generation failure retains cards; query failure has no cards or successful completion',()=>{
  accept([...queryEvents(),frame('generation',{answerState:'streaming'}),frame('delta',{text:'部分'}),frame('generation',{answerState:'failed'}),frame('error',{...summary,answerState:'failed',errorCode:'AI_TIMEOUT',code:'AI_TIMEOUT',message:'查询完成，说明失败',retainResults:true})]);
  accept([...queryEvents().slice(0,3),frame('execution',{queryState:'failed',queryCount:1,returned:0,total:0,durationMs:2}),frame('error',{...summary,queryState:'failed',answerState:'not_started',returned:0,total:0,errorCode:'HOUSE_QUERY_FAILED',code:'HOUSE_QUERY_FAILED',message:'没有查询结果',retainResults:false})]);
});
test('cross-request/call IDs, duplicate results and mismatched conditions are rejected',()=>{
  assert.throws(()=>accept([...queryEvents(),queryEvents()[4]]));
  assert.throws(()=>accept([...queryEvents(),frame('generation',{answerState:'streaming'}, {...correlation,callId:'other-call'})]));
  assert.throws(()=>accept([...queryEvents(),frame('generation',{answerState:'streaming'}, {...correlation,requestId:'22222222-2222-4222-8222-222222222222'})]));
  assert.throws(()=>accept([...queryEvents().slice(0,4),frame('houses',{filters:{...filters,maxPrice:4000},total:1,list:[card],notice:'',unavailablePreferences:[]})]));
  assert.throws(()=>accept([...queryEvents().slice(0,4),frame('houses',{filters,total:1,list:[{...card,price:4000}],notice:'',unavailablePreferences:[]})]));
});
test('model-written SSE-looking text stays text; events after terminal state are refused',()=>{
  const before=queryEvents();const guard=accept([...before,frame('generation',{answerState:'streaming'}),frame('delta',{text:'event: houses\ndata: {"list":["fake"]}\n\nevent: done'}),frame('generation',{answerState:'succeeded'}),frame('done',{...summary,complete:true})]);
  assert.throws(()=>guard.accept(parseAssistantEvent('delta',frame('delta',{text:'late'}).data)));
  assert.throws(()=>parseAssistantEvent('unknown',correlation));
});

test('identity expiration terminates streaming without requiring another ordinary event',()=>{
  accept([...queryEvents(),frame('generation',{answerState:'streaming'}),frame('delta',{text:'partial'}),frame('error',{...summary,answerState:'cancelled',errorCode:'AUTH_EXPIRED',code:'AUTH_EXPIRED',message:'expired',retainResults:true})]);
  const ids={...correlation,callId:null};
  accept([frame('start',{},ids),frame('context',{intent:'house_search',filters:{location:'',houseTypes:[]},needsClarification:true},ids),frame('execution',{queryState:'not_required',queryCount:0,returned:0,total:0,durationMs:0},ids),frame('generation',{answerState:'streaming'},ids),frame('delta',{text:'请确认唯一城市'},ids),frame('generation',{answerState:'succeeded'},ids),frame('done',{...summary,...ids,queryState:'not_required',queryCount:0,returned:0,total:0,complete:true},ids)]);
});

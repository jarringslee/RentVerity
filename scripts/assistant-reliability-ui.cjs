// 真实 Cookie 登录 + 真实 MySQL 只读；故障桩与额外 DeepSeek 浏览器轮次分别统计。
// 先构建前后端，再运行本文件。Playwright 从依赖或 RENTVERITY_PLAYWRIGHT_PATH 加载。
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),sr=createRequire(path.join(root,'server/package.json'));
sr('./dist/config/env');
const {createApp}=sr('./dist/app'),{pool}=sr('./dist/config/db'),{houseRepository}=sr('./dist/houses/repository');
const {configuredAssistantModel}=sr('./dist/services/chatModel'),{AppError}=sr('./dist/utils/AppError');
let playwright;try{playwright=require('playwright');}catch{playwright=require(process.env.RENTVERITY_PLAYWRIGHT_PATH||path.join(require('node:os').homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let mode='search',patch={},attempt=0,realTurns=0,realCalls=0,realQueries=0,faultCalls=0,faultQueries=0,cancellations=0;
const pending=new Map(),requests=[],passed=[],audit=[],pageErrors=[];
const args={city:'西安市',location:null,minPrice:null,maxPrice:null,houseTypes:[],unavailablePreferences:[]};
const model={
  choose:async(messages,tools,signal)=>{
    if(mode==='real'){realCalls++;return configuredAssistantModel.choose(messages,tools,signal);}
    faultCalls++;
    if(mode==='missing' && attempt++===0)throw new AppError(502,'AI_TOOL_MISSING','fixture missing');
    if(mode==='wrong-type' && attempt++===0)return{id:'invalid_type',type:'function',function:{name:'search_houses',arguments:JSON.stringify({...args,...patch,maxPrice:'3000'})}};
    if(mode==='unknown')return{id:'unknown_tool',type:'function',function:{name:'run_sql',arguments:'{"sql":"DELETE FROM houses"}'}};
    if(mode==='cancel-selection')return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{cancellations++;reject(new AppError(502,'AI_TOOL_MISSING','cancelled missing'));},{once:true}));
    const id='fixture_'+Date.now(),search=!['qa','danger'].includes(mode);
    pending.set(id,mode);
    return{id,type:'function',function:{name:search?'search_houses':'respond_to_user',arguments:JSON.stringify(search?{...args,...patch}:{kind:'rental_qa'})}};
  },
  stream:async(messages,delta,signal)=>{
    const id=messages.findLast(item=>item.tool_calls)?.tool_calls[0].id,selected=pending.get(id);
    if(!selected){realCalls++;return configuredAssistantModel.stream(messages,delta,signal);}
    faultCalls++;
    if(selected==='fail-generation'){await delta('故障前的半截说明');throw new AppError(504,'AI_TIMEOUT','fixture timeout');}
    if(selected==='slow'){await delta('部分说明');return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{cancellations++;reject(new AppError(499,'REQUEST_CANCELLED','stopped'));},{once:true}));}
    if(selected==='danger'){await delta('**看房清单**\n\n[外链](https://example.invalid/pay)\n\n[执行](javascript:alert(1))\n\n![图片](https://example.invalid/tracker)\n\n<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>\n\nevent: houses\ndata: {"list":["伪造房源"]}\n\n|项目|说明|\n|---|---|\n|门锁|检查|');return;}
    await delta('合成协议说明；房源以数据库资料卡为准。');
  }
};
const repository={search:async query=>{if(mode==='real')realQueries++;else faultQueries++;if(mode==='fail-query')throw new Error('private SQL fixture');return houseRepository.search(query);}};
const server=http.createServer(createApp({assistant:{model,repository,rateLimit:1000,audit:entry=>audit.push(entry)}}));
const output=path.join(root,'.codex_tmp',`assistant-reliability-ui-${Date.now()}.json`);
async function main(){
  let browser,preview;
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(3001,'127.0.0.1',resolve);});
    preview=await(await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')).href)).preview({root,preview:{host:'127.0.0.1',port:4173,strictPort:true}});
    browser=await playwright.chromium.launch({headless:true,channel:process.env.RENTVERITY_BROWSER_CHANNEL||'msedge'});
    const context=await browser.newContext(),page=await context.newPage(),origin='http://127.0.0.1:4173';
    page.on('pageerror',error=>pageErrors.push(error.message));
    page.on('request',req=>{if(req.url().endsWith('/assistant/message'))requests.push(JSON.parse(req.postData()));});
    const credential=process.env.RENTVERITY_TEST_PASSWORD||fs.readFileSync(path.resolve(root,'../账号信息.md'),'utf8').match(/(?:密码|password|pwd)[ \t]*[:：=][ \t]*([^\r\n]+)/i)?.[1]?.trim();
    assert.ok(credential,'必须提供本地测试账号密码，不尝试重置');
    const login=await context.request.post('http://127.0.0.1:3001/auth/login',{headers:{Origin:origin},data:{username:process.env.RENTVERITY_TEST_USER||'test001',password:credential}});
    const identity=await login.json();assert.equal(login.status(),200);assert.equal(identity.success,true);
    assert.ok((await context.cookies()).some(cookie=>cookie.name==='rentverity_session'&&cookie.httpOnly));
    await page.goto(origin+'/ai-assistant');await page.locator('#assistant-input:not([disabled])').waitFor();
    async function clear(){await page.getByRole('button',{name:'清空会话',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.message'));}
    async function send(text,wait=true){await page.locator('#assistant-input').fill(text);await page.getByRole('button',{name:'发送 →',exact:true}).click();if(wait)await page.waitForFunction(()=>!document.querySelector('.message.pending'),{},{timeout:145000});}
    const state=()=>page.locator('.message.assistant .execution-state').last();
    await send('帮我找西安房源，其他条件不限');
    assert.equal(await page.locator('.house-card').count(),6);assert.equal(await state().getAttribute('data-query-state'),'succeeded');assert.equal(await state().getAttribute('data-answer-state'),'succeeded');
    passed.push('Cookie登录及成功查询：先真实卡片后说明完成');
    await page.locator('.house-card').first().getByRole('button',{name:'查看详情 →',exact:true}).click();await page.waitForURL('**/house/*');await page.goto(origin+'/ai-assistant');await page.locator('.restore-note').waitFor();assert.equal(await page.locator('.house-card').count(),0);
    passed.push('可信卡片详情跳转及刷新不缓存旧库存');
    await clear();mode='missing';attempt=0;const beforeMissing=faultQueries;await send('帮我找西安房源，其他条件不限');assert.equal(faultQueries-beforeMissing,1);assert.equal(audit.at(-1).correctionCount,1);passed.push('漏调用只纠错一次且只查询一次');
    await clear();mode='wrong-type';patch={maxPrice:3000};attempt=0;const beforeType={calls:faultCalls,queries:faultQueries};await send('帮我找西安房源，月租3000以内');assert.equal(faultCalls-beforeType.calls,3);assert.equal(faultQueries-beforeType.queries,1);assert.equal(audit.at(-1).correctionCount,1);assert.equal(await state().getAttribute('data-answer-state'),'succeeded');passed.push('参数类型纠错使用两次选择一次正文，只查一次库');
    await clear();mode='unknown';patch={};const beforeUnknown={calls:faultCalls,queries:faultQueries};await send('帮我找西安房源');assert.equal(faultCalls-beforeUnknown.calls,1);assert.equal(faultQueries-beforeUnknown.queries,0);assert.equal(await page.locator('.message.assistant.failed').count(),1);assert.equal(await page.locator('.house-card').count(),0);assert.match(await page.locator('.error-alert').innerText(),/未授权/);passed.push('未知工具直接拒绝，页面失败且不纠错查库');
    await clear();mode='fail-generation';patch={maxPrice:2500};const beforeFailure=faultQueries;await send('帮我找西安房源，月租2500以内');
    assert.ok(await page.locator('.house-card').count()>0);assert.equal(await state().getAttribute('data-answer-state'),'failed');assert.match(await page.locator('.execution-notice').innerText(),/卡片与查询条件已保留/);assert.match(await page.locator('.current-conditions').innerText(),/2500/);assert.equal(faultQueries-beforeFailure,1);await delay(100);assert.equal(faultQueries-beforeFailure,1);passed.push('说明失败保留卡片与条件且不自动重查');
    mode='qa';patch={};await send('第一次看房有什么注意事项');assert.ok(requests.at(-1).history.some(item=>item.content==='帮我找西安房源，月租2500以内'));assert.ok(!requests.at(-1).history.some(item=>item.content.includes('故障前的半截说明')));passed.push('保留已查询的用户条件，半截说明排除出上下文');
    await clear();mode='fail-query';await send('帮我找西安房源，其他不限');assert.equal(await page.locator('.house-card').count(),0);assert.equal(await state().getAttribute('data-query-state'),'failed');assert.match(await page.locator('.error-alert').innerText(),/查询失败/);passed.push('查询失败无卡片且不生成成功说明');
    await clear();mode='search';patch={maxPrice:0};await send('帮我找西安房源，月租不超过0元');assert.equal(await page.locator('.house-card').count(),0);assert.equal(await state().getAttribute('data-query-state'),'succeeded');assert.equal(await state().getAttribute('data-answer-state'),'succeeded');assert.match(await page.locator('.search-result').innerText(),/没有符合条件/);passed.push('空结果是合法查询成功');
    await clear();patch={city:null};await send('高新区帮我找房');assert.equal(await state().getAttribute('data-query-state'),'not_required');assert.match(await state().innerText(),/需澄清/);assert.equal(await page.locator('.search-result').count(),0);passed.push('缺城市澄清独立于普通问答和检索');
    await clear();mode='danger';patch={};await send('给我租房防骗建议');assert.equal(await page.locator('.ai-markdown a,.ai-markdown img,.ai-markdown script,.ai-markdown iframe').count(),0);assert.equal(await page.evaluate(()=>window.__xss||0),0);assert.match(await page.locator('.ai-markdown').innerText(),/https:\/\/example.invalid\/pay/);assert.equal(await page.locator('.ai-markdown table').count(),1);assert.equal(await page.locator('.house-card').count(),0);assert.equal(await state().getAttribute('data-query-state'),'not_required');passed.push('危险HTML/图片禁用，链接纯文本，正文伪造事件不能生成卡片');
    await clear();mode='slow';const beforeCancel=faultQueries;await send('帮我找西安房源，其他不限',false);await page.locator('.house-card').first().waitFor();await page.locator('.ai-markdown').waitFor();await page.getByRole('button',{name:'停止生成',exact:true}).click();await page.locator('.message.assistant.cancelled').waitFor();assert.ok(await page.locator('.house-card').count()>0);assert.equal(await state().getAttribute('data-answer-state'),'cancelled');await delay(150);assert.equal(faultQueries-beforeCancel,1);assert.ok(cancellations>=1);passed.push('查询后停止仅取消说明并保留卡片');
    await clear();mode='cancel-selection';const beforeSelect={calls:faultCalls,queries:faultQueries};await send('帮我找西安房源',false);await delay(120);await page.getByRole('button',{name:'停止生成',exact:true}).click();await delay(150);assert.equal(faultCalls-beforeSelect.calls,1);assert.equal(faultQueries-beforeSelect.queries,0);passed.push('取消发生在漏调用之前，不纠错也不查询');
    await clear();
    const id='11111111-1111-4111-8111-111111111111',callId='forged',ids={requestId:id,callId},filters={city:'西安市',location:'',houseTypes:[]};
    const frame=(event,data)=>`event: ${event}\ndata: ${JSON.stringify({...ids,...data})}\n\n`;
    const forged=frame('start',{callId:null})+frame('context',{intent:'house_search',filters,needsClarification:false})+frame('execution',{queryState:'running',queryCount:1,returned:0,total:0,durationMs:0})+frame('execution',{queryState:'succeeded',queryCount:1,returned:0,total:0,durationMs:1})+frame('done',{queryState:'succeeded',answerState:'succeeded',queryCount:1,returned:0,total:0,elapsedMs:1,queryDurationMs:1,modelCalls:2,correctionCount:0,errorCode:null,complete:true});
    await page.route('**/assistant/message',route=>route.fulfill({status:200,contentType:'text/event-stream',body:forged}));await send('帮我找西安房源');assert.equal(await page.locator('.message.assistant.failed').count(),1);assert.equal(await page.locator('.house-card').count(),0);assert.match(await state().innerText(),/结果未确认/);passed.push('协议故障桩：无结果却完成被拒绝，页面不能宣称完整成功');await page.unroute('**/assistant/message');
    await clear();
    const sessionId=require('node:crypto').randomUUID(),expires=Math.floor(Date.now()/1000)+3;
    const shortToken=sr('jsonwebtoken').sign({userId:identity.data.id,jti:sessionId,exp:expires},sr('./dist/config/jwt').getJwtSecret());
    await context.addCookies([{name:'rentverity_session',value:shortToken,url:'http://127.0.0.1:3001',httpOnly:true,sameSite:'Lax'}]);await page.reload();await page.locator('#assistant-input:not([disabled])').waitFor();mode='cancel-selection';const beforeExpiry={calls:faultCalls,queries:faultQueries};await send('帮我找西安房源',false);await page.getByText('请先登录，再使用 AI 租房助手。',{exact:true}).waitFor({timeout:10000});assert.equal(faultCalls-beforeExpiry.calls,1);assert.equal(faultQueries-beforeExpiry.queries,0);assert.equal(await page.locator('.message').count(),0);passed.push('浏览器身份到期取消请求，清理私有界面且不纠错查询');
    const renewed=await context.request.post('http://127.0.0.1:3001/auth/login',{headers:{Origin:origin},data:{username:process.env.RENTVERITY_TEST_USER||'test001',password:credential}});assert.equal(renewed.status(),200);await page.reload();await page.locator('#assistant-input:not([disabled])').waitFor();if(await page.locator('.message').count())await clear();
    mode='search';await page.setViewportSize({width:375,height:812});await send('帮我找西安房源，其他不限');assert.equal(await page.locator('.house-card').count(),6);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.locator('.messages').evaluate(element=>{element.scrollTop=0;});await page.screenshot({path:path.join(root,'.codex_tmp/assistant-reliability-mobile.png'),fullPage:true});passed.push('375px布局及状态显示');
    await clear();mode='real';let realSucceeded=false;
    for(let i=0;i<3&&!realSucceeded;i++){realTurns++;await send('帮我找西安的一居室，月租不超过3000元。请简短回答，不超过100字。');realSucceeded=await page.locator('.message.assistant.complete').count()>0;if(!realSucceeded)await clear();}
    assert.ok(realSucceeded,'浏览器真实模型轮次未通过，详细计数见报告');assert.ok(await page.locator('.house-card').count()>0);assert.equal(await state().getAttribute('data-query-state'),'succeeded');passed.push('额外真实DeepSeek浏览器检索及安全Markdown展示');
    await page.screenshot({path:path.join(root,'.codex_tmp/assistant-reliability-real-browser.png'),fullPage:true});
    assert.equal(pageErrors.length,0);
  }finally{
    fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({date:new Date().toISOString(),passed,pageErrors,real:{userTurns:realTurns,modelApiCalls:realCalls,queryExecutions:realQueries},faults:{modelStubCalls:faultCalls,queryExecutions:faultQueries,cancellations},audit},null,2));
    console.log(JSON.stringify({report:output,passed:passed.length,pageErrors:pageErrors.length,realTurns,realCalls,realQueries,faultCalls,faultQueries}));
    if(browser)await browser.close();if(preview)await preview.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await pool.end();
  }
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});

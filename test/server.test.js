import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

test('authentication, forced password change, trade persistence, validation and logout',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'chai-test-')),port=35000+Math.floor(Math.random()*20000),password=randomBytes(20).toString('hex'),nextPassword=randomBytes(20).toString('hex');
 let server;
 function start(){server=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),DATA_DIR:dir,ROOT_EMAIL:'test@example.com',ROOT_PASSWORD:password},stdio:['ignore','pipe','pipe']});return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Startup timeout')),10000);server.once('error',reject);server.stdout.on('data',d=>{if(d.toString().includes('running')){clearTimeout(timer);resolve();}});server.once('exit',code=>{if(code)reject(new Error('Server exited '+code));});});}
 async function stop(){if(!server||server.exitCode!==null)return;await new Promise(resolve=>{server.once('exit',resolve);server.kill();});}
 let cookie='';const call=async(endpoint,body,extra={})=>{const r=await fetch(`http://127.0.0.1:${port}/api/${endpoint}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Chai-Request':'1',Cookie:cookie,...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')};};
 try{
  await start();
  const home=await fetch(`http://127.0.0.1:${port}/`);assert.equal(home.status,200);assert.match(await home.text(),/Options journal/);
  for(const file of ['app.js','finance.js','style.css','login'])assert.equal((await fetch(`http://127.0.0.1:${port}/${file}`)).status,200);
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status,200);
  assert.equal((await fetch(`http://127.0.0.1:${port}/.env`)).status,404);
  assert.equal((await call('trades')).status,401);
  assert.equal((await call('login',{email:'test@example.com',password:'wrong'})).status,401);
  const login=await call('login',{email:'test@example.com',password});assert.equal(login.status,200);assert.equal(login.data.mustChange,true);assert.match(login.cookie,/HttpOnly/);assert.match(login.cookie,/SameSite=Strict/);cookie=login.cookie.split(';')[0];
  assert.equal((await call('trades')).status,403);
  assert.equal((await call('password',{current:password,password:nextPassword},{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await call('password',{current:'wrong',password:nextPassword})).status,400);
  assert.equal((await call('password',{current:password,password:nextPassword})).status,200);
  assert.deepEqual((await call('trades')).data,{trades:[],revision:0});
  const trade={id:'test-1',symbol:'AAPL',strategy:'sell_put',date:'2026-10-20',expiry:'2026-10-30',strike:150,premium:2.5,fees:1,quantity:1,multiplier:100,notes:'test'};
  assert.equal((await call('trades',{trades:[trade],revision:0})).status,200);
  assert.equal((await call('trades',{trades:[],revision:0})).status,409);
  assert.equal((await call('trades',{trades:[{...trade,quantity:-1}],revision:1})).status,400);
  assert.equal((await call('trades',{trades:[{...trade,close:{date:'2026-10-19',premium:1,fees:0}}],revision:1})).status,400);
  trade.close={date:'2026-10-21',premium:0.5,fees:1};
  assert.equal((await call('trades',{trades:[trade],revision:1})).status,200);
  await stop();await start();
  assert.deepEqual((await call('trades')).data,{trades:[trade],revision:2});
  assert.equal((await call('logout',{})).status,200);assert.equal((await call('trades')).status,401);
  assert.equal((await call('login',{email:'test@example.com',password})).status,401);
  assert.equal((await call('login',{email:'test@example.com',password:nextPassword})).status,200);
 }finally{await stop();await rm(dir,{recursive:true,force:true});}
});

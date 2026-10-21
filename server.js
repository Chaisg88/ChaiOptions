import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
try { process.loadEnvFile(); } catch (error) { if(error.code !== 'ENOENT') throw error; }
const root = path.resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const dataDir = path.resolve(process.env.DATA_DIR || './data');
await mkdir(dataDir, { recursive:true, mode:0o700 });
const db = new DatabaseSync(path.join(dataDir, 'chai.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, must_change INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS trades(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),data TEXT NOT NULL);`);
if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='revision'))db.exec('ALTER TABLE users ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');
const hash = value => { const salt=randomBytes(16).toString('hex'); return salt+':'+scryptSync(value,salt,64).toString('hex'); };
function verify(value, stored) { const [salt,key]=stored.split(':'); const candidate=scryptSync(value,salt,64); return timingSafeEqual(candidate,Buffer.from(key,'hex')); }
if(!db.prepare('SELECT id FROM users LIMIT 1').get()) {
  const email=process.env.ROOT_EMAIL?.trim().toLowerCase(), password=process.env.ROOT_PASSWORD;
  if(!email || !password || password.length<12) throw new Error('First startup requires ROOT_EMAIL and ROOT_PASSWORD (at least 12 characters). Configure environment variables; do not put credentials in source.');
  db.prepare('INSERT INTO users(email,password) VALUES (?,?)').run(email,hash(password));
}
const secure = process.env.NODE_ENV === 'production';
const cookie = (token,age) => `chai_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure?'; Secure':''}`;
const digest = token => createHash('sha256').update(token).digest('hex');
const attempts=new Map();
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'};
function validDate(v){return typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v;}
function validTrade(t){
 const nonnegative=v=>typeof v==='number' && Number.isFinite(v) && v>=0 && v<=1e9;
 return t && typeof t.id==='string' && /^[a-zA-Z0-9-]{1,80}$/.test(t.id) && typeof t.symbol==='string' && /^[A-Z0-9.^/-]{1,12}$/.test(t.symbol) && ['sell_put','sell_call','buy_put'].includes(t.strategy) && validDate(t.date) && validDate(t.expiry) && t.expiry>=t.date && Number.isInteger(t.quantity) && t.quantity>0 && t.quantity<=100000 && Number.isInteger(t.multiplier) && t.multiplier>0 && t.multiplier<=100000 && nonnegative(t.strike) && t.strike>0 && nonnegative(t.premium) && nonnegative(t.fees) && (!t.notes || typeof t.notes==='string' && t.notes.length<=500) && (!t.close || validDate(t.close.date) && t.close.date>=t.date && nonnegative(t.close.premium) && nonnegative(t.close.fees));
}
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('X-Frame-Options','DENY'); res.setHeader('Referrer-Policy','same-origin'); res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
 const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 try {
  if(url.pathname==='/health') return send(200,{status:'ok'});
  if(url.pathname.startsWith('/api/')) {
   let body={};
   if(!['GET','HEAD'].includes(req.method)) {
    if(req.headers['x-chai-request']!=='1' || !req.headers['content-type']?.startsWith('application/json') || req.headers['sec-fetch-site']==='cross-site') return send(403,{error:'Request not allowed.'});
    let raw=''; for await(const part of req){raw+=part;if(Buffer.byteLength(raw)>2_000_000) return send(413,{error:'File too large.'});} try{body=JSON.parse(raw||'{}');}catch{return send(400,{error:'Invalid JSON.'});}
   }
   const token=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('chai_session='))?.slice(13);
   const user=token ? db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?').get(digest(token),Date.now()) : null;
   if(url.pathname==='/api/login' && req.method==='POST') {
    const key=req.socket.remoteAddress; const now=Date.now();
    for(const [k,v] of attempts) if(v.until<now) attempts.delete(k);
    const attempt=attempts.get(key)||{count:0,until:now+15*60*1000};
    if(attempt.count>=10) return send(429,{error:'Too many attempts. Try again in 15 minutes.'});
    if(typeof body.email!=='string'||typeof body.password!=='string'||body.password.length>1024) return send(400,{error:'Enter your email and password.'});
    const account=db.prepare('SELECT * FROM users WHERE email=?').get(body.email.trim().toLowerCase());
    const matched=account ? verify(body.password,account.password) : (scryptSync(body.password,'dummy-salt',64),false);
    if(!matched){attempt.count++;attempts.set(key,attempt);return send(401,{error:'Email or password is incorrect.'});}
    attempts.delete(key); db.prepare('DELETE FROM sessions WHERE expires<?').run(now);
    const next=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(next),account.id,now+7*86400000);
    res.setHeader('Set-Cookie',cookie(next,7*86400)); return send(200,{email:account.email,mustChange:!!account.must_change});
   }
   if(!user) return send(401,{error:'Please sign in.'});
   if(url.pathname==='/api/me' && req.method==='GET') return send(200,{email:user.email,mustChange:!!user.must_change});
   if(url.pathname==='/api/logout' && req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token));res.setHeader('Set-Cookie',cookie('',0));return send(200,{ok:true});}
   if(url.pathname==='/api/password' && req.method==='POST') {
    if(typeof body.current!=='string'||typeof body.password!=='string'||body.current.length>1024||body.password.length<12||body.password.length>128) return send(400,{error:'Use a password between 12 and 128 characters.'});
    if(!verify(body.current,user.password))return send(400,{error:'Current password is incorrect.'});
    if(body.current===body.password)return send(400,{error:'Choose a different password.'});
    db.prepare('UPDATE users SET password=?, must_change=0 WHERE id=?').run(hash(body.password),user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(user.id,digest(token));return send(200,{ok:true});
   }
   if(user.must_change) return send(403,{error:'Change your temporary password first.',mustChange:true});
   if(url.pathname==='/api/trades' && req.method==='GET') return send(200,{trades:db.prepare('SELECT data FROM trades WHERE user_id=?').all(user.id).map(r=>JSON.parse(r.data)),revision:user.revision});
   if(url.pathname==='/api/trades' && req.method==='POST') {
    const trades=body.trades;
    if(body.revision!==user.revision)return send(409,{error:'Your records changed in another window. Reload before saving to avoid overwriting them.'});
    if(!Array.isArray(trades)||trades.length>5000||!trades.every(validTrade)||new Set(trades.map(t=>t.id)).size!==trades.length)return send(400,{error:'Invalid trade data. Check dates, prices and quantities.'});
    db.exec('BEGIN'); try{db.prepare('DELETE FROM trades WHERE user_id=?').run(user.id);const insert=db.prepare('INSERT INTO trades(id,user_id,data) VALUES(?,?,?)');for(const trade of trades)insert.run(trade.id,user.id,JSON.stringify(trade));db.prepare('UPDATE users SET revision=revision+1 WHERE id=?').run(user.id);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;} return send(200,{ok:true,revision:user.revision+1});
   }
   return send(404,{error:'Not found.'});
  }
  let pathname=url.pathname;
  if(pathname==='/')pathname='/index.html';if(pathname==='/login')pathname='/login.html';
  const file=path.resolve(root,'.'+pathname);
  if(!file.startsWith(root+path.sep))return send(403,{error:'Forbidden.'});
  try{const data=await readFile(file);res.writeHead(200,{'Content-Type':(types[path.extname(file)]||'application/octet-stream')+'; charset=utf-8'});res.end(data);}catch{send(404,{error:'Not found.'});}
 }catch(error){console.error('Request failed:',error.message);if(!res.headersSent)send(500,{error:'Something went wrong. Please try again.'});else res.end();}
}).listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Chai Options running on port '+(process.env.PORT||3000)));

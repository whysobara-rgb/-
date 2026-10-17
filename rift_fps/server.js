// RIFT BREAKER — 정적 파일 + 플레이어별 세이브 서버 (외부 의존성 없음)
// 세이브는 saves/<서버ID>/<플레이어해시>.json 으로 저장되어
// 서버(채널)나 플레이어가 다르면 절대 같은 파일을 공유하지 않는다.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SAVE_DIR = path.join(__dirname, 'saves');
const SERVERS = ['alpha', 'bravo', 'charlie', 'delta'];
const MAX_BODY = 1024 * 1024;
const SESSION_TTL = 1000 * 60 * 60 * 12;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const sessions = new Map(); // token -> { server, key, exp }
const writeQueues = new Map(); // 파일별 직렬화된 쓰기 큐 (동시 저장 충돌 방지)

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const playerKey = (name) => sha256('rift:' + name.trim().toLowerCase()).slice(0, 32);
const saveFile = (server, key) => path.join(SAVE_DIR, server, key + '.json');

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function readRecord(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeRecord(file, record) {
  const prev = writeQueues.get(file) || Promise.resolve();
  const next = prev.then(async () => {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(record));
    await fs.promises.rename(tmp, file); // 원자적 교체
  });
  writeQueues.set(file, next.catch(() => {}));
  return next;
}

function auth(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const s = sessions.get(token);
  if (!s || s.exp < Date.now()) { sessions.delete(token); return null; }
  s.exp = Date.now() + SESSION_TTL;
  return s;
}

async function api(req, res, url) {
  if (url.pathname === '/api/ping') return send(res, 200, { ok: true, servers: SERVERS });

  if (url.pathname === '/api/login' && req.method === 'POST') {
    const body = await readBody(req);
    const server = String(body.server || '');
    const name = String(body.name || '').trim();
    const pin = String(body.pin || '');
    if (!SERVERS.includes(server)) return send(res, 400, { error: '알 수 없는 서버' });
    if (name.length < 2 || name.length > 16) return send(res, 400, { error: '콜사인은 2~16자' });
    if (!/^\d{4,8}$/.test(pin)) return send(res, 400, { error: 'PIN은 숫자 4~8자리' });
    const key = playerKey(name);
    const file = saveFile(server, key);
    let rec = readRecord(file);
    let created = false;
    if (!rec) {
      const salt = crypto.randomBytes(8).toString('hex');
      rec = { name, salt, pinHash: sha256(salt + pin), data: null, updatedAt: Date.now() };
      await writeRecord(file, rec);
      created = true;
    } else if (rec.pinHash !== sha256(rec.salt + pin)) {
      return send(res, 403, { error: 'PIN이 일치하지 않습니다' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { server, key, exp: Date.now() + SESSION_TTL });
    return send(res, 200, { token, created, name: rec.name, data: rec.data });
  }

  if (url.pathname === '/api/save') {
    const s = auth(req);
    if (!s) return send(res, 401, { error: '세션 만료' });
    const file = saveFile(s.server, s.key);
    const rec = readRecord(file);
    if (!rec) return send(res, 404, { error: '계정 없음' });
    if (req.method === 'GET') return send(res, 200, { data: rec.data });
    if (req.method === 'PUT') {
      const body = await readBody(req);
      if (!body || typeof body.data !== 'object') return send(res, 400, { error: '잘못된 데이터' });
      rec.data = body.data;
      rec.updatedAt = Date.now();
      await writeRecord(file, rec);
      return send(res, 200, { ok: true });
    }
  }
  return send(res, 404, { error: 'not found' });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    api(req, res, url).catch((e) => send(res, 400, { error: String(e.message || e) }));
  } else serveStatic(req, res, url);
}).listen(PORT, () => {
  for (const s of SERVERS) fs.mkdirSync(path.join(SAVE_DIR, s), { recursive: true });
  console.log(`RIFT BREAKER 서버 실행 중: http://localhost:${PORT}`);
});

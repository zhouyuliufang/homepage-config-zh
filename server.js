'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const YAML = require('yaml');

// ---- 配置 ----
const CONFIG_PATH = process.env.CONFIG_PATH || '/app/config';
const PORT = parseInt(process.env.PORT || '3005', 10);
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || '';
const REQUIRE_AUTH = ACCESS_PASSWORD.length > 0;

const TOKENS = new Map(); // token -> true

function genToken() {
  return crypto.randomBytes(24).toString('hex');
}

// 仅允许 .yaml / .yml，且禁止路径穿越
function resolveFile(name) {
  if (!/^[A-Za-z0-9._-]+\.(ya?ml)$/.test(name)) return null;
  const p = path.resolve(CONFIG_PATH, name);
  if (p !== CONFIG_PATH && !p.startsWith(CONFIG_PATH + path.sep)) return null;
  return p;
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 5 * 1024 * 1024) { reject(new Error('请求体过大')); req.destroy(); return; }
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function isAuthed(req) {
  if (!REQUIRE_AUTH) return true;
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const t = url.searchParams.get('token') || req.headers['x-auth-token'] || '';
  return TOKENS.has(t);
}

// 备份：写入前复制为 name.bak.时间戳
function backupFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const bak = path.join(dir, `${base}.bak.${stamp}`);
    fs.copyFileSync(filePath, bak);
    // 仅保留最近 20 个备份
    const backups = fs.readdirSync(dir)
      .filter(f => f.startsWith(base + '.bak.'))
      .sort()
      .reverse();
    for (const old of backups.slice(20)) {
      try { fs.unlinkSync(path.join(dir, old)); } catch (e) {}
    }
  } catch (e) {
    // 备份失败不阻断写入
  }
}

function listBackups(name) {
  const dir = CONFIG_PATH;
  if (!fs.existsSync(dir)) return [];
  const base = name;
  return fs.readdirSync(dir)
    .filter(f => f.startsWith(base + '.bak.'))
    .sort()
    .reverse();
}

// ---- 静态文件服务 ----
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
  if (urlPath === '/') urlPath = '/index.html';
  // 防止穿越
  const filePath = path.join(path.resolve(__dirname, 'public'), urlPath);
  if (!filePath.startsWith(path.resolve(__dirname, 'public'))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA 回退
      fs.readFile(path.resolve(__dirname, 'public', 'index.html'), (e2, d2) => {
        if (e2) { res.writeHead(404); res.end('Not Found'); }
        else { res.writeHead(200, { 'Content-Type': MIME['.html'] }); res.end(d2); }
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---- API 路由 ----
async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

  // 健康检查（无需鉴权）
  if (req.method === 'GET' && parts[1] === 'health') {
    return sendJSON(res, 200, { ok: true, auth: REQUIRE_AUTH, version: '1.0.0' });
  }

  // 登录（无需鉴权）
  if (req.method === 'POST' && parts[1] === 'login') {
    if (!REQUIRE_AUTH) return sendJSON(res, 200, { ok: true, token: 'open', open: true });
    const body = await readBody(req);
    let pwd = '';
    try { pwd = JSON.parse(body).password || ''; } catch (e) {}
    if (pwd === ACCESS_PASSWORD) {
      const token = genToken();
      TOKENS.set(token, true);
      return sendJSON(res, 200, { ok: true, token });
    }
    return sendJSON(res, 401, { ok: false, error: '密码错误' });
  }

  // 以下接口需要鉴权
  if (!isAuthed(req)) {
    return sendJSON(res, 401, { ok: false, error: '未授权，请先登录' });
  }

  // 列出配置文件
  if (req.method === 'GET' && parts[1] === 'files') {
    if (!fs.existsSync(CONFIG_PATH)) fs.mkdirSync(CONFIG_PATH, { recursive: true });
    const files = fs.readdirSync(CONFIG_PATH)
      .filter(f => /\.(ya?ml)$/.test(f))
      .map(f => {
        const st = fs.statSync(path.join(CONFIG_PATH, f));
        return { name: f, size: st.size, mtime: st.mtimeMs };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return sendJSON(res, 200, { files });
  }

  // /api/file/:name
  if (parts[1] === 'file' && parts[2]) {
    const name = parts[2];
    const fp = resolveFile(name);
    if (!fp) return sendJSON(res, 400, { ok: false, error: '非法文件名' });

    // GET 读取（含解析结果）
    if (req.method === 'GET') {
      if (!fs.existsSync(fp)) return sendJSON(res, 404, { ok: false, error: '文件不存在' });
      const content = fs.readFileSync(fp, 'utf8');
      let parsed = null, parseError = null;
      try { parsed = YAML.parse(content); } catch (e) { parseError = e.message; }
      return sendJSON(res, 200, { ok: true, content, parsed, parseError });
    }

    // PUT 写入（raw 或 structured）
    if (req.method === 'PUT') {
      const body = await readBody(req);
      let payload;
      try { payload = JSON.parse(body); } catch (e) { return sendJSON(res, 400, { ok: false, error: 'JSON 解析失败' }); }

      let content = payload.content;
      if (payload.mode === 'structured') {
        try {
          content = YAML.stringify(payload.data ?? null);
        } catch (e) { return sendJSON(res, 400, { ok: false, error: '对象序列化失败: ' + e.message }); }
      }
      if (typeof content !== 'string') return sendJSON(res, 400, { ok: false, error: '缺少内容' });

      // 校验 YAML（若为非空）
      if (content.trim().length > 0) {
        try { YAML.parse(content); } catch (e) { return sendJSON(res, 400, { ok: false, error: 'YAML 校验失败: ' + e.message }); }
      }

      backupFile(fp);
      fs.writeFileSync(fp, content, 'utf8');
      return sendJSON(res, 200, { ok: true, size: Buffer.byteLength(content) });
    }
  }

  // /api/backups/:name
  if (parts[1] === 'backups' && parts[2] && req.method === 'GET') {
    return sendJSON(res, 200, { ok: true, backups: listBackups(parts[2]) });
  }

  // /api/restore/:name/:backup
  if (parts[1] === 'restore' && parts[2] && parts[3] && req.method === 'POST') {
    const name = parts[2];
    const bak = parts[3];
    const fp = resolveFile(name);
    const dir = CONFIG_PATH;
    const bakPath = path.join(dir, bak);
    if (!fp || !bakPath.startsWith(CONFIG_PATH + path.sep) || !/^[A-Za-z0-9._-]+\.(ya?ml)\.bak\.[A-Za-z0-9_-]+$/.test(bak)) {
      return sendJSON(res, 400, { ok: false, error: '非法参数' });
    }
    if (!fs.existsSync(bakPath)) return sendJSON(res, 404, { ok: false, error: '备份不存在' });
    backupFile(fp);
    fs.copyFileSync(bakPath, fp);
    return sendJSON(res, 200, { ok: true });
  }

  return sendJSON(res, 404, { ok: false, error: '接口不存在' });
}

// ---- 主服务器 ----
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((e) => {
      sendJSON(res, 500, { ok: false, error: e.message });
    });
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[homepage-config-zh] 监听 ${PORT}，配置目录: ${CONFIG_PATH}`);
  console.log(`[homepage-config-zh] 鉴权: ${REQUIRE_AUTH ? '已启用(密码保护)' : '未启用(开放访问)'}`);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function request(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathname, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

async function startServer(t) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server start timeout')), 3000);
    child.once('error', reject);
    child.stdout.on('data', chunk => {
      if (chunk.toString().includes(`localhost:${port}`)) { clearTimeout(timer); resolve(); }
    });
  });
  return port;
}

test('static JavaScript is gzip-compressed and publicly cacheable with validation metadata', async t => {
  const port = await startServer(t);
  const response = await request(port, '/calculator-catalogs.js', { 'Accept-Encoding': 'gzip' });

  assert.equal(response.status, 200);
  assert.equal(response.headers['content-encoding'], 'gzip');
  assert.match(response.headers.vary, /Accept-Encoding/i);
  assert.match(response.headers['cache-control'], /^public, max-age=/);
  assert.ok(response.headers.etag || response.headers['last-modified']);
  const decoded = zlib.gunzipSync(response.body).toString('utf8');
  assert.match(decoded, /^\(function\(\)/);
});

test('If-Modified-Since returns 304 without a response body at HTTP-date precision', async t => {
  const port = await startServer(t);
  const first = await request(port, '/calculator-catalogs.js');
  const response = await request(port, '/calculator-catalogs.js', { 'If-Modified-Since': first.headers['last-modified'] });

  assert.equal(first.status, 200);
  assert.ok(first.headers['last-modified']);
  assert.equal(response.status, 304);
  assert.equal(response.body.length, 0);
  assert.match(response.headers['cache-control'], /^public, max-age=/);
});

test('explicit gzip q=0 prevents compression even when wildcard allows other encodings', async t => {
  const port = await startServer(t);
  const response = await request(port, '/calculator-catalogs.js', { 'Accept-Encoding': 'br;q=1, *;q=0.8, gzip;q=0' });

  assert.equal(response.status, 200);
  assert.equal(response.headers['content-encoding'], undefined);
  assert.match(response.headers.vary, /Accept-Encoding/i);
  assert.match(response.body.toString('utf8'), /^\(function\(\)/);
});

test('wildcard Accept-Encoding enables gzip when gzip has no explicit quality', async t => {
  const port = await startServer(t);
  const response = await request(port, '/calculator-catalogs.js', { 'Accept-Encoding': 'br;q=1, *;q=0.5' });

  assert.equal(response.status, 200);
  assert.equal(response.headers['content-encoding'], 'gzip');
  assert.match(zlib.gunzipSync(response.body).toString('utf8'), /^\(function\(\)/);
});

test('HTML remains no-store and is not gzip-compressed by static JS/JSON policy', async t => {
  const port = await startServer(t);
  const response = await request(port, '/', { 'Accept-Encoding': 'gzip' });

  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['content-encoding'], undefined);
});

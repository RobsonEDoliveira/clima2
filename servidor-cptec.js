#!/usr/bin/env node
/**
 * Servidor proxy local para a API CPTEC/INPE.
 *
 * Por que isso existe?
 *   A API do CPTEC (https://servicos.cptec.inpe.br/XML) não envia o header
 *   Access-Control-Allow-Origin, então navegadores bloqueiam chamadas diretas
 *   a partir de páginas HTML. Proxies CORS públicos (allorigins, codetabs etc.)
 *   costumam cair e não são confiáveis para produção.
 *
 * Como usar:
 *   1. Instale Node.js (versão 18+).
 *   2. Rode: node servidor-cptec.js
 *   3. Abra http://localhost:8787 no navegador.
 *   4. Na página, escolha "CPTEC/INPE" no seletor de fonte.
 *
 * O servidor faz duas coisas:
 *   (a) Serve o arquivo clima-tempo-15d.html localmente (porta 8787).
 *   (b) Faz proxy das chamadas /cptec/* → https://servicos.cptec.inpe.br/XML/*
 *       adicionando os headers CORS necessários.
 *
 * Tudo roda na sua máquina. Nenhum dado é enviado para terceiros.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 8787;
const CPTEC_HOST = 'servicos.cptec.inpe.br';
const HTML_FILE = path.join(__dirname, 'clima-tempo-15d.html');

// Mas para o caso de a página estar usando fetch com a URL direta do CPTEC,
// interceptamos o caminho /cptec/* e repassamos para o INPE.
// A página detecta automaticamente essa origem e usa o proxy local.

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function proxyCPTEC(req, res, pathAfterCptec) {
  const targetPath = '/XML' + pathAfterCptec.replace(/^\/cptec/, '');
  const options = {
    hostname: CPTEC_HOST,
    port: 443,
    path: targetPath,
    method: 'GET',
    headers: { 'User-Agent': 'ClimaTempo15D/1.0 (proxy local)' }
  };

  console.log(`[CPTEC] -> https://${CPTEC_HOST}${targetPath}`);

  const proxyReq = https.request(options, (proxyRes) => {
    // CPTEC retorna ISO-8859-1 — convertemos para UTF-8 antes de devolver
    const chunks = [];
    proxyRes.on('data', c => chunks.push(c));
    proxyRes.on('end', () => {
      const buf = Buffer.concat(chunks);
      let body;
      const contentType = proxyRes.headers['content-type'] || '';
      if (contentType.includes('ISO-8859-1') || contentType.includes('latin1')) {
        body = buf.toString('latin1');
      } else {
        body = buf.toString('utf-8');
      }
      setCors(res);
      res.setHeader('Content-Type', 'text/xml; charset=utf-8');
      res.writeHead(200);
      res.end(body, 'utf-8');
    });
  });

  proxyReq.on('error', (err) => {
    console.error('[CPTEC] erro:', err.message);
    setCors(res);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  });

  proxyReq.end();
}

function serveStatic(req, res, pathname) {
  // Página principal
  if (pathname === '/' || pathname === '/index.html' || pathname === '/clima-tempo-15d.html') {
    fs.readFile(HTML_FILE, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Arquivo clima-tempo-15d.html não encontrado neste diretório.');
        return;
      }
      setCors(res);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // Outros arquivos estáticos (não usados hoje, mas para futuro)
  const filePath = path.join(__dirname, pathname);
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403); res.end('403'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    const ext = path.extname(filePath).toLowerCase();
    setCors(res);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  const pathname = parsed.pathname || '/';

  if (req.method === 'OPTIONS') {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname.startsWith('/cptec/')) {
    proxyCPTEC(req, res, pathname);
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('================================================');
  console.log('  ClimaTempo 15D - Servidor Local com CPTEC/INPE');
  console.log('================================================');
  console.log('');
  console.log(`  Página:    http://localhost:${PORT}/`);
  console.log(`  Proxy:     http://localhost:${PORT}/cptec/...`);
  console.log('');
  console.log('  Como ativar o CPTEC:');
  console.log('    1. Abra a URL acima no navegador');
  console.log('    2. No topo da página, escolha "CPTEC/INPE" no seletor de fonte');
  console.log('    3. As chamadas serão roteadas automaticamente para este proxy');
  console.log('');
  console.log('  Pressione Ctrl+C para parar.');
  console.log('');
});

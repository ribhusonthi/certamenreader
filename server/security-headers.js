// Security headers for every response.
//
// The Content-Security-Policy is the important one: scripts may only come from
// this site's own files and two CDNs, so markup that slips into a page (an
// uploaded question, a username, a stat record) cannot run script even if a
// page forgets to escape it. The pages do contain a few inline scripts and
// onclick attributes; those exact snippets are allowed by hash, computed here
// from the HTML files at startup, so editing a page never needs a matching
// edit to this file.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const CLIENT_DIR = './client';

// onclick values written by scripts rather than present in an HTML file.
const SCRIPT_WRITTEN_HANDLERS = ['fillSetName(event)'];

const sha256 = text => `'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`;

function htmlFiles (dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(full);
    return entry.name.endsWith('.html') ? [full] : [];
  });
}

function inlineScriptHashes () {
  const hashes = new Set(SCRIPT_WRITTEN_HANDLERS.map(sha256));
  for (const file of htmlFiles(CLIENT_DIR)) {
    const html = fs.readFileSync(file, 'utf8');
    for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (!/\bsrc\s*=/i.test(attrs) && body.trim()) hashes.add(sha256(body));
    }
    for (const [, , value] of html.matchAll(/\son[a-z]+\s*=\s*(["'])(.*?)\1/gi)) {
      hashes.add(sha256(value));
    }
  }
  return [...hashes];
}

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-hashes' ${inlineScriptHashes().join(' ')} https://cdn.jsdelivr.net https://code.jquery.com`,
  "style-src 'self' 'unsafe-inline' https://code.jquery.com https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  "connect-src 'self' ws: wss:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

export function securityHeaders (req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  next();
}

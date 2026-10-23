import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Tiny .env reader so there is nothing extra to install. If a name appears twice, the last line wins.
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  const values = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    values[key] = val;
  }
  for (const [k, v] of Object.entries(values)) if (process.env[k] === undefined) process.env[k] = v;
}
loadEnv(path.join(root, '.env'));

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

export const config = {
  root,
  version: pkg.version,
  brand: pkg.productName || 'Poster', // the name shown in the app; change productName in package.json to rename it
  dataDir,
  mediaDir: path.join(dataDir, 'media'),
  authDir: path.join(dataDir, 'auth'),
  dbPath: path.join(dataDir, 'poster.json'),
  publicDir: path.join(root, 'public'),
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '127.0.0.1',
  // The first account ("admin") gets this password the very first time the app starts.
  adminPassword: process.env.ADMIN_PASSWORD || process.env.APP_PASSWORD || '',
  trustProxy: process.env.TRUST_PROXY === '1', // set when the app sits behind Caddy, nginx or a hosting platform
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  geminiKey: process.env.GEMINI_API_KEY || '',
  claudeModel: process.env.CLAUDE_MODEL || 'claude-haiku-5-5',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
};

export function ensureDirs() {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

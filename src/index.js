import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import { config, ensureDirs } from './config.js';
import { createServer } from './server.js';
import { createTenants } from './tenants.js';
import { createUpdater, defaultDownloadDirs } from './updater.js';
import { createUsers } from './users.js';

ensureDirs();
const users = createUsers({ dataDir: config.dataDir });
// First start: the admin account. If this app already has data from before accounts existed, the admin keeps it.
users.ensureAdmin({ password: config.adminPassword, legacy: fs.existsSync(config.dbPath) });
const tenants = createTenants({ config, users });

const adminId = () => users.admins()[0].id;
const updater = createUpdater({
  appDir: config.root,
  dataDir: config.dataDir,
  version: config.version,
  getUpdateUrl: () => tenants.get(adminId()).store.getKv('updateUrl') || '',
  log: (level, msg) => tenants.get(adminId()).store.log(level, msg),
  downloadDirs: defaultDownloadDirs(),
  // start.sh (or Docker, or PM2) restarts the app, so quitting after an update starts the new version straight away
  restart: process.env.POSTER_SUPERVISED === '1' ? () => { tenants.stopAll(); process.exit(0); } : null,
});
const app = createServer({ config, users, tenants, updater });

// A problem in one place must never stop the app for everybody.
const report = (e) => console.error(`Unexpected problem: ${e?.stack || e?.message || e}`);
process.on('unhandledRejection', report);
process.on('uncaughtException', report);

const servers = [];
function listen(host, { quiet = false } = {}) {
  const server = http.createServer(app);
  server.on('error', (e) => {
    if (quiet) return; // the second loopback address (::1) is a bonus, not a requirement
    console.error(e.code === 'EADDRINUSE' ? `Port ${config.port} is already in use. Change PORT in .env.` : e.message);
    process.exit(1);
  });
  server.listen(config.port, host, () => {
    if (quiet) return;
    console.log(`\nControl panel: http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
    if (config.host === '0.0.0.0') {
      for (const list of Object.values(os.networkInterfaces())) {
        for (const n of list || []) if (n.family === 'IPv4' && !n.internal) console.log(`On your phone (same Wi-Fi): http://${n.address}:${config.port}`);
      }
    }
    const admin = users.get(adminId());
    if (config.host !== '127.0.0.1' && !admin.hasPassword) console.log('WARNING: open to the network and the admin account has no password. Set ADMIN_PASSWORD in .env.');
  });
  servers.push(server);
}
listen(config.host);
// "localhost" can mean ::1 on some phones; answer there too.
if (config.host === '127.0.0.1') listen('::1', { quiet: true });

tenants.startAll().catch(report);

function shutdown() {
  tenants.stopAll();
  for (const s of servers) s.close();
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

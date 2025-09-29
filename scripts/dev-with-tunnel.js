import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readApplicationUrl() {
  try {
    const tomlPath = path.join(__dirname, '..', 'shopify.app.toml');
    const content = fs.readFileSync(tomlPath, 'utf8');
    const match = content.match(/application_url\s*=\s*['"]([^'"]+)['"]/);
    return match ? match[1] : null;
  } catch (_) {
    return null;
  }
}

function run() {
  const url = readApplicationUrl();
  const cli = process.platform === 'win32' ? 'shopify.cmd' : 'shopify';

  const args = ['app', 'dev'];
  if (url) {
    args.push('--tunnel-url', url);
  }

  // Forward any extra args passed to this script
  const extra = process.argv.slice(2);
  args.push(...extra);

  const child = spawn(cli, args, { stdio: 'inherit', env: process.env });
  child.on('exit', (code) => process.exit(code ?? 0));
}

run();



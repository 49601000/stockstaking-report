import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const publicRoot = path.join(root, 'public');
const port = Number(process.env.PORT || 4173);
http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    // Serve the UI, built bundle, config and local sample data from explicit roots.
    let base = publicRoot, relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (pathname.startsWith('/dist/')) {base = path.join(root, 'dist');relative = pathname.slice('/dist/'.length);}
    else if (pathname.startsWith('/config/')) {base = path.join(root, 'config');relative = pathname.slice('/config/'.length);}
    else if (pathname.startsWith('/data/local/')) {base = path.join(root, 'data/local');relative = pathname.slice('/data/local/'.length);}
    const file = path.resolve(base, relative);
    if (!file.startsWith(base + path.sep) || /(?:^|[\\/])\./.test(path.relative(base, file))) throw Error();
    const data = await readFile(file);
    res.setHeader('Content-Type', ({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'})[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`棚卸照合: http://localhost:${port}`));

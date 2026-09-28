import http from 'node:http';
import { readFile, writeFile, rename, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const exec = promisify(execFile);
const root = path.dirname(fileURLToPath(import.meta.url));
const namesFile = path.join(root, 'camera-names.json');
const host = '127.0.0.1';
const port = Number(process.env.PORT || 8765);

const sourceFile = path.join(root, 'camera-modes.swift');
const binaryFile = path.join(root, 'camera-modes');
const sourceStat = await stat(sourceFile);
const binaryStat = await stat(binaryFile).catch(() => null);
if (!binaryStat || binaryStat.mtimeMs < sourceStat.mtimeMs) {
  console.log('Building camera mode scanner…');
  await exec('swiftc', [sourceFile, '-o', binaryFile]);
}

function usbEntries(items, found = []) {
  for (const item of items || []) {
    if (item.vendor_id && item.product_id) {
      found.push({
        name: item._name?.trim() || '',
        vendorId: item.vendor_id.match(/0x([0-9a-f]+)/i)?.[1]?.padStart(4, '0') || '',
        productId: item.product_id.match(/0x([0-9a-f]+)/i)?.[1]?.padStart(4, '0') || '',
        serial: item.serial_num || '',
        location: item.location_id?.split(' ')[0] || '',
        manufacturer: item.manufacturer || '',
        usbSpeed: item.device_speed || '',
      });
    }
    usbEntries(item._items, found);
  }
  return found;
}

async function scan() {
  const [modesResult, profileResult] = await Promise.all([
    exec(path.join(root, 'camera-modes'), { maxBuffer: 2_000_000 }),
    exec('system_profiler', ['SPUSBDataType', '-json'], { maxBuffer: 2_000_000 }),
  ]);
  const modes = JSON.parse(modesResult.stdout);
  const usb = usbEntries(JSON.parse(profileResult.stdout).SPUSBDataType);
  const cameras = modes.map(camera => {
    const nativeId = camera.uniqueId.toLowerCase();
    const matches = usb.filter(item => nativeId.includes(item.vendorId + item.productId));
    const nativeLocation = matches.length
      ? parseInt(nativeId.slice(2, -(matches[0].vendorId.length + matches[0].productId.length)), 16)
      : NaN;
    const byLocation = matches.filter(item => parseInt(item.location, 16) === nativeLocation);
    const match = byLocation.length === 1 ? byLocation[0] : matches.length === 1 ? matches[0] : null;
    const signature = match
      ? `${match.vendorId}:${match.productId}:${match.serial || match.location}`
      : camera.uniqueId;
    const bestModes = [...new Map(camera.modes.map(m =>
      [`${m.width}x${m.height}@${Math.round(m.maxFps * 100) / 100}`, m]
    )).values()].sort((a, b) =>
      b.maxFps - a.maxFps || b.width * b.height - a.width * a.height
    );
    return {
      name: camera.name,
      uniqueId: camera.uniqueId,
      isUsb: Boolean(match),
      signature,
      identity: match?.serial ? 'serial' : match ? 'port' : 'system',
      usb: match,
      modes: bestModes,
    };
  });
  return { cameras, scannedAt: new Date().toISOString() };
}

async function readNames() {
  try { return JSON.parse(await readFile(namesFile, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

function send(res, status, value, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(type.startsWith('application/json') ? JSON.stringify(value) : value);
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${host}:${port}`);
    if (req.method === 'GET' && url.pathname === '/api/cameras') return send(res, 200, await scan());
    if (req.method === 'GET' && url.pathname === '/api/names') return send(res, 200, await readNames());
    if (req.method === 'PUT' && url.pathname === '/api/names') {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 16_384) return send(res, 413, { error: 'Request too large' });
      }
      const { signature, name } = JSON.parse(body);
      if (typeof signature !== 'string' || !signature || signature.length > 200 ||
          typeof name !== 'string' || name.length > 80) {
        return send(res, 400, { error: 'Invalid camera name' });
      }
      const names = await readNames();
      if (name.trim()) names[signature] = name.trim();
      else delete names[signature];
      const temp = `${namesFile}.tmp`;
      await writeFile(temp, JSON.stringify(names, null, 2) + '\n');
      await rename(temp, namesFile);
      return send(res, 200, names);
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(res, 200, await readFile(path.join(root, 'index.html'), 'utf8'), 'text/html; charset=utf-8');
    }
    send(res, 404, { error: 'Not found' });
  } catch (error) {
    send(res, 500, { error: error.message });
  }
}).listen(port, host, () => console.log(`Camera Lab: http://${host}:${port}`));

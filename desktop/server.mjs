import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequestListener } from '@react-router/node';

const contentTypes = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
};

export async function startServer(appDirectory) {
  const build = await import(pathToFileURL(resolve(appDirectory, 'build/server/index.js')).href);
  const handle = createRequestListener({ build, mode: 'production' });
  const clientDirectory = resolve(appDirectory, 'build/client');
  const token = randomBytes(32).toString('hex');
  let origin;
  const server = createServer(async (request, response) => {
    // The desktop session is the only client allowed to access financial data.
    if (
      request.headers.host !== new URL(origin).host ||
      !request.headers.cookie?.split(';').some((value) => value.trim() === `desktop_session=${token}`) ||
      (request.headers.origin && request.headers.origin !== origin)
    ) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    try {
      const pathname = decodeURIComponent(new URL(request.url, origin).pathname);
      const filename = resolve(clientDirectory, `.${pathname}`);

      if ((request.method === 'GET' || request.method === 'HEAD') && filename.startsWith(clientDirectory + sep)) {
        try {
          const data = await readFile(filename);
          response.writeHead(200, {
            'Content-Type': contentTypes[extname(filename)] || 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff',
          });
          response.end(request.method === 'HEAD' ? undefined : data);
          return;
        } catch (error) {
          if (!['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code)) {
            throw error;
          }
        }
      }

      await handle(request, response);
    } catch (error) {
      console.error(error);

      if (!response.headersSent) {
        response.writeHead(500);
      }

      response.end('Unable to process request');
    }
  });
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, token };
}

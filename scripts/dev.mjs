import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const host = '127.0.0.1';
const port = 8080;
const origin = 'http://' + host + ':' + port;
const project = fileURLToPath(new URL('../', import.meta.url));
const publicDirectory = resolve(project, 'public');
const sourceDirectory = resolve(project, 'src');
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, origin).pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }

  if (pathname === '/') pathname = '/index.html';
  const extension = extname(pathname);
  const isModule = extension === '.js';
  const directory = isModule ? sourceDirectory : publicDirectory;
  const relative = isModule ? pathname.slice(1, -3) + '.ts' : pathname.slice(1);
  const file = resolve(directory, relative);

  if (!file.startsWith(directory + sep) || !Object.hasOwn(contentTypes, extension)) {
    response.writeHead(404).end();
    return;
  }

  try {
    const source = await readFile(file, 'utf8');
    const body = isModule ? ts.transpileModule(source, {
      fileName: file,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        rewriteRelativeImportExtensions: true,
        verbatimModuleSyntax: true,
      },
    }).outputText : source;
    response.writeHead(200, {
      'Content-Type': contentTypes[extension],
      'Cache-Control': 'no-store',
    }).end(request.method === 'GET' ? body : undefined);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'EISDIR') {
      response.writeHead(404).end();
      return;
    }
    console.error(error.message);
    response.writeHead(500).end();
  }
});

server.on('error', error => {
  console.error('Не удалось запустить сервер на ' + origin + '. ' + error.message);
  process.exitCode = 1;
});
server.listen(port, host, () => console.log('Калькулятор открыт на ' + origin));

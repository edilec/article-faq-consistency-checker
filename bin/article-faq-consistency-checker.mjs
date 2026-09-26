#!/usr/bin/env node
import { readFile, realpath, stat, lstat, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve, relative, dirname, basename, isAbsolute, sep, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { auditFaqs, incomplete, parseStrictJson, LIMITS } from '../src/index.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  process.stdout.write('Usage: article-faq-consistency-checker --root DIR --input FILE [--out FILE] [--human]\nReads a local exported article/FAQ document only.\n');
} else {
  let root, input, out, human = false;
  try {
    for (let i = 0; i < args.length; i++) {
      const key = args[i];
      if (key === '--human') { if (human) throw new Error('duplicate'); human = true; continue; }
      if (!['--root', '--input', '--out'].includes(key) || i + 1 >= args.length || args[i + 1].startsWith('--')) throw new Error('option');
      const value = args[++i];
      if (key === '--root') { if (root) throw new Error('duplicate'); root = value; }
      if (key === '--input') { if (input) throw new Error('duplicate'); input = value; }
      if (key === '--out') { if (out) throw new Error('duplicate'); out = value; }
    }
    if (!root || !input || [input, out].filter(Boolean).some(isAbsolute)) throw new Error('path');
    root = await realpath(root);
    if (!(await stat(root)).isDirectory()) throw new Error('root');
  } catch { process.stderr.write('Invalid configuration. Use --help.\n'); process.exit(2); }
  const inside = path => { const rel = relative(root, path); return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)); };
  let result;
  try {
    const file = await realpath(resolve(root, input));
    if (!inside(file) || !(await stat(file)).isFile()) throw new Error('input-unreadable');
    if ((await stat(file)).size > LIMITS.bytes) throw new Error('byte-limit');
    const bytes = await readFile(file, { signal: AbortSignal.timeout(LIMITS.milliseconds) });
    if (bytes.length > LIMITS.bytes) throw new Error('byte-limit');
    result = auditFaqs(parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch (error) { result = incomplete(['byte-limit', 'depth-limit', 'duplicate-key'].includes(error.message) ? error.message : 'input-unreadable'); }
  const rendered = `${JSON.stringify(result, null, 2)}\n`;
  if (out) {
    try {
      const destination = resolve(root, out), parent = await realpath(dirname(destination));
      if (!inside(parent) || !inside(destination)) throw new Error('outside root');
      const actual = join(parent, basename(destination)), named = resolve(root, input);
      if (destination === named) throw new Error('output aliases named input');
      const canonical = await realpath(dirname(named)).then(p => join(p, basename(named))).catch(() => null);
      if (actual === canonical) throw new Error('output aliases named input');
      let old;
      try { old = await lstat(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (old?.isSymbolicLink() || old?.isDirectory()) throw new Error('invalid output');
      if (old) {
        const file = await realpath(named).catch(() => null);
        if (file && inside(file)) {
          const source = await stat(file);
          if (old.dev === source.dev && old.ino === source.ino) throw new Error('output aliases input');
        }
      }
      const temp = join(parent, `.${basename(destination)}.${randomUUID()}.tmp`);
      try { await writeFile(temp, rendered, { flag: 'wx', mode: 0o600 }); await rename(temp, destination); }
      catch (error) { await unlink(temp).catch(() => {}); throw error; }
    } catch { process.stderr.write('Output destination refused or write failed.\n'); process.exit(2); }
  }
  process.stdout.write(rendered);
  if (human) process.stderr.write(`FAQ consistency: ${result.status}; ${result.summary.checked} claims compared; ${result.summary.errors} errors.\n`);
  process.exitCode = result.status === 'pass' ? 0 : result.status === 'fail' ? 1 : 2;
}

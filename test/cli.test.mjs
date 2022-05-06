import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, symlink, link, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { LIMITS } from '../src/index.mjs';

const bin = new URL('../bin/article-faq-consistency-checker.mjs', import.meta.url).pathname;
const doc = { schemaVersion: '1', complete: true, articles: [{ id: 'a', text: '2030-01-01' }], faqs: [{ id: 'f', articleId: 'a', question: 'When?', answer: '2030-01-01', review: 'supported', claims: [{ kind: 'date', answerSpan: { start: 0, end: 10 }, articleSpan: { start: 0, end: 10 } }] }] };
const run = (root, extra = []) => spawnSync(process.execPath, [bin, '--root', root, '--input', 'export.json', ...extra], { encoding: 'utf8' });
const rules = result => JSON.parse(result.stdout).findings.map(f => f.ruleId);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'faq-audit-'));
  await writeFile(join(root, 'export.json'), JSON.stringify(doc));
  return root;
}
test('CLI passes reviewed matched export and allows ordinary report output', async () => {
  const root = await fixture(), result = run(root, ['--out', 'report.json']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'pass');
  assert.equal(await readFile(join(root, 'report.json'), 'utf8'), result.stdout);
});
test('CLI contradictory number fails without exposing raw answer', async () => {
  const root = await fixture(), bad = structuredClone(doc);
  bad.articles[0].text = '12'; bad.faqs[0].answer = '13';
  bad.faqs[0].claims = [{ kind: 'number', answerSpan: { start: 0, end: 2 }, articleSpan: { start: 0, end: 2 } }];
  await writeFile(join(root, 'export.json'), JSON.stringify(bad));
  const result = run(root);
  assert.equal(result.status, 1); assert.ok(rules(result).includes('number-contradiction'));
  assert.ok(!result.stdout.includes('"13"'));
});
test('CLI unreviewed exact match remains incomplete', async () => {
  const root = await fixture(), bad = structuredClone(doc); bad.faqs[0].review = 'needs-review';
  await writeFile(join(root, 'export.json'), JSON.stringify(bad));
  const result = run(root);
  assert.equal(result.status, 2); assert.ok(rules(result).includes('needs-review'));
});
test('strict UTF-8, JSON parse and duplicate keys return incomplete reports; bad options have empty stdout', async () => {
  const root = await fixture();
  await writeFile(join(root, 'export.json'), Buffer.from([0xff]));
  assert.deepEqual(rules(run(root)), ['input-unreadable']);
  await writeFile(join(root, 'export.json'), '"private-marker" broken');
  const bad = run(root); assert.equal(bad.status, 2); assert.ok(!bad.stdout.includes('private-marker'));
  const body = JSON.stringify(doc);
  for (const replacement of ['"complete":false,"complete":true', '"complete":false,"co\\u006dplete":true']) {
    await writeFile(join(root, 'export.json'), body.replace('"complete":true', replacement));
    const duplicate = run(root);
    assert.equal(duplicate.status, 2); assert.deepEqual(rules(duplicate), ['duplicate-key']);
  }
  const option = run(root, ['--unknown']); assert.equal(option.status, 2); assert.equal(option.stdout, '');
});
test('input byte bound accepts exact N and rejects N+1', async () => {
  const root = await fixture(), body = await readFile(join(root, 'export.json'));
  await writeFile(join(root, 'export.json'), Buffer.concat([body, Buffer.alloc(LIMITS.bytes - body.length, 0x20)]));
  assert.equal(run(root).status, 0);
  await writeFile(join(root, 'export.json'), Buffer.concat([body, Buffer.alloc(LIMITS.bytes + 1 - body.length, 0x20)]));
  const result = run(root); assert.equal(result.status, 2); assert.deepEqual(rules(result), ['byte-limit']);
});
test('read realpath escape is incomplete; output symlink, parent escape, hard link and missing alias are refused', async () => {
  const root = await fixture(), outside = await mkdtemp(join(tmpdir(), 'faq-outside-'));
  await writeFile(join(outside, 'sentinel'), 'preserve');
  await symlink(join(outside, 'sentinel'), join(root, 'out-link'));
  await symlink(outside, join(root, 'escape'));
  await link(join(root, 'export.json'), join(root, 'hard'));
  for (const out of ['export.json', 'hard', 'out-link', 'escape/report.json']) {
    const result = run(root, ['--out', out]);
    assert.equal(result.status, 2, out); assert.equal(result.stdout, '', out);
  }
  await symlink(join(outside, 'sentinel'), join(root, 'outside.json'));
  const escaped = spawnSync(process.execPath, [bin, '--root', root, '--input', 'outside.json'], { encoding: 'utf8' });
  assert.equal(escaped.status, 2); assert.deepEqual(rules(escaped), ['input-unreadable']);
  await symlink(root, join(root, 'alias'));
  for (const out of ['missing.json', 'alias/missing.json']) {
    const result = spawnSync(process.execPath, [bin, '--root', root, '--input', 'missing.json', '--out', out], { encoding: 'utf8' });
    assert.equal(result.status, 2); assert.equal(result.stdout, '');
  }
  await assert.rejects(stat(join(root, 'missing.json')));
  assert.equal(await readFile(join(outside, 'sentinel'), 'utf8'), 'preserve');
});

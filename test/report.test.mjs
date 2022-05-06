import test from 'node:test';
import assert from 'node:assert/strict';
import { auditFaqs, TOOL_ID, LIMITS } from '../src/index.mjs';

const good = () => ({ schemaVersion: '1', complete: true,
  articles: [{ id: 'article-a', text: '2030-01-01' }],
  faqs: [{ id: 'faq-a', articleId: 'article-a', question: 'When?', answer: '2030-01-01', review: 'supported',
    claims: [{ kind: 'date', answerSpan: { start: 0, end: 10 }, articleSpan: { start: 0, end: 10 } }] }]
});
const rules = result => result.findings.map(f => f.ruleId);

test('explicitly reviewed FAQ with exact date spans passes and preserves numeric provenance', () => {
  const result = auditFaqs(good());
  assert.equal(TOOL_ID, 'article-faq-consistency-checker');
  assert.equal(result.status, 'pass');
  assert.deepEqual(result.summary, { checked: 1, errors: 0, warnings: 0 });
  assert.deepEqual(rules(result), ['claim-span-checked']);
  assert.equal(result.findings[0].evidence, 'answer@0-10;article[0]@0-10');
  assert.ok(!JSON.stringify(result).includes('2030-01-01'));
});
test('contradictory dates and numbers fail with exact spans, never raw values', () => {
  const date = good(); date.faqs[0].answer = '2030-01-02';
  const d = auditFaqs(date);
  assert.equal(d.status, 'fail');
  assert.ok(rules(d).includes('date-contradiction'));
  assert.equal(d.findings.find(f => f.ruleId === 'date-contradiction').evidence, 'answer@0-10;article[0]@0-10');
  const number = good(); number.articles[0].text = '12'; number.faqs[0].answer = '13';
  number.faqs[0].claims = [{ kind: 'number', answerSpan: { start: 0, end: 2 }, articleSpan: { start: 0, end: 2 } }];
  const n = auditFaqs(number);
  assert.equal(n.status, 'fail'); assert.ok(rules(n).includes('number-contradiction'));
});
test('negative fractional number is not equal to positive fractional number', () => {
  const input = good(); input.articles[0].text = '0.5'; input.faqs[0].answer = '-0.5';
  input.faqs[0].claims = [{ kind: 'number', answerSpan: { start: 0, end: 4 }, articleSpan: { start: 0, end: 3 } }];
  assert.equal(auditFaqs(input).status, 'fail');
  assert.ok(rules(auditFaqs(input)).includes('number-contradiction'));
});
test('matching dates or numbers without explicit review remain needs-review incomplete', () => {
  const input = good(); input.faqs[0].review = 'needs-review';
  const result = auditFaqs(input);
  assert.equal(result.status, 'incomplete');
  assert.ok(rules(result).includes('needs-review'));
});
test('a prior contradiction cannot hide a later FAQ needing review', () => {
  const input = good(); input.faqs[0].answer = '2030-01-02';
  input.faqs.push({ ...structuredClone(good().faqs[0]), id: 'faq-b', review: 'needs-review' });
  const result = auditFaqs(input);
  assert.ok(result.findings.some(f => f.ruleId === 'date-contradiction' && f.location.pointer.startsWith('/faqs/0/')));
  assert.ok(result.findings.some(f => f.ruleId === 'needs-review' && f.location.pointer === '/faqs/1/review'));
});

test('span offsets are UTF-16 code units, including preceding emoji', () => {
  const input = good(); input.articles[0].text = '😀 2030-01-01'; input.faqs[0].answer = '😀 2030-01-01';
  input.faqs[0].claims[0].answerSpan = { start: 3, end: 13 };
  input.faqs[0].claims[0].articleSpan = { start: 3, end: 13 };
  const result = auditFaqs(input);
  assert.equal(result.status, 'pass');
  assert.equal(result.findings[0].evidence, 'answer@3-13;article[0]@3-13');
});
test('unsupported claim without article span is needs-review, even with supported label', () => {
  const input = good(); input.faqs[0].claims[0].articleSpan = null;
  const result = auditFaqs(input);
  assert.equal(result.status, 'incomplete');
  assert.deepEqual(rules(result), ['needs-review']);
  assert.equal(result.findings[0].evidence, 'answer@0-10;article[0]@none');
});
test('entity equality is lexical only; different entity requires review', () => {
  const input = good(); input.articles[0].text = 'Acme'; input.faqs[0].answer = 'Acme';
  input.faqs[0].claims = [{ kind: 'entity', answerSpan: { start: 0, end: 4 }, articleSpan: { start: 0, end: 4 } }];
  assert.equal(auditFaqs(input).status, 'pass');
  input.faqs[0].answer = 'Other';
  input.faqs[0].claims[0].answerSpan.end = 5;
  const result = auditFaqs(input);
  assert.equal(result.status, 'incomplete');
  assert.ok(rules(result).includes('entity-needs-review'));
});
test('invalid spans or date syntax are incomplete rather than a guessed contradiction', () => {
  const input = good(); input.faqs[0].claims[0].answerSpan.end = 11;
  assert.deepEqual(rules(auditFaqs(input)), ['span-invalid']);
  input.faqs[0].claims[0].answerSpan.end = 10; input.faqs[0].answer = '2030-02-30';
  assert.deepEqual(rules(auditFaqs(input)), ['claim-invalid']);
});
test('partial or empty export and unknown article never pass', () => {
  const input = good(); input.complete = false;
  assert.deepEqual(rules(auditFaqs(input)), ['export-incomplete']);
  input.complete = true; input.faqs = [];
  assert.deepEqual(rules(auditFaqs(input)), ['no-faqs']);
  input.faqs = good().faqs; input.faqs[0].articleId = 'unknown';
  assert.deepEqual(rules(auditFaqs(input)), ['article-unknown']);
});
test('record, claim, depth, byte, text and injected time bounds accept N and reject N+1', () => {
  const input = good(); input.articles = Array.from({ length: LIMITS.articles }, (_, i) => ({ id: `a-${i}`, text: '2030-01-01' }));
  input.faqs = Array.from({ length: LIMITS.faqs }, (_, i) => ({ ...structuredClone(good().faqs[0]), id: `f-${i}`, articleId: `a-${i}` }));
  assert.equal(auditFaqs(input).status, 'pass');
  input.faqs.push(structuredClone(input.faqs[0]));
  assert.deepEqual(rules(auditFaqs(input)), ['record-limit']);
  const claims = good(); claims.faqs[0].claims = Array.from({ length: LIMITS.claims }, () => structuredClone(good().faqs[0].claims[0]));
  assert.equal(auditFaqs(claims).status, 'pass');
  claims.faqs[0].claims.push(structuredClone(claims.faqs[0].claims[0]));
  assert.deepEqual(rules(auditFaqs(claims)), ['record-limit']);
  const depth = good(); assert.equal(auditFaqs(depth).status, 'pass');
  depth.faqs[0].claims[0].extra = { nested: { tooDeep: true } };
  assert.deepEqual(rules(auditFaqs(depth)), ['depth-limit']);
  const bytes = good(); bytes.padding = 'x'.repeat(LIMITS.bytes);
  assert.deepEqual(rules(auditFaqs(bytes)), ['byte-limit']);
  const text = good(); text.articles[0].text = 'x'.repeat(LIMITS.text);
  text.faqs[0].claims[0].articleSpan = null;
  assert.equal(auditFaqs(text).status, 'incomplete');
  text.articles[0].text += 'x';
  assert.deepEqual(rules(auditFaqs(text)), ['article-invalid']);
  const exact = [0, LIMITS.milliseconds];
  assert.equal(auditFaqs(good(), { now: () => exact.shift() ?? LIMITS.milliseconds }).status, 'pass');
  const late = [0, LIMITS.milliseconds + 1];
  assert.deepEqual(rules(auditFaqs(good(), { now: () => late.shift() ?? LIMITS.milliseconds + 1 })), ['time-limit']);
});

test('number digit and fraction bounds and answer/question text bounds accept N and reject N+1', () => {
  const input = good(), value = '9'.repeat(12) + '.' + '9'.repeat(6);
  input.articles[0].text = value; input.faqs[0].answer = value;
  input.faqs[0].claims = [{ kind: 'number', answerSpan: { start: 0, end: 19 }, articleSpan: { start: 0, end: 19 } }];
  assert.equal(auditFaqs(input).status, 'pass');
  input.faqs[0].answer = '9'.repeat(13) + '.999999'; input.faqs[0].claims[0].answerSpan.end = 20;
  assert.deepEqual(rules(auditFaqs(input)), ['claim-invalid']);
  input.faqs[0].answer = '9'.repeat(12) + '.9999999';
  assert.deepEqual(rules(auditFaqs(input)), ['claim-invalid']);
  const text = good(); text.faqs[0].question = 'Q'.repeat(1000);
  assert.equal(auditFaqs(text).status, 'pass');
  text.faqs[0].question += 'Q';
  assert.deepEqual(rules(auditFaqs(text)), ['faq-invalid']);
  const answer = good(); answer.faqs[0].answer = 'x'.repeat(LIMITS.text);
  answer.faqs[0].claims[0].articleSpan = null;
  assert.equal(auditFaqs(answer).status, 'incomplete');
  answer.faqs[0].answer += 'x';
  assert.deepEqual(rules(auditFaqs(answer)), ['faq-invalid']);
});

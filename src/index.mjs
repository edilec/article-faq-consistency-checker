export const TOOL_ID = 'article-faq-consistency-checker';
export const LIMITS = Object.freeze({ bytes: 1_048_576, articles: 100, faqs: 100, claims: 300, depth: 6, text: 10_000, milliseconds: 5000 });
export const RULE_SEVERITY = Object.freeze({
  'input-unreadable': 'error', 'input-invalid': 'error', 'duplicate-key': 'error', 'export-incomplete': 'error',
  'record-limit': 'error', 'byte-limit': 'error', 'depth-limit': 'error', 'time-limit': 'error', 'article-invalid': 'error',
  'faq-invalid': 'error', 'claim-invalid': 'error', 'span-invalid': 'error', 'article-duplicate': 'error', 'faq-duplicate': 'error',
  'article-unknown': 'error', 'no-faqs': 'error', 'needs-review': 'error', 'entity-needs-review': 'error',
  'date-contradiction': 'error', 'number-contradiction': 'error', 'claim-span-checked': 'info'
});
const UNKNOWN = new Set(['input-unreadable', 'input-invalid', 'duplicate-key', 'export-incomplete', 'record-limit', 'byte-limit', 'depth-limit', 'time-limit', 'article-invalid', 'faq-invalid', 'claim-invalid', 'span-invalid', 'article-duplicate', 'faq-duplicate', 'article-unknown', 'no-faqs', 'needs-review', 'entity-needs-review']);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const visible = v => typeof v === 'string' && v.replace(/[\s\p{Default_Ignorable_Code_Point}]/gu, '').length > 0 && !/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(v);
const short = v => visible(v) && v.length <= 1000;
const long = v => visible(v) && v.length <= LIMITS.text;
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const finding = (ruleId, pointer = '', evidence) => {
  if (!Object.hasOwn(RULE_SEVERITY, ruleId)) throw new Error('Unknown rule');
  return { ruleId, severity: RULE_SEVERITY[ruleId], message: {
    'claim-span-checked': 'Deterministic claim spans were compared; semantic support is not inferred.',
    'date-contradiction': 'Paired date spans differ.',
    'number-contradiction': 'Paired number spans differ.',
    'needs-review': 'Answer lacks sufficient paired evidence or an explicit supported review.',
    'entity-needs-review': 'Paired entity labels differ; alias or semantic review is required.'
  }[ruleId] ?? 'Evidence cannot be evaluated safely.', location: { file: '@export', pointer }, ...(evidence === undefined ? {} : { evidence }) };
};
function report(findings, checked = 0) {
  findings.sort((a, b) => order(a.location.file, b.location.file) || order(a.location.pointer, b.location.pointer) || order(a.ruleId, b.ruleId));
  const errors = findings.filter(f => f.severity === 'error').length;
  return { schemaVersion: '1', tool: TOOL_ID, status: findings.some(f => UNKNOWN.has(f.ruleId)) ? 'incomplete' : errors ? 'fail' : 'pass', summary: { checked, errors, warnings: 0 }, findings };
}
export const incomplete = ruleId => report([finding(ruleId)]);
export function parseStrictJson(raw) {
  const value = JSON.parse(raw);
  let i = 0;
  const space = () => { while (/\s/u.test(raw[i] ?? '')) i++; };
  const token = () => {
    const start = i++;
    while (i < raw.length) {
      if (raw[i] === '\\') { i += 2; continue; }
      if (raw[i++] === '"') return JSON.parse(raw.slice(start, i));
    }
    throw new Error('invalid-json');
  };
  const walk = depth => {
    if (depth > LIMITS.depth) throw new Error('depth-limit');
    space();
    if (raw[i] === '{') {
      i++; space(); const keys = new Set();
      while (raw[i] !== '}') {
        const key = token(); if (keys.has(key)) throw new Error('duplicate-key'); keys.add(key);
        space(); i++; walk(depth + 1); space(); if (raw[i] !== ',') break; i++; space();
      }
      i++; return;
    }
    if (raw[i] === '[') {
      i++; space();
      while (raw[i] !== ']') { walk(depth + 1); space(); if (raw[i] !== ',') break; i++; space(); }
      i++; return;
    }
    if (raw[i] === '"') { token(); return; }
    while (i < raw.length && !/[\s,}\]]/u.test(raw[i])) i++;
  };
  walk(0); return value;
}
function tooDeep(v, depth = 0) {
  if (depth > LIMITS.depth) return true;
  return v !== null && typeof v === 'object' && Object.values(v).some(child => tooDeep(child, depth + 1));
}
const span = (v, length) => object(v) && Object.keys(v).every(k => ['start', 'end'].includes(k)) && Number.isInteger(v.start) && Number.isInteger(v.end) && v.start >= 0 && v.end > v.start && v.end <= length;
const date = v => /^\d{4}-\d{2}-\d{2}$/u.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const number = v => /^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/u.test(v);
const numeric = v => {
  const [whole, fractional = ''] = v.split('.');
  const normalizedWhole = BigInt(whole).toString();
  const normalizedFraction = fractional.replace(/0+$/u, '');
  const negativeZeroFraction = whole.startsWith('-') && normalizedWhole === '0' && normalizedFraction;
  return (negativeZeroFraction ? '-0' : normalizedWhole) + (normalizedFraction ? `.${normalizedFraction}` : '');
};
const validArticle = v => object(v) && Object.keys(v).every(k => ['id', 'text'].includes(k)) && short(v.id) && long(v.text);
const validFaq = v => object(v) && Object.keys(v).every(k => ['id', 'articleId', 'question', 'answer', 'review', 'claims'].includes(k)) && short(v.id) && short(v.articleId) && short(v.question) && long(v.answer) && ['supported', 'needs-review'].includes(v.review) && Array.isArray(v.claims);
const spanEvidence = (answerSpan, articleSpan, ordinal) => `answer@${answerSpan.start}-${answerSpan.end};article[${ordinal}]@${articleSpan ? `${articleSpan.start}-${articleSpan.end}` : 'none'}`;

export function auditFaqs(document, { now = Date.now } = {}) {
  const start = now(), expired = () => now() - start > LIMITS.milliseconds;
  if (!object(document)) return incomplete('input-invalid');
  let bytes; try { bytes = Buffer.byteLength(JSON.stringify(document), 'utf8'); } catch { return incomplete('input-invalid'); }
  if (bytes > LIMITS.bytes) return incomplete('byte-limit');
  if (tooDeep(document)) return incomplete('depth-limit');
  if (expired()) return incomplete('time-limit');
  if (document.schemaVersion !== '1' || !Array.isArray(document.articles) || !Array.isArray(document.faqs) || Object.keys(document).some(k => !['schemaVersion', 'complete', 'articles', 'faqs'].includes(k))) return incomplete('input-invalid');
  if (document.complete !== true) return incomplete('export-incomplete');
  if (document.articles.length > LIMITS.articles || document.faqs.length > LIMITS.faqs || document.faqs.reduce((n, v) => n + (Array.isArray(v?.claims) ? v.claims.length : 0), 0) > LIMITS.claims) return incomplete('record-limit');
  if (!document.articles.length || !document.faqs.length) return incomplete('no-faqs');
  const articles = new Map(), faqIds = new Set();
  for (const [i, article] of document.articles.entries()) {
    if (expired()) return incomplete('time-limit');
    if (!validArticle(article)) return report([finding('article-invalid', `/articles/${i}`)]);
    if (articles.has(article.id)) return report([finding('article-duplicate', `/articles/${i}/id`)]);
    articles.set(article.id, { article, ordinal: i });
  }
  for (const [i, faq] of document.faqs.entries()) {
    if (expired()) return incomplete('time-limit');
    if (!validFaq(faq)) return report([finding('faq-invalid', `/faqs/${i}`)]);
    if (faqIds.has(faq.id)) return report([finding('faq-duplicate', `/faqs/${i}/id`)]);
    faqIds.add(faq.id);
    if (!articles.has(faq.articleId)) return report([finding('article-unknown', `/faqs/${i}/articleId`)]);
  }
  const findings = []; let checked = 0;
  for (const [i, faq] of document.faqs.entries()) {
    if (expired()) return incomplete('time-limit');
    const { article, ordinal } = articles.get(faq.articleId);
    const faqFindingsStart = findings.length;
    if (!faq.claims.length) findings.push(finding('needs-review', `/faqs/${i}/answer`, `answer@0-${faq.answer.length};article[${ordinal}]@none`));
    for (const [j, claim] of faq.claims.entries()) {
      if (expired()) return incomplete('time-limit');
      const pointer = `/faqs/${i}/claims/${j}`;
      if (!object(claim) || Object.keys(claim).some(k => !['kind', 'answerSpan', 'articleSpan'].includes(k)) || !['date', 'number', 'entity'].includes(claim.kind)) return report([finding('claim-invalid', pointer)]);
      if (!span(claim.answerSpan, faq.answer.length) || (claim.articleSpan !== null && !span(claim.articleSpan, article.text.length))) return report([finding('span-invalid', pointer)]);
      const evidence = spanEvidence(claim.answerSpan, claim.articleSpan, ordinal);
      if (claim.articleSpan === null) { findings.push(finding('needs-review', pointer, evidence)); continue; }
      const answer = faq.answer.slice(claim.answerSpan.start, claim.answerSpan.end);
      const source = article.text.slice(claim.articleSpan.start, claim.articleSpan.end);
      if (!visible(answer) || !visible(source) || (claim.kind === 'date' && (!date(answer) || !date(source))) || (claim.kind === 'number' && (!number(answer) || !number(source)))) return report([finding('claim-invalid', pointer)]);
      checked++;
      if (claim.kind === 'date' && answer !== source) findings.push(finding('date-contradiction', pointer, evidence));
      else if (claim.kind === 'number' && numeric(answer) !== numeric(source)) findings.push(finding('number-contradiction', pointer, evidence));
      else if (claim.kind === 'entity' && answer !== source) findings.push(finding('entity-needs-review', pointer, evidence));
      else findings.push(finding('claim-span-checked', pointer, evidence));
    }
    if (faq.review !== 'supported' && !findings.slice(faqFindingsStart).some(f => f.ruleId === 'date-contradiction' || f.ruleId === 'number-contradiction')) findings.push(finding('needs-review', `/faqs/${i}/review`, `answer@0-${faq.answer.length};article[${ordinal}]@none`));
  }
  if (expired()) return incomplete('time-limit');
  return report(findings, checked);
}

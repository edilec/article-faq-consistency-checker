# Article FAQ Consistency Checker

An offline, read-only reporter for exported articles and structured FAQs. It compares *explicitly paired* answer/article spans for ISO dates, bounded decimal numbers, and exact entity labels. Contradictory dates or numbers are reported as failures. Matching tokens do **not** establish semantic support: a pass requires an explicit `review:"supported"` label in the export. Missing evidence, unreviewed answers, and differing entity labels require review and are incomplete.

Node.js 22+; no dependencies, network calls, model calls, or article scraping.

## Run

```sh
node bin/article-faq-consistency-checker.mjs --root examples --input passing.json
node bin/article-faq-consistency-checker.mjs --root examples --input failing.json
node bin/article-faq-consistency-checker.mjs --root examples --input needs-review.json
npm run check
```

These exit 0 (explicitly reviewed match), 1 (date contradiction), and 2 (review needed). `--human` prints a short stderr summary. `--out report.json` additionally writes the stdout JSON report within the root. Bad options or refused output destinations exit 2 with empty stdout; unreadable input emits an incomplete JSON report.

## Export format

```json
{
  "schemaVersion": "1",
  "complete": true,
  "articles": [{ "id": "article-a", "text": "2030-01-01" }],
  "faqs": [{
    "id": "faq-a", "articleId": "article-a", "question": "When?",
    "answer": "2030-01-01", "review": "supported",
    "claims": [{ "kind": "date", "answerSpan": { "start": 0, "end": 10 }, "articleSpan": { "start": 0, "end": 10 } }]
  }]
}
```

The input is strict UTF-8 JSON relative to a declared real `--root`. Duplicate JSON keys, including escaped aliases, are rejected. Spans are **zero-based UTF-16 code-unit offsets**, start inclusive and end exclusive, into the exact answer and referenced article text. A claim kind is `date`, `number`, or `entity`. A missing article span is represented by `null` and yields `needs-review`. Date spans must be valid `YYYY-MM-DD` calendar dates. Number spans allow an optional minus sign, up to 12 whole digits and six fractional digits; insignificant fractional zeros compare equal. Entity comparison is exact lexical equality; differing labels may be aliases and therefore require review rather than an automatic contradiction. `review:"supported"` is a labeled external human review of the *whole answer*, not a conclusion produced by this tool. `review:"needs-review"` prevents a pass even when paired tokens match.

## Rules and exits

| Exit | Rules | Meaning |
| --- | --- | --- |
| 0 | `claim-span-checked` (info) | Paired tokens match; pass only with explicit supported review. |
| 1 | `date-contradiction`, `number-contradiction` | Valid paired values disagree. |
| 2 | `needs-review`, `entity-needs-review` | Answer support is absent, unreviewed, or lexically uncertain. |
| 2 | `input-unreadable`, `input-invalid`, `duplicate-key`, `export-incomplete`, `no-faqs` | Input is absent, partial, ambiguous or empty. |
| 2 | `article-invalid`, `faq-invalid`, `claim-invalid`, `span-invalid`, `article-duplicate`, `faq-duplicate`, `article-unknown` | Required record or source position is unusable. |
| 2 | `byte-limit`, `record-limit`, `depth-limit`, `time-limit` | A declared resource bound was exceeded. |

Each claim finding has an exact numeric evidence string, such as `answer@0-10;article[0]@0-10`, and logical source role `@export` with a JSON pointer like `/faqs/0/claims/0`. The report never emits article text, answers, questions, IDs, raw entities, or absolute paths. Findings sort by `(file, pointer, ruleId)` in JavaScript code-unit order. Incomplete evidence takes precedence over an evaluated failure elsewhere in a batch.

## Limits and non-goals

Maximum export size 1,048,576 UTF-8 bytes; 100 articles; 100 FAQs; 300 total claims; JSON depth 6 (root 0); article and answer text at most 10,000 code units; identifiers and questions at most 1,000 code units; injected-clock evaluation at most 5,000 ms. Every N bound accepts N and rejects N+1. Paths are realpath-confined. `--out` refuses symlink destinations, parent escapes, and path or hard-link aliases of its input, including a named missing input.

This cannot infer semantic equivalence, detect unsupported prose outside supplied claim spans, prove that a human review label is genuine, or verify live published content. A labeled review is a required external evidence claim, not an automated proof. It does not execute or modify source articles.

MIT licensed; see [LICENSE](./LICENSE).

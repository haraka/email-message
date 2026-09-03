# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/).

### Unreleased

### [1.4.4] - 2026-09-03

- fix(security): reject unsafe header names
- deps(all): bump versions

### [1.4.3] - 2026-08-04

- fix: strip CR/LF from decoded RFC 2047 encoded words
- deps(all): bump versions

### [1.4.2] - 2026-08-01

- fix(header): get_addresses parses the raw header, then decodes phrases

### [1.4.1] - 2026-07-20

- fix(header): replace RFC 2231 regex with tokenizer `lib/rfc2231`
  - 20-40% faster typical case, 8,000% faster adversarial case
- fix(header): replace RFC 2047 regex with tokenizer `lib/rfc2047`
  - 2x-3x faster typical case, 1,500% faster adversarial case
- packaging / meta updates (#26)

### [1.4.0] - 2026-05-26

- feat(header): `header.get_addresses(key)` — returns parsed `(Address | Group)[]`

### [1.3.4] - 2026-05-13

- fix(attachment-stream): cap paused buffer (default 64MB), abort when exceeded
- fix(body): require exact MIME boundary delimiter per RFC 2046 §5.1.1
- fix(body): pass `contentDisposition` to filters on non-empty bodies
- fix(body): propagate `#depth + 1` to sibling parts in `parse_child`
- feat(body): `options.maxMimeDepth` overrides the config-derived cap
- perf(header): short-circuit `_parse_rfc2231` when the input contains no `*` or `=`; fixes O(n²) backtracking on long unstructured headers (15KB `From:` 117ms → 0.02ms)
- dep: add `@haraka/email-address` ^3.1.5
- deps(all): bumped to latest

### [1.3.3] - 2026-05-10

- dep(message-stream): update to 2.0.4

### [1.3.2] - 2026-03-30

- replace polynomial regex with much faster `slice()`

### [1.3.1] - 2026-03-30

#### Fixes

- header: prevent prototype pollution
  - belt: use Object.create instead of {}
  - suspenders: add guards for **proto**, constructor, and prototype
- header: switch from recursion to iteration in parser
  - prevents stack exhaustion vulnerabilities
- body: added max_mime_depth, default 100
- body: disallow empty boundaries

#### Changes

- dep(message-stream): update to v2
- test: added vulnerability test suite
- test: added additional test coverage
- test: ES2024, table driven

### [1.3.0] - 2026-03-24

- change: split index.js into `lib/` files
- style(esnext): some updates
  - private fields (#)
- doc(README): practical makeover
- test: organize the test suite
- test: switch test runner from mocha to node --test

### [1.2.7] - 2026-03-23

- fix: Buffer.alloc was being called on empty Buffer causing crash
- deps(all): bumped versions to latest
- test: added functional tests, covering:
  - plain text, multipart/alternative, multipart/mixed, nested multiparts
  - base64, quoted-printable, and 8bit transfer encodings
  - edge cases: malformed headers, missing multipart boundaries, and base64 wrapping with irregular line lengths and spaces.
  - backpressure: test for AttachmentStream pause()/resume()
- test: remove unnecessary done callbacks in synchronous tests #16
- doc(README): added coverage badge

### [1.2.6] - 2025-12-23

- feat: use iconv-lite by default
  - on conversion error, if iconv is installed (manually), try it
- deps(all): bump to latest

### [1.2.5] - 2025-01-31

- dep(all): bump to latest
- dep(eslint): upgrade to v9
- style(prettier): move config into package.json

### [1.2.4] - 2024-09-27

- allow attachment filenames containing semicolons #13

### [1.2.3] - 2024-04-24

- style(es6): replace forEach with for...of
- doc(CONTRIBUTORS): added

### [1.2.2] - 2024-04-07

- dep: eslint-plugin-haraka -> @haraka/eslint-config
- lint: updated .eslintrc
- package.json: updated scripts
- prettier

### [1.2.1] - 2024-04-03

- dep(libqp): bump to 2.1.0
- dep(libmime): bump to 5.3.4
- dep(haraka-message-stream): bump to 1.2.1
- dep(mocha & eslint): remove from devDeps (install as needed with npx)
- add ./test to .npmignore

### [1.2.0] - 2022-11-29

- dep(libqp): update from 1.1 -> 2.0.1

### [1.1.0] - 2022-09-14

- Do not insert banner in text attachments, #3
- chore(climate): configure code climate

### [1.0.0] - 2022-06-24

- Imported from [Haraka](https://github.com/haraka/Haraka)

[1.0.0]: https://github.com/haraka/email-message/releases/tag/v1.0.0
[1.1.0]: https://github.com/haraka/email-message/releases/tag/v1.1.0
[1.2.0]: https://github.com/haraka/email-message/releases/tag/v1.2.0
[1.2.1]: https://github.com/haraka/email-message/releases/tag/v1.2.1
[1.2.2]: https://github.com/haraka/email-message/releases/tag/v1.2.2
[1.2.3]: https://github.com/haraka/email-message/releases/tag/v1.2.3
[1.2.4]: https://github.com/haraka/email-message/releases/tag/v1.2.4
[1.2.5]: https://github.com/haraka/email-message/releases/tag/v1.2.5
[1.2.6]: https://github.com/haraka/email-message/releases/tag/v1.2.6
[1.2.7]: https://github.com/haraka/email-message/releases/tag/v1.2.7
[1.3.0]: https://github.com/haraka/email-message/releases/tag/v1.3.0
[1.3.1]: https://github.com/haraka/email-message/releases/tag/v1.3.1
[1.3.2]: https://github.com/haraka/email-message/releases/tag/v1.3.2
[1.3.3]: https://github.com/haraka/email-message/releases/tag/v1.3.3
[1.3.4]: https://github.com/haraka/email-message/releases/tag/v1.3.4
[1.4.0]: https://github.com/haraka/email-message/releases/tag/v1.4.0
[1.4.1]: https://github.com/haraka/email-message/releases/tag/v1.4.1
[1.4.2]: https://github.com/haraka/email-message/releases/tag/v1.4.2
[1.4.3]: https://github.com/haraka/email-message/releases/tag/v1.4.3
[1.4.4]: https://github.com/haraka/email-message/releases/tag/v1.4.4

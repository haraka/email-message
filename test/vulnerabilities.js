'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { Body, Header } = require('../index')

describe('Vulnerabilities', () => {
  test('Header prototype pollution', () => {
    const Header = require('../lib/header')
    const h = new Header()
    // Try adding dangerous headers
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      h.add(key, 'polluted')
    }
    // Should not crash, and should not pollute Object prototype
    assert.notEqual(
      {}.polluted,
      'polluted',
      'Object prototype should not be polluted',
    )
    assert.notEqual(
      Object.prototype.polluted,
      'polluted',
      'Object.prototype should not be polluted',
    )
    // Should not be retrievable
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      assert.equal(h.get(key), '')
    }
    // Parsing should also not allow pollution
    const h2 = new Header()
    h2.parse([
      '__proto__: polluted',
      'constructor: polluted',
      'prototype: polluted',
    ])
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      assert.equal(h2.get(key), '')
    }
    assert.notEqual(
      {}.polluted,
      'polluted',
      'Object prototype should not be polluted after parse',
    )
  })

  test('RFC 2231 Recursion (Stack Overflow)', () => {
    const header = new Header()
    const lines = [
      'Content-Disposition: attachment; ' +
        Array(10000)
          .fill(0)
          .map((_, i) => `f*${i}=a`)
          .join('; '),
    ]
    // This should NOT crash the process anymore
    assert.doesNotThrow(() => {
      header.parse(lines)
    })
  })

  test('Empty Boundary Vulnerability', () => {
    const body = new Body()
    // Simulate a multipart header with a space as boundary
    body.header.parse(['Content-Type: multipart/mixed; boundary=" "\n'])
    body.parse_more('-- \n')
    // It should NOT have transitioned to child state because boundary was rejected as empty-like
    assert.notEqual(
      body.state,
      'child',
      'Empty-like boundary should be rejected',
    )
  })

  test('MIME Nesting Recursion', () => {
    const nested_depth = 200 // Exceeds default max_mime_depth of 100
    const body = new Body()
    body.header.parse(['Content-Type: multipart/mixed; boundary=0\n'])
    body.parse_more('\n') // end headers

    for (let i = 0; i < nested_depth; i++) {
      body.parse_more(`--${i}\n`)
      body.parse_more(`Content-Type: multipart/mixed; boundary=${i + 1}\n\n`)
    }

    // Should not crash and should have stopped nesting
    assert.doesNotThrow(() => {
      body.parse_more('data\n')
    })

    // Verify it didn't create 200 children
    assert.ok(body.children.length < 200)
  })

  test('RFC 2231 quadratic ReDoS (GHSA-6f4j-gpc2-6p2g)', () => {
    // A header value that clears the `*`/`=` presence guard yet is built to
    // maximise backtracking in the old regex parser: a long run of attribute
    // characters ending in a lone `*`. The linear tokenizer must parse it in
    // time proportional to size, not size².
    const timeParse = (runLength) => {
      const value = `x*=y; ${'a'.repeat(runLength)}*`
      const lines = [`Content-Disposition: attachment; ${value}\n`]
      const started = process.hrtime.bigint()
      new Header().parse(lines)
      return Number(process.hrtime.bigint() - started) / 1e6
    }

    timeParse(50_000) // warm up
    const small = timeParse(100_000)
    const large = timeParse(800_000)

    // 8× the input under O(n²) is ~64× the work; a linear scan stays far below.
    assert.ok(
      large < Math.max(small * 20, 100),
      `non-linear RFC 2231 parse: 100KB=${small.toFixed(1)}ms 800KB=${large.toFixed(1)}ms`,
    )
  })

  test('RFC 2047 encoded-word quadratic ReDoS', () => {
    // Two decode_header regexes used to backtrack quadratically: the
    // whitespace-collapse between adjacent encoded-words, and the encoded-word
    // decoder itself (a `?B?` prefix with no closing `?=` starved the lazy
    // scan). Both must now be linear in the value length.
    const timeDecode = (build) => (n) => {
      const lines = [`Subject: ${build(n)}\n`]
      const started = process.hrtime.bigint()
      new Header().parse(lines)
      return Number(process.hrtime.bigint() - started) / 1e6
    }

    const vectors = {
      'collapse (=?=?…)': timeDecode((n) => '=?'.repeat(n)),
      'decoder (=?a?B?xxxx…)': timeDecode((n) => '=?a?B?xxxx'.repeat(n)),
    }

    for (const [name, time] of Object.entries(vectors)) {
      time(20_000) // warm up
      const small = time(50_000)
      const large = time(400_000)
      assert.ok(
        large < Math.max(small * 20, 100),
        `non-linear ${name}: 1x=${small.toFixed(1)}ms 8x=${large.toFixed(1)}ms`,
      )
    }
  })

  test('RFC 2047 encoded words cannot smuggle CRLF into a decoded header', () => {
    const payload = Buffer.from('evil\r\nX-Injected: yes').toString('base64')
    const header = new Header()
    header.parse([`Subject: =?utf-8?B?${payload}?=\n`])

    const subject = header.get_decoded('Subject')
    assert.ok(!/[\r\n]/.test(subject), `line breaks survived: ${subject}`)
    assert.match(subject, /evil/)
  })

  test('RFC 2047 encoded words cannot smuggle CRLF into an address phrase', () => {
    const payload = Buffer.from('evil\r\nX-Injected: yes').toString('base64')
    const header = new Header()
    header.parse([`From: =?utf-8?B?${payload}?= <a@example.com>\n`])

    const [addr] = header.get_addresses('From')
    assert.ok(
      !/[\r\n]/.test(addr.phrase),
      `line breaks survived: ${addr.phrase}`,
    )
  })

  test('Long unstructured From headers parse promptly', () => {
    const lines = ['Subject: hi\n', `From: ${'A'.repeat(15000)}\n`]
    let totalMs = 0

    for (let i = 0; i < 5; i++) {
      const header = new Header()
      const started = process.hrtime.bigint()
      header.parse(lines)
      totalMs += Number(process.hrtime.bigint() - started) / 1e6
    }

    const averageMs = totalMs / 5
    assert.ok(
      averageMs < 100,
      `average parse time was ${averageMs.toFixed(1)}ms for a 15KB From header`,
    )
  })

  const UNSAFE_NAMES = ['.', '..', '__proto__', 'constructor', 'prototype']

  // A bare "." / ".." line is an SMTP end-of-DATA terminator only at column 0;
  // a folded continuation (leading WSP) is a value, not a terminator.
  const bareTerminator = (s) =>
    s.split(/\r?\n/).some((l) => l === '.' || l === '..')

  for (const name of UNSAFE_NAMES) {
    test(`parse drops unsafe header name "${name}" in every framing`, () => {
      const variants = [
        `${name}\n`,
        `${name} \n`,
        `${name}\t\n`,
        `${name}  \r\n`,
        `${name}: v\n`,
        `${name} : v\n`,
        `${name}\n continuation\n`,
        `${name.toUpperCase()}: v\n`,
      ]
      for (const variant of variants) {
        const h = new Header()
        h.parse(['From: a@b.com\n', variant, 'To: c@d.com\n'])
        assert.deepEqual(
          h.header_list,
          ['From: a@b.com\n', 'To: c@d.com\n'],
          `variant ${JSON.stringify(variant)} was not dropped`,
        )
        assert.equal(bareTerminator(h.toString()), false)
        assert.equal(h.get(name), '')
      }
    })
  }

  test('parse decomposes bundled physical lines and drops embedded unsafe ones', () => {
    for (const name of UNSAFE_NAMES) {
      const h = new Header()
      h.parse([`X: a\n${name}: x\nY: b\n`, `Z: c\n${name}\n`])
      assert.equal(bareTerminator(h.toString()), false)
      assert.equal(h.get(name), '')
      assert.deepEqual(h.header_list, ['X: a\n', 'Y: b\n', 'Z: c\n'])
    }
  })

  test('parse folds a lone CR so a CR-delimited terminator/suffix is neutralised', () => {
    const h = new Header()
    h.parse(['Subject: safe\r.\rBcc: victim@example.test\n'])
    assert.equal(h.get('bcc'), '')
    const segs = h.toString().split(/\r\n|\r|\n/)
    assert.equal(
      segs.some((l) => l === '.' || l === '..' || /^Bcc:/i.test(l)),
      false,
    )
  })

  test('mutators fold a lone CR in the value', () => {
    for (const method of ['add', 'add_end']) {
      const h = new Header()
      h[method]('X-Foo', 'a\r.\rb')
      const segs = h.toString().split(/\r\n|\r|\n/)
      assert.equal(
        segs.some((l) => l === '.' || l === '..'),
        false,
      )
    }
  })

  test('parse does not promote a bare-CR suffix into an injected header', () => {
    const wraps = [(l) => [l], (l) => [`A: 1\n${l}B: 2\n`]]
    for (const wrap of wraps) {
      const h = new Header()
      h.parse(wrap('Subject: safe\rBcc: victim@example.test\n'))
      assert.equal(h.get('bcc'), '')
      assert.match(h.get('subject'), /^safe/)
      assert.ok(h.header_list.some((e) => e.startsWith('Subject: safe')))
      assert.ok(!h.header_list.some((e) => e.startsWith('Bcc:')))
    }
  })

  test('bundled headers serialize with one line break, not a blank line', () => {
    const h = new Header()
    h.parse(['X: a\nY: b\n'])
    assert.equal(h.toString(), 'X: a\nY: b\n')
    assert.equal(/\n\s*\n/.test(h.toString().replace(/\n$/, '')), false)
  })

  test('parse preserves a legit fold bundled in one element', () => {
    const h = new Header()
    h.parse(['legit: only\n more folded\n'])
    assert.deepEqual(h.header_list, ['legit: only\n more folded\n'])
    assert.equal(bareTerminator(h.toString()), false)
  })

  test('parse keeps ordinary headers, dot-prefixed names, and non-header junk', () => {
    const h = new Header()
    h.parse([
      'From: a@b.com\n',
      '.foo: bar\n',
      'This is not a header line\n',
      'To: c@d.com\n',
    ])
    assert.deepEqual(h.header_list, [
      'From: a@b.com\n',
      '.foo: bar\n',
      'This is not a header line\n',
      'To: c@d.com\n',
    ])
    assert.equal(h.invalid_headers, undefined)
  })

  for (const method of ['add', 'add_end']) {
    test(`${method}() refuses unsafe header names in every framing`, () => {
      for (const name of UNSAFE_NAMES) {
        for (const key of [name, name.toUpperCase(), `${name} `, ` ${name}`]) {
          const h = new Header()
          h[method](key, 'x')
          assert.equal(h.toString(), '', `key ${JSON.stringify(key)} leaked`)
          assert.deepEqual(h.header_list, [])
          assert.equal(h.get(name), '')
        }
      }
    })

    test(`${method}() cannot inject a terminator line via the value`, () => {
      for (const value of ['a\n.\nb', 'a\r\n.\r\nb', 'ok\n..\nmore', 'x\n.']) {
        const h = new Header()
        h[method]('X-Foo', value)
        assert.equal(bareTerminator(h.toString()), false)
      }
    })

    test(`${method}() cannot inject a line via a newline in the key`, () => {
      const h = new Header()
      h[method]('X\n.\n', 'v')
      assert.equal(bareTerminator(h.toString()), false)
    })
  }

  test('add()/add_end() still accept ordinary, dot-prefixed, and folded values', () => {
    const h = new Header()
    h.add('X-Last', 'z')
    h.add_end('.foo', 'bar')
    h.add('X-First', 'a')
    h.add_end('X-Folded', 'line1\n line2')
    assert.deepEqual(h.header_list, [
      'X-First: a\n',
      'X-Last: z\n',
      '.foo: bar\n',
      'X-Folded: line1\n line2\n',
    ])
    assert.equal(h.get('x-first'), 'a')
    assert.equal(h.get('.foo'), 'bar')
  })
})

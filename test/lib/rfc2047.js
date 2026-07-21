const { describe, it } = require('node:test')
const assert = require('node:assert')
const { decode } = require('../../lib/rfc2047')

// Render each encoded-word as <charset|encoding|text> so the extracted fields
// and the passthrough/whitespace handling are both visible in the output.
const mark = (charset, encoding, text) => `<${charset}|${encoding}|${text}>`
const render = (str) => decode(str, mark)

describe('rfc2047', () => {
  describe('grammar', () => {
    it('decodes a single encoded-word', () => {
      assert.equal(render('=?UTF-8?Q?foo?='), '<UTF-8|Q|foo>')
    })

    it('keeps = padding in a base64 encoded-word text', () => {
      assert.equal(render('=?utf-8?b?aGk=?='), '<utf-8|b|aGk=>')
    })

    it('accepts an RFC 2231 language tag on the charset', () => {
      assert.equal(render('=?UTF-8*en?Q?x?='), '<UTF-8|Q|x>')
    })

    it('keeps surrounding text', () => {
      assert.equal(render('a =?UTF-8?Q?x?= b'), 'a <UTF-8|Q|x> b')
    })

    it('leaves an unknown encoding as literal text', () => {
      assert.equal(render('=?UTF-8?Z?foo?='), '=?UTF-8?Z?foo?=')
    })

    it('leaves an unterminated word as literal text', () => {
      assert.equal(render('=?UTF-8?Q?foo'), '=?UTF-8?Q?foo')
    })

    it('never calls decodeWord for a malformed word', () => {
      let calls = 0
      const out = decode('=?UTF-8?Z?foo?= =?bad', () => {
        calls++
        return 'X'
      })
      assert.equal(calls, 0)
      assert.equal(out, '=?UTF-8?Z?foo?= =?bad')
    })
  })

  describe('adjacent-word whitespace (RFC 2047 §6.2)', () => {
    it('drops whitespace between two adjacent encoded-words', () => {
      assert.equal(
        render('=?UTF-8?Q?foo?= =?UTF-8?Q?bar?='),
        '<UTF-8|Q|foo><UTF-8|Q|bar>',
      )
    })

    it('drops whitespace across a run of adjacent encoded-words', () => {
      assert.equal(
        render('=?U?Q?a?=  =?U?Q?b?=\t=?U?Q?c?='),
        '<U|Q|a><U|Q|b><U|Q|c>',
      )
    })

    it('keeps whitespace when a non-word separates the encoded-words', () => {
      assert.equal(render('=?U?Q?a?= x =?U?Q?b?='), '<U|Q|a> x <U|Q|b>')
    })

    it('keeps whitespace between a word and surrounding text', () => {
      assert.equal(render('hi =?U?Q?a?= there'), 'hi <U|Q|a> there')
    })
  })

  it('returns input unchanged when there are no encoded-words', () => {
    assert.equal(render('just text ?= =? here'), 'just text ?= =? here')
    assert.equal(render(''), '')
  })

  describe('linear time', () => {
    const time = (str) => {
      const t = process.hrtime.bigint()
      decode(str, mark)
      return Number(process.hrtime.bigint() - t) / 1e6
    }

    const cases = {
      'unterminated word body': (n) => `=?a?B?${'x'.repeat(n)}`,
      'adjacent =? starts': (n) => '=?'.repeat(n),
      'word prefixes without a terminator': (n) => '=?a?B?xxxx'.repeat(n),
    }

    for (const [name, build] of Object.entries(cases)) {
      it(name, () => {
        time(build(20_000))
        const small = time(build(100_000))
        const large = time(build(800_000))
        assert.ok(
          large < Math.max(small * 20, 50),
          `non-linear scaling: 1×=${small.toFixed(1)}ms 8×=${large.toFixed(1)}ms`,
        )
      })
    }
  })
})

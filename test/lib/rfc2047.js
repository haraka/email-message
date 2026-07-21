const { describe, it } = require('node:test')
const assert = require('node:assert')
const { tokenize } = require('../../lib/rfc2047')

const all = (str) => [...tokenize(str)]
// Render segments compactly: encoded-words as <charset|encoding|text>.
const render = (str) =>
  all(str)
    .map((s) =>
      s.encoded ? `<${s.charset}|${s.encoding}|${s.text}>` : s.value,
    )
    .join('')

describe('rfc2047', () => {
  describe('grammar', () => {
    it('parses a single encoded-word', () => {
      assert.deepEqual(all('=?UTF-8?Q?foo?='), [
        { encoded: true, charset: 'UTF-8', encoding: 'Q', text: 'foo' },
      ])
    })

    it('parses a base64 encoded-word with = padding in the text', () => {
      assert.deepEqual(all('=?utf-8?b?aGk=?='), [
        { encoded: true, charset: 'utf-8', encoding: 'b', text: 'aGk=' },
      ])
    })

    it('accepts an RFC 2231 language tag on the charset', () => {
      assert.deepEqual(all('=?UTF-8*en?Q?x?='), [
        { encoded: true, charset: 'UTF-8', encoding: 'Q', text: 'x' },
      ])
    })

    it('keeps surrounding text as passthrough segments', () => {
      assert.deepEqual(all('a =?UTF-8?Q?x?= b'), [
        { encoded: false, value: 'a ' },
        { encoded: true, charset: 'UTF-8', encoding: 'Q', text: 'x' },
        { encoded: false, value: ' b' },
      ])
    })

    it('leaves an unknown encoding as literal text', () => {
      assert.deepEqual(all('=?UTF-8?Z?foo?='), [
        { encoded: false, value: '=?UTF-8?Z?foo?=' },
      ])
    })

    it('leaves an unterminated word as literal text', () => {
      assert.deepEqual(all('=?UTF-8?Q?foo'), [
        { encoded: false, value: '=?UTF-8?Q?foo' },
      ])
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

  it('yields a single passthrough segment when there are no encoded-words', () => {
    assert.deepEqual(all('just text ?= =? here'), [
      { encoded: false, value: 'just text ?= =? here' },
    ])
    assert.deepEqual(all(''), [])
  })

  describe('linear time', () => {
    const time = (str) => {
      const t = process.hrtime.bigint()
      for (const seg of tokenize(str)) void seg
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

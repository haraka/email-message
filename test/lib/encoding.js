const { describe, it } = require('node:test')
const assert = require('node:assert')
const encoding = require('../../lib/encoding')
const Body = require('../../lib/body')

describe('encoding', () => {
  it('try_convert fallback when iconv-lite fails', () => {
    const data = Buffer.from('hello')
    // Force failure by passing an invalid encoding

    const result = encoding.try_convert(data, 'NONEXISTENT-ENCODING')
    assert.equal(result, 'hello')
  })

  it('Iconv is exported (might be undefined)', () => {
    assert.ok('Iconv' in encoding)
  })

  it('uses iconv-lite for common encoding (ISO-8859-1)', () => {
    const body = new Body()
    body.state = 'headers'
    ;[
      'Content-Type: text/plain; charset=iso-8859-1\n',
      'Content-Transfer-Encoding: 8bit\n',
      '\n',
      // 0xE9 = é in ISO-8859-1
      Buffer.from([0x43, 0x61, 0x66, 0xe9]),
    ].forEach((line) => body.parse_more(line))
    body.parse_end()

    assert.ok(body.bodytext.includes('Caf'))
    assert.ok(
      body.bodytext.includes('é') || body.bodytext.charCodeAt(3) === 0xe9,
    )
  })

  it('uses iconv-lite for UTF-8', () => {
    const body = new Body()
    body.state = 'headers'
    ;[
      'Content-Type: text/plain; charset=utf-8\n',
      'Content-Transfer-Encoding: 8bit\n',
      '\n',
      Buffer.from('Hello World'),
    ].forEach((line) => body.parse_more(line))
    body.parse_end()

    assert.equal(body.bodytext, 'Hello World')
  })

  it('verifies native iconv is loaded as fallback', (t) => {
    let Iconv
    try {
      Iconv = require('iconv').Iconv
    } catch (ignore) {
      t.skip()
      return
    }

    assert.ok(Iconv, 'Native iconv should be loaded')

    const converter = new Iconv('ISO-8859-1', 'UTF-8')
    assert.ok(converter, 'Should be able to create iconv converter')
  })

  it('attempts iconv fallback for unsupported encoding', () => {
    const body = new Body()
    body.state = 'headers'
    ;[
      'Content-Type: text/plain; charset=x-mac-cyrillic\n',
      'Content-Transfer-Encoding: 8bit\n',
      '\n',
      Buffer.from('Test'),
    ].forEach((line) => body.parse_more(line))
    body.parse_end()

    assert.ok(body.bodytext.length > 0)
    assert.ok(body.bodytext.includes('Test'))
  })

  it('falls back to toString for completely unsupported encoding', () => {
    const body = new Body()
    body.state = 'headers'
    ;[
      'Content-Type: text/plain; charset=FAKE-ENCODING\n',
      'Content-Transfer-Encoding: 8bit\n',
      '\n',
      Buffer.from('ASCII text'),
    ].forEach((line) => body.parse_more(line))
    body.parse_end()

    assert.ok(body.bodytext.length > 0)
    assert.equal(body.body_encoding, 'broken//FAKE-ENCODING')
  })

  it('handles toString fallback gracefully', () => {
    const body = new Body()
    body.state = 'headers'
    ;[
      'Content-Type: text/plain; charset=INVALID\n',
      'Content-Transfer-Encoding: 8bit\n',
      '\n',
      Buffer.from('Plain ASCII'),
    ].forEach((line) => body.parse_more(line))
    body.parse_end()

    assert.equal(body.bodytext, 'Plain ASCII')
    assert.equal(body.body_encoding, 'broken//INVALID')
  })
})

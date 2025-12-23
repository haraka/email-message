const assert = require('assert')
const Body = require('../index').Body

// NOTE: Testing the actual iconv fallback is system-dependent. These tests
// verify that common encodings work and unsupported encodings don't crash.

describe('encoding fallback', function () {
  describe('iconv-lite primary path', function () {
    it('uses iconv-lite for common encoding (ISO-8859-1)', function (done) {
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
      assert.ok(body.bodytext.includes('é') || body.bodytext.charCodeAt(3) === 0xe9)
      done()
    })

    it('uses iconv-lite for UTF-8', function (done) {
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
      done()
    })
  })

  describe('iconv fallback path', function () {
    it('verifies native iconv is loaded as fallback', function (done) {
      let Iconv
      try {
        Iconv = require('iconv').Iconv
      } catch (e) {
        this.skip()
      }

      assert.ok(Iconv, 'Native iconv should be loaded')

      const converter = new Iconv('ISO-8859-1', 'UTF-8')
      assert.ok(converter, 'Should be able to create iconv converter')
      done()
    })

    it('attempts iconv fallback for unsupported encoding', function (done) {
      const body = new Body()
      body.state = 'headers'

      // Test with encoding that iconv-lite doesn't support
      ;[
        'Content-Type: text/plain; charset=x-mac-cyrillic\n',
        'Content-Transfer-Encoding: 8bit\n',
        '\n',
        Buffer.from('Test'),
      ].forEach((line) => body.parse_more(line))
      body.parse_end()

      assert.ok(body.bodytext.length > 0)
      assert.ok(body.bodytext.includes('Test'))
      done()
    })
  })

  describe('final fallback path', function () {
    it('falls back to toString for completely unsupported encoding', function (done) {
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
      done()
    })

    it('handles toString fallback gracefully', function (done) {
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
      done()
    })
  })
})

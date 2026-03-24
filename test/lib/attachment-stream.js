const { describe, it } = require('node:test')
const assert = require('node:assert')
const AttachmentStream = require('../../lib/attachment-stream')
const Header = require('../../lib/header')

function makeStream() {
  const header = new Header()
  return new AttachmentStream(header)
}

describe('AttachmentStream', function () {
  describe('data emission', function () {
    it('emits data immediately when not paused', () =>
      new Promise((resolve, reject) => {
        const stream = makeStream()
        const chunk = Buffer.from('hello')
        stream.on('data', (data) => {
          try {
            assert.deepEqual(data, chunk)
            resolve()
          } catch (err) {
            reject(err)
          }
        })
        stream.emit_data(chunk)
      }))

    it('buffers data while paused', function () {
      const stream = makeStream()
      const received = []
      stream.on('data', (data) => received.push(data))

      stream.pause()
      stream.emit_data(Buffer.from('a'))
      stream.emit_data(Buffer.from('b'))

      assert.equal(received.length, 0)
    })

    it('flushes buffer on resume', () =>
      new Promise((resolve, reject) => {
        const stream = makeStream()
        const received = []
        stream.on('data', (data) => received.push(data.toString()))
        stream.on('end', () => {
          try {
            assert.deepEqual(received, ['a', 'b'])
            resolve()
          } catch (err) {
            reject(err)
          }
        })

        stream.pause()
        stream.emit_data(Buffer.from('a'))
        stream.emit_data(Buffer.from('b'))
        stream.emit_end(false) // deferred — paused

        stream.resume()
      }))
  })

  describe('end emission', function () {
    it('emits end immediately when not paused', () =>
      new Promise((resolve) => {
        const stream = makeStream()
        stream.on('end', resolve)
        stream.emit_end()
      }))

    it('defers end when paused', () =>
      new Promise((resolve, reject) => {
        const stream = makeStream()
        let endFired = false
        stream.on('end', () => {
          endFired = true
          resolve()
        })

        stream.pause()
        stream.emit_end()
        try {
          assert.ok(!endFired)
        } catch (err) {
          reject(err)
          return
        }

        stream.resume()
      }))

    it('force_end emits even while paused', () =>
      new Promise((resolve) => {
        const stream = makeStream()
        stream.on('end', resolve)
        stream.pause()
        stream.emit_end(true)
      }))
  })

  describe('setEncoding', function () {
    it('binary encoding emits strings', () =>
      new Promise((resolve, reject) => {
        const stream = makeStream()
        stream.setEncoding('binary')
        stream.on('data', (data) => {
          try {
            assert.equal(typeof data, 'string')
            resolve()
          } catch (err) {
            reject(err)
          }
        })
        stream.emit_data(Buffer.from('hello'))
      }))

    it('rejects non-binary encodings', function () {
      const stream = makeStream()
      assert.throws(() => stream.setEncoding('utf8'), /binary/)
    })
  })

  describe('header', function () {
    it('exposes header publicly', function () {
      const header = new Header()
      header.parse(['X-Foo: bar'])
      const stream = new AttachmentStream(header)
      assert.equal(stream.header.get('x-foo'), 'bar')
    })
  })
})

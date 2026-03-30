const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert')
const { Writable } = require('node:stream')
const AttachmentStream = require('../../lib/attachment-stream')
const Header = require('../../lib/header')

describe('AttachmentStream', () => {
  let stream

  beforeEach(() => {
    stream = new AttachmentStream(new Header())
  })

  describe('data emission', () => {
    it('emits data immediately when not paused', () =>
      new Promise((resolve, reject) => {
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

    it('buffers data while paused', () => {
      const received = []
      stream.on('data', (data) => received.push(data))

      stream.pause()
      stream.emit_data(Buffer.from('a'))
      stream.emit_data(Buffer.from('b'))

      assert.equal(received.length, 0)
    })

    it('flushes buffer on resume', () =>
      new Promise((resolve, reject) => {
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

    it('connection pause/resume', () => {
      let paused = false
      let resumed = false
      stream.connection = {
        pause: () => {
          paused = true
        },
        resume: () => {
          resumed = true
        },
      }
      stream.pause()
      assert.ok(paused)
      stream.resume()
      assert.ok(resumed)
    })

    it('pipe events trigger resume', () =>
      new Promise((resolve) => {
        const dest = new Writable({
          write(chunk, enc, cb) {
            cb()
          },
        })

        stream.pipe(dest)
        stream.pause()

        // Mock resume to check if called
        let resumed = false
        const origResume = stream.resume
        stream.resume = function () {
          resumed = true
          origResume.call(this)
        }

        dest.emit('drain')
        assert.ok(resumed)

        resumed = false
        stream.pause()
        dest.emit('end')
        assert.ok(resumed)

        resumed = false
        stream.pause()
        dest.emit('close')
        assert.ok(resumed)

        resolve()
      }))
  })

  describe('end emission', () => {
    it('emits end immediately when not paused', () =>
      new Promise((resolve) => {
        stream.on('end', resolve)
        stream.emit_end()
      }))

    it('defers end when paused', () =>
      new Promise((resolve, reject) => {
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
        stream.on('end', resolve)
        stream.pause()
        stream.emit_end(true)
      }))

    it('destroy', () => {
      assert.doesNotThrow(() => stream.destroy())
    })
  })

  describe('setEncoding', () => {
    it('binary encoding emits strings', () =>
      new Promise((resolve, reject) => {
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

    it('rejects non-binary encodings', () => {
      assert.throws(() => stream.setEncoding('utf8'), /binary/)
    })
  })

  describe('header', () => {
    it('exposes header publicly', () => {
      const header = new Header()
      header.parse(['X-Foo: bar'])
      const stream2 = new AttachmentStream(header)
      assert.equal(stream2.header.get('x-foo'), 'bar')
    })
  })
})

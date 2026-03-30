const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert')
const AttachmentStream = require('../../lib/attachment-stream')
const Header = require('../../lib/header')
const { Writable } = require('node:stream')

describe('AttachmentStream', () => {
  beforeEach(() => {
    this.stream = new AttachmentStream(new Header())
  })

  describe('data emission', () => {
    it('emits data immediately when not paused', () =>
      new Promise((resolve, reject) => {
        const chunk = Buffer.from('hello')
        this.stream.on('data', (data) => {
          try {
            assert.deepEqual(data, chunk)
            resolve()
          } catch (err) {
            reject(err)
          }
        })
        this.stream.emit_data(chunk)
      }))

    it('buffers data while paused', () => {
      const received = []
      this.stream.on('data', (data) => received.push(data))

      this.stream.pause()
      this.stream.emit_data(Buffer.from('a'))
      this.stream.emit_data(Buffer.from('b'))

      assert.equal(received.length, 0)
    })

    it('flushes buffer on resume', () =>
      new Promise((resolve, reject) => {
        const received = []
        this.stream.on('data', (data) => received.push(data.toString()))
        this.stream.on('end', () => {
          try {
            assert.deepEqual(received, ['a', 'b'])
            resolve()
          } catch (err) {
            reject(err)
          }
        })

        this.stream.pause()
        this.stream.emit_data(Buffer.from('a'))
        this.stream.emit_data(Buffer.from('b'))
        this.stream.emit_end(false) // deferred — paused

        this.stream.resume()
      }))

    it('connection pause/resume', () => {
      let paused = false
      let resumed = false
      this.stream.connection = {
        pause: () => {
          paused = true
        },
        resume: () => {
          resumed = true
        },
      }
      this.stream.pause()
      assert.ok(paused)
      this.stream.resume()
      assert.ok(resumed)
    })

    it('pipe events trigger resume', () =>
      new Promise((resolve) => {
        const dest = new Writable({
          write(chunk, enc, cb) {
            cb()
          },
        })

        this.stream.pipe(dest)
        this.stream.pause()

        // Mock resume to check if called
        let resumed = false
        const origResume = this.stream.resume
        this.stream.resume = function () {
          resumed = true
          origResume.call(this)
        }

        dest.emit('drain')
        assert.ok(resumed)

        resumed = false
        this.stream.pause()
        dest.emit('end')
        assert.ok(resumed)

        resumed = false
        this.stream.pause()
        dest.emit('close')
        assert.ok(resumed)

        resolve()
      }))
  })

  describe('end emission', () => {
    it('emits end immediately when not paused', () =>
      new Promise((resolve) => {
        this.stream.on('end', resolve)
        this.stream.emit_end()
      }))

    it('defers end when paused', () =>
      new Promise((resolve, reject) => {
        let endFired = false
        this.stream.on('end', () => {
          endFired = true
          resolve()
        })

        this.stream.pause()
        this.stream.emit_end()
        try {
          assert.ok(!endFired)
        } catch (err) {
          reject(err)
          return
        }

        this.stream.resume()
      }))

    it('force_end emits even while paused', () =>
      new Promise((resolve) => {
        this.stream.on('end', resolve)
        this.stream.pause()
        this.stream.emit_end(true)
      }))

    it('destroy', () => {
      assert.doesNotThrow(() => this.stream.destroy())
    })
  })

  describe('setEncoding', () => {
    it('binary encoding emits strings', () =>
      new Promise((resolve, reject) => {
        this.stream.setEncoding('binary')
        this.stream.on('data', (data) => {
          try {
            assert.equal(typeof data, 'string')
            resolve()
          } catch (err) {
            reject(err)
          }
        })
        this.stream.emit_data(Buffer.from('hello'))
      }))

    it('rejects non-binary encodings', () => {
      assert.throws(() => this.stream.setEncoding('utf8'), /binary/)
    })
  })

  describe('header', () => {
    it('exposes header publicly', () => {
      const header = new Header()
      header.parse(['X-Foo: bar'])
      const stream = new AttachmentStream(header)
      assert.equal(stream.header.get('x-foo'), 'bar')
    })
  })
})

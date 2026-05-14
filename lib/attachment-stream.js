'use strict'

const { Stream } = require('node:stream')
const config = require('haraka-config')

// Cap on bytes held in the pause buffer before we give up. When a consumer
// pauses, .pause() also calls connection?.pause() — so the buffer only grows
// if pause isn't propagating end-to-end. At that point we can't do real
// backpressure (emit_data is fire-and-forget) so we abort and surface the
// failure rather than grow without bound.
const DEFAULT_MAX_PAUSE_BUFFERED =
  config.get('mailparser.attachment_max_buffered') || 64 * 1024 * 1024

class AttachmentStream extends Stream {
  #paused = false
  #buffer = []
  #bufferBytes = 0
  #endEmitted = false
  #encoding = null
  #maxPauseBuffered
  #aborted = false

  constructor(header, options) {
    super()
    this.header = header
    this.connection = null
    this.#maxPauseBuffered =
      options?.maxPauseBuffered ?? DEFAULT_MAX_PAUSE_BUFFERED
  }

  emit_data(data) {
    if (this.#aborted) return
    if (this.#paused) {
      if (this.#bufferBytes + data.length > this.#maxPauseBuffered) {
        this.#abort(
          new Error(
            `paused attachment buffer would exceed mailparser.attachment_max_buffered (${this.#maxPauseBuffered} bytes)`,
          ),
        )
        return
      }
      this.#buffer.push(data)
      this.#bufferBytes += data.length
      return
    }
    this.emit('data', this.#encoding ? data.toString(this.#encoding) : data)
  }

  emit_end(force) {
    if (this.#aborted) return
    if (this.#paused && !force) {
      this.#endEmitted = true
      return
    }
    while (this.#buffer.length > 0) {
      const data = this.#buffer.shift()
      this.#bufferBytes -= data.length
      this.emit('data', this.#encoding ? data.toString(this.#encoding) : data)
    }
    this.emit('end')
  }

  pipe(dest, options) {
    this.#paused = false
    const pipe = Stream.prototype.pipe.call(this, dest, options)
    dest.on('drain', () => {
      if (this.#paused) this.resume()
    })
    dest.on('end', () => {
      if (this.#paused) this.resume()
    })
    dest.on('close', () => {
      if (this.#paused) this.resume()
    })
    return pipe
  }

  setEncoding(enc) {
    if (enc !== 'binary')
      throw new Error('Unable to set encoding to anything other than binary')
    this.#encoding = enc
  }

  pause() {
    this.#paused = true
    this.connection?.pause()
  }

  resume() {
    if (this.#aborted) return
    this.connection?.resume()
    this.#paused = false
    if (this.#buffer.length > 0) {
      while (!this.#paused && this.#buffer.length > 0) {
        const data = this.#buffer.shift()
        this.#bufferBytes -= data.length
        this.emit_data(data)
      }
      if (this.#buffer.length === 0 && this.#endEmitted) this.emit('end')
    } else if (this.#endEmitted) {
      this.emit('end')
    }
  }

  #abort(err) {
    this.#aborted = true
    this.#buffer = []
    this.#bufferBytes = 0
    try {
      this.connection?.resume()
    } catch {
      // best-effort: we're already in failure mode
    }
    this.emit('error', err)
  }

  destroy() {}
}

module.exports = AttachmentStream

'use strict'

const { Stream } = require('node:stream')

class AttachmentStream extends Stream {
  #paused = false
  #buffer = []
  #endEmitted = false
  #encoding = null

  constructor(header) {
    super()
    this.header = header
    this.connection = null
  }

  emit_data(data) {
    if (this.#paused) {
      this.#buffer.push(data)
      return
    }
    this.emit('data', this.#encoding ? data.toString(this.#encoding) : data)
  }

  emit_end(force) {
    if (this.#paused && !force) {
      this.#endEmitted = true
      return
    }
    while (this.#buffer.length > 0) {
      const data = this.#buffer.shift()
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
    this.connection?.resume()
    this.#paused = false
    if (this.#buffer.length > 0) {
      while (!this.#paused && this.#buffer.length > 0) {
        this.emit_data(this.#buffer.shift())
      }
      if (this.#buffer.length === 0 && this.#endEmitted) this.emit('end')
    } else if (this.#endEmitted) {
      this.emit('end')
    }
  }

  destroy() {}
}

module.exports = AttachmentStream

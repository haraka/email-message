'use strict'

const { EventEmitter } = require('node:events')
const config = require('haraka-config')
const libqp = require('libqp')

const logger = require('./logger')
const { iconv, Iconv } = require('./encoding')
const Header = require('./header')
const AttachmentStream = require('./attachment-stream')

const buf_siz = config.get('mailparser.bufsize') || 65536

// ── Banner helpers ────────────────────────────────────────────────────────────

function _get_html_insert_position(buf) {
  if (buf.length === 0) return 0

  for (let i = 0, l = buf.length; i < l; i++) {
    if (buf[i] === 60 && buf[i + 1] === 47) {
      // "</"
      if (
        (buf[i + 2] === 98 || buf[i + 2] === 66) && // b B
        (buf[i + 3] === 111 || buf[i + 3] === 79) && // o O
        (buf[i + 4] === 100 || buf[i + 4] === 68) && // d D
        (buf[i + 5] === 121 || buf[i + 5] === 89) && // y Y
        buf[i + 6] === 62
      ) {
        return i // </body>
      }
      if (
        (buf[i + 2] === 104 || buf[i + 2] === 72) && // h H
        (buf[i + 3] === 116 || buf[i + 3] === 84) && // t T
        (buf[i + 4] === 109 || buf[i + 4] === 77) && // m M
        (buf[i + 5] === 108 || buf[i + 5] === 76) && // l L
        buf[i + 6] === 62
      ) {
        return i // </html>
      }
    }
  }
  return buf.length - 1
}

function insert_banner(ct, enc, buf, cd, banners) {
  if (!banners || !/^text\//i.test(ct) || /^attachment/i.test(cd)) return

  const is_html = /text\/html/i.test(ct)
  const banner_str = banners[is_html ? 1 : 0]
  let banner_buf = null

  try {
    banner_buf = iconv.encode(banner_str, enc)
  } catch {
    if (Iconv) {
      try {
        banner_buf = new Iconv('UTF-8', `${enc}//IGNORE`).convert(banner_str)
      } catch (iconvErr) {
        logger.logerror(
          `iconv conversion of banner to ${enc} failed: ${iconvErr}`,
        )
      }
    } else {
      logger.logerror(
        `iconv-lite doesn't support encoding '${enc}' for banner conversion`,
      )
    }
  }

  if (!banner_buf) banner_buf = Buffer.from(banner_str)

  const new_buf = Buffer.alloc(
    buf.length + banner_buf.length + (is_html ? 7 : 2),
  )

  if (is_html) {
    let insert_pos = _get_html_insert_position(buf)
    buf.copy(new_buf, 0, 0, insert_pos)
    new_buf[insert_pos++] = 60 // <
    new_buf[insert_pos++] = 80 // P
    new_buf[insert_pos++] = 62 // >
    banner_buf.copy(new_buf, insert_pos)
    new_buf[banner_buf.length + insert_pos++] = 60 // <
    new_buf[banner_buf.length + insert_pos++] = 47 // /
    new_buf[banner_buf.length + insert_pos++] = 80 // P
    new_buf[banner_buf.length + insert_pos++] = 62 // >
    if (buf.length > insert_pos - 7) {
      buf.copy(new_buf, insert_pos + banner_buf.length, insert_pos - 7)
    }
  } else {
    buf.copy(new_buf)
    new_buf[buf.length] = 10 // \n
    banner_buf.copy(new_buf, buf.length + 1)
    new_buf[buf.length + banner_buf.length + 1] = 10 // \n
  }

  return new_buf
}

// ── Body ─────────────────────────────────────────────────────────────────────

class Body extends EventEmitter {
  // Private internal state
  #options
  #isHtml = false
  #boundary = null
  #attachmentStream = null
  #buf = Buffer.alloc(buf_siz)
  #bufFill = 0
  #bodyTextEncoded = Buffer.alloc(buf_siz)
  #bodyTextEncodedPos = 0
  #decodeAccumulator = ''

  constructor(header, options) {
    super()
    this.header = header ?? new Header()
    this.header_lines = []
    this.options = options ?? {}
    this.filters = []
    this.bodytext = ''
    this.body_encoding = null
    this.ct = null
    this.children = []
    this.state = 'start'
    // decode_function and decode_qp/decode_7bit are kept non-private to allow
    // the dynamic dispatch pattern `this[`decode_${enc}`]` in parse_start,
    // and reference-equality checks in parse_end.
    this.decode_qp = (line) => libqp.decode(line.toString())
    this.decode_7bit = this.decode_8bit
    this.decode_function = null
  }

  add_filter(filter) {
    this.filters.push(filter)
  }

  set_banner(banners) {
    this.add_filter((ct, enc, buf, cd) =>
      insert_banner(ct, enc, buf, cd, banners),
    )
  }

  parse_more(line) {
    if (!Buffer.isBuffer(line)) line = Buffer.from(line)
    return this[`parse_${this.state}`](line)
  }

  parse_child(line) {
    const line_string = line.toString()

    if (
      line_string.substr(0, this.#boundary.length + 2) === `--${this.#boundary}`
    ) {
      line = this.children[this.children.length - 1].parse_end(line)

      if (line_string.substr(this.#boundary.length + 2, 2) === '--') {
        this.state = 'end'
      } else {
        this.emit('mime_boundary', line_string)
        const bod = new Body(new Header(), this.options)
        for (const ln of [
          'attachment_start',
          'attachment_data',
          'attachment_end',
          'mime_boundary',
        ]) {
          for (const cb of this.listeners(ln)) bod.on(ln, cb)
        }
        for (const f of this.filters) bod.add_filter(f)
        this.children.push(bod)
        bod.state = 'headers'
      }
      return line
    }

    return this.children[this.children.length - 1].parse_more(line)
  }

  parse_headers(line) {
    const line_string = line.toString()

    if (/^\s*$/.test(line_string)) {
      this.header.parse(this.header_lines)
      delete this.header_lines
      this.state = 'start'
    } else {
      this.header_lines.push(line_string)
    }
    return line
  }

  parse_start(line) {
    const ct = this.header.get_decoded('content-type') || 'text/plain'
    let enc = this.header.get_decoded('content-transfer-encoding') || '8bit'
    const cd = this.header.get_decoded('content-disposition') || ''

    if (/text\/html/i.test(ct)) this.#isHtml = true

    enc = enc.toLowerCase().split('\n').pop().trim()
    if (!enc.match(/^base64|quoted-printable|[78]bit$/i)) {
      logger.logwarn(`Invalid CTE on email: ${enc}, using 8bit`)
      enc = '8bit'
    }
    enc = enc.replace(/^quoted-printable$/i, 'qp')

    this.decode_function = this[`decode_${enc}`]
    if (!this.decode_function) {
      logger.logerror(`No decode function found for: ${enc}`)
      this.decode_function = this.decode_8bit
    }
    this.ct = ct

    const buildRegex = (key) =>
      new RegExp(`${key}\\s*=\\s*"([^"]+)"|${key}\\s*=\\s*"?([^";]+)"?`, 'i')
    const matchKey = (test, key) =>
      test.match(buildRegex(key))?.filter((item) => item)

    let match
    if (/^(?:text|message)\//i.test(ct) && !/^attachment/i.test(cd)) {
      this.state = 'body'
    } else if (/^multipart\//i.test(ct)) {
      match = matchKey(ct, 'boundary')
      this.#boundary = match ? match[1] : ''
      this.state = 'multipart_preamble'
    } else {
      match = matchKey(cd, 'name') ?? matchKey(ct, 'name')
      const filename = match ? match[1] : ''
      this.#attachmentStream = new AttachmentStream(this.header)
      this.emit('attachment_start', ct, filename, this, this.#attachmentStream)
      this.#bufFill = 0
      this.state = 'attachment'
    }

    return this[`parse_${this.state}`](line)
  }

  _empty_filter(ct, enc, cd) {
    let new_buf = Buffer.from('')
    for (const filter of this.filters) {
      new_buf = filter(ct, enc, new_buf, cd) ?? new_buf
    }
    return new_buf
  }

  _emit_buf_fill() {
    if (this.#bufFill > 0) {
      const to_emit = Buffer.alloc(this.#bufFill)
      this.#buf.copy(to_emit, 0, 0, this.#bufFill)
      this.#attachmentStream.emit_data(to_emit)
      this.#bufFill = 0
    }
  }

  force_end() {
    if (this.state === 'attachment') {
      this._emit_buf_fill()
      this.#attachmentStream.emit_end(true)
    }
  }

  parse_end(line) {
    if (!line) line = Buffer.from('')

    if (this.state === 'attachment') {
      this._emit_buf_fill()
      this.#attachmentStream.emit_end()
    }

    const ct = this.header.get_decoded('content-type') || 'text/plain'
    let enc = 'UTF-8'
    const matches = /\bcharset\s*=\s*(?:"|3D|')?([\w_-]*)(?:"|3D|')?/.exec(ct)
    if (matches) {
      const pre_enc = matches[1].trim()
      if (pre_enc.length > 0) enc = pre_enc
    }
    this.body_encoding = enc

    const cd = this.header.get_decoded('content-disposition') || ''
    if (!this.#bodyTextEncodedPos) {
      return Buffer.concat([
        this._empty_filter(ct, enc, cd) ?? Buffer.from(''),
        line,
      ])
    }
    if (this.bodytext.length !== 0) return line

    let buf = this.decode_function(
      this.#bodyTextEncoded.slice(0, this.#bodyTextEncodedPos),
    )

    if (this.filters.length) {
      let new_buf = buf
      for (const filter of this.filters) {
        new_buf = filter(ct, enc, new_buf) ?? new_buf
      }

      if (this.decode_function === this.decode_qp) {
        line = Buffer.from(`${libqp.wrap(libqp.encode(new_buf))}\n${line}`)
      } else if (this.decode_function === this.decode_base64) {
        line = Buffer.from(
          new_buf.toString('base64').replace(/(.{1,76})/g, '$1\n') + line,
        )
      } else {
        line = Buffer.concat([new_buf, line])
      }

      buf = new_buf
    }

    this.#try_iconv(buf, enc)
    return line
  }

  #try_iconv(buf, enc) {
    if (/UTF-?8/i.test(enc)) {
      this.bodytext = buf.toString()
      return
    }
    try {
      this.bodytext = iconv.decode(buf, enc)
    } catch {
      if (Iconv) {
        try {
          this.bodytext = new Iconv(enc, 'UTF-8//TRANSLIT//IGNORE')
            .convert(buf)
            .toString()
          return
        } catch (iconvErr) {
          logger.logwarn(
            `iconv conversion from ${enc} to UTF-8 failed: ${iconvErr.message}`,
          )
        }
      } else {
        logger.logwarn(
          `iconv-lite doesn't support encoding '${enc}'. Install iconv for rare encoding support: npm install iconv`,
        )
      }
      this.body_encoding = `broken//${enc}`
      this.bodytext = buf.toString()
    }
  }

  parse_body(line) {
    if (!Buffer.isBuffer(line)) line = Buffer.from(line)

    if (this.#bodyTextEncodedPos + line.length > this.#bodyTextEncoded.length) {
      let new_size = this.#bodyTextEncoded.length * 2
      while (this.#bodyTextEncodedPos + line.length > new_size) new_size *= 2
      const new_buf = Buffer.alloc(new_size)
      this.#bodyTextEncoded.copy(new_buf, 0, 0, this.#bodyTextEncodedPos)
      this.#bodyTextEncoded = new_buf
    }

    line.copy(this.#bodyTextEncoded, this.#bodyTextEncodedPos)
    this.#bodyTextEncodedPos += line.length

    if (this.filters.length) return ''
    return line
  }

  parse_multipart_preamble(line) {
    if (!this.#boundary) return line
    const line_string = line.toString()

    if (
      line_string.substr(0, this.#boundary.length + 2) === `--${this.#boundary}`
    ) {
      if (line_string.substr(this.#boundary.length + 2, 2) !== '--') {
        this.emit('mime_boundary', line_string)
        const bod = new Body(new Header(), this.options)
        for (const ln of ['attachment_start', 'mime_boundary']) {
          for (const cb of this.listeners(ln)) bod.on(ln, cb)
        }
        for (const f of this.filters) bod.add_filter(f)
        this.children.push(bod)
        bod.state = 'headers'
        this.state = 'child'
      }
    }

    return line
  }

  parse_attachment(line) {
    const line_string = line.toString()

    if (this.#boundary) {
      if (
        line_string.substr(0, this.#boundary.length + 2) ===
        `--${this.#boundary}`
      ) {
        if (line_string.substr(this.#boundary.length + 2, 2) !== '--') {
          this.state = 'headers'
        }
        return line
      }
    }

    const buf = this.decode_function(line)
    if (buf.length + this.#bufFill > buf_siz) {
      const to_emit = Buffer.alloc(this.#bufFill)
      this.#buf.copy(to_emit, 0, 0, this.#bufFill)
      this.#attachmentStream.emit_data(to_emit)
      if (buf.length > buf_siz) {
        this.#attachmentStream.emit_data(buf)
        this.#bufFill = 0
      } else {
        buf.copy(this.#buf)
        this.#bufFill = buf.length
      }
    } else {
      buf.copy(this.#buf, this.#bufFill)
      this.#bufFill += buf.length
    }
    return line
  }

  decode_base64(line) {
    let to_process =
      this.#decodeAccumulator + line.toString().trim().replace(/[\s]+/g, '')

    const emit_length = to_process.length - (to_process.length % 4)

    if (emit_length > 0) {
      this.#decodeAccumulator = to_process.substring(emit_length)
      return Buffer.from(to_process.substring(0, emit_length), 'base64')
    }

    this.#decodeAccumulator = ''
    while (to_process.length > 0 && to_process.length < 4) to_process += '='
    return Buffer.from(to_process, 'base64')
  }

  decode_8bit(line) {
    return Buffer.from(line, 'binary')
  }
}

module.exports = Body

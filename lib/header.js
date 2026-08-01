'use strict'

const libmime = require('libmime')
const libqp = require('libqp')
const { parseHeader } = require('@haraka/email-address')
const logger = require('./logger')
const { try_convert } = require('./encoding')
const { tokenize } = require('./rfc2231')
const { decode: decode2047 } = require('./rfc2047')

/* eslint no-control-regex: 0 */

function _decode_word(charset, encoding, text) {
  let data
  switch (encoding.toUpperCase()) {
    case 'Q':
      data = libqp.decode(text.replace(/_/g, ' '))
      break
    case 'B':
      data = Buffer.from(text, 'base64')
      break
  }
  if (!/UTF-?8/i.test(charset)) return try_convert(data, charset)
  return data.toString()
}

function _decode_words(str) {
  return /=\?/.test(str) ? decode2047(str, _decode_word) : str
}

function _decode_address_words(addr) {
  if (addr.phrase) addr.phrase = _decode_words(addr.phrase)
  if (addr.comment) addr.comment = _decode_words(addr.comment)
  if (Array.isArray(addr.addresses)) {
    for (const a of addr.addresses) _decode_address_words(a)
  }
  return addr
}

function _parse_rfc2231(params, str) {
  // Fast-path: an RFC 2231 parameter always contains both `*` and `=`; skip the
  // scan for the common header (Subject, From, ...) that has neither.
  if (str.indexOf('*') === -1 || str.indexOf('=') === -1) return

  for (const { attribute, section, value: raw } of tokenize(str)) {
    let value = raw

    const lang_match = /^(.*?)'(.*?)'(.*)/.exec(value)
    if (lang_match) {
      if (attribute === params.cur_key && lang_match[2] !== params.cur_lang) {
        continue
      }
      params.cur_enc = lang_match[1]
      params.cur_lang = lang_match[2]
      value = lang_match[3]
    } else if (attribute !== params.cur_key) {
      params.cur_lang = ''
      params.cur_enc = ''
    }

    params.cur_key = attribute
    params.keys[attribute] = ''
    params.kv[`${attribute}*${section}`] = value
  }
}

function _decode_rfc2231(params, str) {
  _parse_rfc2231(params, str)

  for (const key in params.keys) {
    str += ` ${key}="`
    /* eslint no-constant-condition: 0 */
    let merged = ''
    for (let i = 0; true; i++) {
      const _val = params.kv[`${key}*${i}`]
      if (_val === undefined) break
      merged += _val
    }

    try {
      merged = decodeURIComponent(merged)
    } catch {
      logger.logerror(`Decode header failed: ${key}: ${merged}`)
    }

    if (params.cur_enc) {
      merged = try_convert(Buffer.from(merged, 'utf8'), params.cur_enc)
    }

    str += `${merged}";`
  }

  return str
}

// An RFC 2822 email header parser
class Header {
  constructor() {
    this.headers = Object.create(null)
    this.headers_decoded = Object.create(null)
    this.header_list = []
  }

  parse(lines) {
    for (const line of lines) {
      if (/^[ \t]/.test(line)) {
        this.header_list[this.header_list.length - 1] += line
      } else {
        this.header_list.push(line)
      }
    }

    for (const header of this.header_list) {
      const match = header.match(/^([^\s:]*):\s*([\s\S]*)$/)
      if (match) {
        this._add_header(match[1].toLowerCase(), match[2], 'push')
      } else {
        logger.lognotice(`Header did not look right: ${header}`)
      }
    }

    for (const key of Object.keys(this.headers)) {
      for (const val of this.headers[key]) {
        this._add_header_decode(key, val, 'push')
      }
    }
  }

  decode_header(val) {
    val = val.replace(/\r?\n/g, '')

    const rfc2231_params = {
      kv: {},
      keys: {},
      cur_key: '',
      cur_enc: '',
      cur_lang: '',
    }

    val = _decode_rfc2231(rfc2231_params, val)

    if (!/^[\x00-\x7f]*$/.test(val)) {
      const matches = /\bcharset\s*=\s*["']?([\w_-]*)/.exec(
        this.get('content-type'),
      )
      if (matches && !/UTF-?8/i.test(matches[1])) {
        val = try_convert(Buffer.from(val, 'binary'), matches[1])
      }
    }

    if (!/=\?/.test(val)) return val

    return decode2047(val, _decode_word)
  }

  get(key) {
    return (this.headers[key.toLowerCase()] ?? []).join('\n')
  }

  get_all(key) {
    return Object.freeze([...(this.headers[key.toLowerCase()] ?? [])])
  }

  get_decoded(key) {
    return (this.headers_decoded[key.toLowerCase()] ?? []).join('\n')
  }

  // Convenience accessor for address-valued headers (From, To, Cc, Reply-To,
  // etc.). Returns the parsed `(Address | Group)[]` from @haraka/email-address;
  // empty array if the header is missing. Throws on malformed input — call
  // with try/catch when you can't trust the source.
  //
  // Parses the raw header, then decodes encoded-words in the phrases. RFC 2047
  // exists so a display-name can carry specials (`,`, `<`) without breaking the
  // structured grammar; decoding first re-introduces them unquoted, and a phrase
  // like `Mozipremierek, filmes hírek` then fails to parse as an address list.
  get_addresses(key) {
    const val = this.get(key)
    if (!val) return []
    return parseHeader(val).map((addr) => _decode_address_words(addr))
  }

  remove(key) {
    key = key.toLowerCase()
    delete this.headers[key]
    delete this.headers_decoded[key]
    this._remove_more(key)
  }

  _remove_more(key) {
    const key_len = key.length
    for (let i = 0, l = this.header_list.length; i < l; i++) {
      if (
        this.header_list[i].substring(0, key_len + 1).toLowerCase() ===
        `${key}:`
      ) {
        this.header_list.splice(i, 1)
        return this._remove_more(key)
      }
    }
  }

  add(key, value) {
    if (!key) key = 'X-Haraka-Blank'
    value = trimNewlines(value)
    if (/[^\x00-\x7f]/.test(value)) value = libmime.encodeWords(value, 'Q')
    this._add_header(key.toLowerCase(), value, 'unshift')
    this._add_header_decode(key.toLowerCase(), value, 'unshift')
    this.header_list.unshift(`${key}: ${value}\n`)
  }

  add_end(key, value) {
    if (!key) key = 'X-Haraka-Blank'
    value = trimNewlines(value)
    if (/[^\x00-\x7f]/.test(value)) value = libmime.encodeWords(value, 'Q')
    this._add_header(key.toLowerCase(), value, 'push')
    this._add_header_decode(key.toLowerCase(), value, 'push')
    this.header_list.push(`${key}: ${value}\n`)
  }

  _add_header(key, value, method) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) return
    this.headers[key] ??= []
    this.headers[key][method](value)
  }

  _add_header_decode(key, value, method) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) return
    this.headers_decoded[key] ??= []
    this.headers_decoded[key][method](this.decode_header(value))
  }

  lines() {
    return Object.freeze([...this.header_list])
  }

  toString() {
    return this.header_list.join('\n')
  }
}

function trimNewlines(value) {
  // 4B ops/sec vs regex at 1.4M ops/sec
  while (value.length > 0) {
    if (value.endsWith('\n')) {
      if (value.endsWith('\r\n')) {
        value = value.slice(0, -2)
      } else {
        value = value.slice(0, -1)
      }
    } else {
      break // Stop at a stray \r or any other character
    }
  }
  return value
}

module.exports = Header

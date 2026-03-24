'use strict'

const libmime = require('libmime')
const libqp = require('libqp')
const logger = require('./logger')
const { try_convert } = require('./encoding')

/* eslint no-control-regex: 0 */

function _decode_header(matched, encoding, lang, cte, data) {
  cte = cte.toUpperCase()
  switch (cte) {
    case 'Q':
      data = libqp.decode(data.replace(/_/g, ' '))
      break
    case 'B':
      data = Buffer.from(data, 'base64')
      break
    default:
      logger.logerror(`Invalid header encoding type: ${cte}`)
  }
  if (!/UTF-?8/i.test(encoding)) return try_convert(data, encoding)
  return data.toString()
}

function _parse_rfc2231(params, str) {
  const sub_matches =
    /(([!#$%&'*+.0-9A-Zdiff^_`a-z{|}~-]*)\*)(\d*)=(\s*".*?[^\\]";?|\S*)/.exec(
      str,
    )
  if (!sub_matches) return

  const key = sub_matches[1]
  let key_actual = sub_matches[2]
  let key_id = sub_matches[3] || '0'
  let value = sub_matches[4].replace(/;$/, '')

  str = str.replace(sub_matches[0], '')

  const key_extract = /^(.*?)(\*(\d+)\*)$/.exec(key)
  if (key_extract) {
    key_actual = key_extract[1]
    key_id = key_extract[3]
  }

  const quote = /^\s*"(.*)"$/.exec(value)
  if (quote) value = quote[1]

  const lang_match = /^(.*?)'(.*?)'(.*)/.exec(value)
  if (lang_match) {
    if (key_actual === params.cur_key && lang_match[2] !== params.cur_lang) {
      return _parse_rfc2231(params, str)
    }
    params.cur_enc = lang_match[1]
    params.cur_lang = lang_match[2]
    value = lang_match[3]
  } else if (key_actual !== params.cur_key) {
    params.cur_lang = ''
    params.cur_enc = ''
  }

  params.cur_key = key_actual
  params.keys[key_actual] = ''
  params.kv[`${key_actual}*${key_id}`] = value
  return _parse_rfc2231(params, str)
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
  #options

  constructor(options) {
    this.headers = {}
    this.headers_decoded = {}
    this.header_list = []
    this.#options = options
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

    return val
      .replace(/(=\?.+?\?=)\s+(?==\?.+?\?=)/g, '$1')
      .replace(
        /=\?([\w_-]+)(\*[\w_-]+)?\?([bqBQ])\?([\s\S]*?)\?=/g,
        _decode_header,
      )
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
    value = value.replace(/(\r?\n)*$/, '')
    if (/[^\x00-\x7f]/.test(value)) value = libmime.encodeWords(value, 'Q')
    this._add_header(key.toLowerCase(), value, 'unshift')
    this._add_header_decode(key.toLowerCase(), value, 'unshift')
    this.header_list.unshift(`${key}: ${value}\n`)
  }

  add_end(key, value) {
    if (!key) key = 'X-Haraka-Blank'
    value = value.replace(/(\r?\n)*$/, '')
    if (/[^\x00-\x7f]/.test(value)) value = libmime.encodeWords(value, 'Q')
    this._add_header(key.toLowerCase(), value, 'push')
    this._add_header_decode(key.toLowerCase(), value, 'push')
    this.header_list.push(`${key}: ${value}\n`)
  }

  _add_header(key, value, method) {
    this.headers[key] ??= []
    this.headers[key][method](value)
  }

  _add_header_decode(key, value, method) {
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

module.exports = Header

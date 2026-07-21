'use strict'

// Single-pass tokenizer for RFC 2231 §3/§4 extended and continued header
// parameters: `attribute*=value`, `attribute*N=value` and `attribute*N*=value`.
//
// a hand-written forward-only character scanner, O(n) for all inputs.
// Every prior regex form of this grammar backtracked catastrophically on
// crafted header values.

const WS = /\s/ // single-character test only; no quantifier, cannot backtrack

// RFC 2045 `token` characters minus the RFC 2231 delimiters `*` and `=` and
// whitespace. Indexed by char code so the hot loop branches on an array read.
const ATTR_CHAR = new Uint8Array(128)
for (const ch of "!#$%&'+.^_`{|}~-0123456789") ATTR_CHAR[ch.charCodeAt(0)] = 1
for (let c = 0x41; c <= 0x5a; c++) ATTR_CHAR[c] = 1 // A-Z
for (let c = 0x61; c <= 0x7a; c++) ATTR_CHAR[c] = 1 // a-z

function isAttrChar(cc) {
  return cc < 128 && ATTR_CHAR[cc] === 1
}

function isDigit(cc) {
  return cc >= 0x30 && cc <= 0x39
}

// Yields `{ attribute, section, value }` for each RFC 2231 parameter found
// anywhere in `str`. `section` is the continuation index as a string ('0' when
// the parameter is not continued). `value` is the raw text after `=` with any
// surrounding quotes removed; charset/language decoding is the caller's job.
function* tokenize(str) {
  const n = str.length
  let i = 0

  while (i < n) {
    const nameStart = i
    while (i < n && isAttrChar(str.charCodeAt(i))) i++

    // A parameter starts only with `attribute*`. Anything else: step past one
    // character so the scan always makes progress
    if (i <= nameStart || i >= n || str[i] !== '*') {
      if (i === nameStart) i++
      continue
    }

    const attribute = str.slice(nameStart, i)
    i++ // consume the mandatory `*`

    const sectionStart = i
    while (i < n && isDigit(str.charCodeAt(i))) i++
    const section = i > sectionStart ? str.slice(sectionStart, i) : '0'

    if (i < n && str[i] === '*') i++ // optional encoded-continuation flag

    if (i >= n || str[i] !== '=') continue
    i++ // consume `=`

    let value

    // Quoted-string value: optional leading whitespace, then `"..."` where a
    // backslash escapes the next character. Rare for RFC 2231 (values are
    // usually percent-encoded and bare) but accepted for faithfulness.
    let j = i
    while (j < n && WS.test(str[j])) j++
    if (j < n && str[j] === '"') {
      let k = j + 1
      let closed = false
      while (k < n) {
        const c = str[k]
        if (c === '\\') {
          k += 2
          continue
        }
        if (c === '"') {
          closed = true
          break
        }
        k++
      }
      if (closed) {
        value = str.slice(j + 1, k)
        i = k + 1
        if (i < n && str[i] === ';') i++
      }
    }

    // Bare value: a run of non-whitespace, less a single trailing `;`.
    if (value === undefined) {
      const valueStart = i
      while (i < n && !WS.test(str[i])) i++
      value = str.slice(valueStart, i)
      if (value.endsWith(';')) value = value.slice(0, -1)
    }

    yield { attribute, section, value }
  }
}

module.exports = { tokenize }

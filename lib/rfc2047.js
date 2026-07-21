'use strict'

// Single-pass scanner for RFC 2047 'encoded-word's — `=?charset?encoding?text?=`
// — plus the RFC 2047 §6.2 rule that whitespace separating two adjacent
// encoded-words is dropped on decoding.
//
// this is a hand-written, forward-only character scanner. A scan that never
// revisits a consumed character is O(n) for all inputs, and keeps that guarantee
// structural.

const WS = /\s/ // single-character test only; no quantifier

// `[\w_-]` — the charset and language token characters, indexed by char code.
const TOKEN_CHAR = new Uint8Array(128)
for (let c = 0x30; c <= 0x39; c++) TOKEN_CHAR[c] = 1 // 0-9
for (let c = 0x41; c <= 0x5a; c++) TOKEN_CHAR[c] = 1 // A-Z
for (let c = 0x61; c <= 0x7a; c++) TOKEN_CHAR[c] = 1 // a-z
TOKEN_CHAR[0x5f] = 1 // _
TOKEN_CHAR[0x2d] = 1 // -

const EQ = 0x3d // =
const QUESTION = 0x3f // ?
const STAR = 0x2a // *

function isToken(cc) {
  return cc < 128 && TOKEN_CHAR[cc] === 1
}

// Parse an encoded-word at `start`, where str[start..] begins `=?`. Returns
// `{ charset, encoding, text, end }`, or null when the bytes there are not a
// well-formed encoded-word — in which case the caller keeps `=?` as literal
// text. Every field stops at its `?` delimiter or whitespace, so the scan is
// deterministic and linear.
function parseWord(str, start, n) {
  let i = start + 2 // past `=?`

  const charsetStart = i
  while (i < n && isToken(str.charCodeAt(i))) i++
  if (i === charsetStart) return null // charset is required
  const charset = str.slice(charsetStart, i)

  // Optional RFC 2231 language tag (`*lang`); parsed to stay in sync, unused.
  if (i < n && str.charCodeAt(i) === STAR) {
    i++
    const langStart = i
    while (i < n && isToken(str.charCodeAt(i))) i++
    if (i === langStart) return null
  }

  if (str.charCodeAt(i) !== QUESTION) return null
  i++

  const encoding = str[i]
  if (
    encoding !== 'b' &&
    encoding !== 'B' &&
    encoding !== 'q' &&
    encoding !== 'Q'
  ) {
    return null
  }
  i++

  if (str.charCodeAt(i) !== QUESTION) return null
  i++

  const textStart = i
  while (i < n && str.charCodeAt(i) !== QUESTION && !WS.test(str[i])) i++
  const text = str.slice(textStart, i)

  if (str.charCodeAt(i) !== QUESTION || str.charCodeAt(i + 1) !== EQ)
    return null
  return { charset, encoding, text, end: i + 2 }
}

// Yields the segments of `str` in order:
//   { encoded: false, value }                   passthrough text
//   { encoded: true, charset, encoding, text }  an encoded-word to decode
// Whitespace separating two adjacent encoded-words is not emitted (RFC 2047
// §6.2); whitespace anywhere else is preserved in a passthrough segment.
function* tokenize(str) {
  const n = str.length
  let i = 0
  let literalStart = 0
  let lastWasWord = false // previous emitted segment was an encoded-word
  let gapAllWhitespace = true // only whitespace seen since that word

  while (i < n) {
    const word =
      str.charCodeAt(i) === EQ && str.charCodeAt(i + 1) === QUESTION
        ? parseWord(str, i, n)
        : null

    if (word) {
      if (lastWasWord && gapAllWhitespace) {
        // Adjacent encoded-words: drop the whitespace between them.
      } else if (i > literalStart) {
        yield { encoded: false, value: str.slice(literalStart, i) }
      }
      yield {
        encoded: true,
        charset: word.charset,
        encoding: word.encoding,
        text: word.text,
      }
      i = word.end
      literalStart = i
      lastWasWord = true
      gapAllWhitespace = true
      continue
    }

    if (!WS.test(str[i])) gapAllWhitespace = false
    i++
  }

  if (i > literalStart) yield { encoded: false, value: str.slice(literalStart) }
}

module.exports = { tokenize }

'use strict'

const iconv = require('iconv-lite')
const logger = require('./logger')

// Optional native iconv for encodings iconv-lite doesn't cover
let Iconv
try {
  Iconv = require('iconv').Iconv
} catch {
  logger.lognotice(
    'Using iconv-lite only. To support rare encodings: npm install iconv',
  )
}

function try_convert(data, encoding) {
  try {
    return iconv.decode(data, encoding)
  } catch {
    if (Iconv) {
      try {
        const converter = new Iconv(encoding, 'UTF-8//TRANSLIT//IGNORE')
        return converter.convert(data).toString()
      } catch (iconvErr) {
        logger.logwarn(
          `iconv conversion from ${encoding} to UTF-8 failed: ${iconvErr.message}`,
        )
      }
    } else {
      logger.logwarn(
        `iconv-lite doesn't support encoding '${encoding}'. Install iconv for rare encoding support: npm install iconv`,
      )
    }
    return data.toString()
  }
}

module.exports = { iconv, Iconv, try_convert }

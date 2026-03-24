'use strict'

let logger
try {
  logger = require('../logger')
} catch {
  logger = {
    lognotice: console.log,
    logerror: console.error,
    logwarn: console.error,
  }
}

module.exports = logger

'use strict'

const Header = require('./lib/header')
const Body = require('./lib/body')
const AttachmentStream = require('./lib/attachment-stream')

exports.Header = Header
exports.Body = Body
exports.stream = require('haraka-message-stream')
exports.createAttachmentStream = (header) => new AttachmentStream(header)

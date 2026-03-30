'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert')
const { Body, Header } = require('../index')

describe('Vulnerabilities', () => {
  test('Header prototype pollution', () => {
    const Header = require('../lib/header')
    const h = new Header()
    // Try adding dangerous headers
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      h.add(key, 'polluted')
    }
    // Should not crash, and should not pollute Object prototype
    assert.notEqual(
      {}.polluted,
      'polluted',
      'Object prototype should not be polluted',
    )
    assert.notEqual(
      Object.prototype.polluted,
      'polluted',
      'Object.prototype should not be polluted',
    )
    // Should not be retrievable
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      assert.equal(h.get(key), '')
    }
    // Parsing should also not allow pollution
    const h2 = new Header()
    h2.parse([
      '__proto__: polluted',
      'constructor: polluted',
      'prototype: polluted',
    ])
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      assert.equal(h2.get(key), '')
    }
    assert.notEqual(
      {}.polluted,
      'polluted',
      'Object prototype should not be polluted after parse',
    )
  })

  test('RFC 2231 Recursion (Stack Overflow)', () => {
    const header = new Header()
    const lines = [
      'Content-Disposition: attachment; ' +
        Array(10000)
          .fill(0)
          .map((_, i) => `f*${i}=a`)
          .join('; '),
    ]
    // This should NOT crash the process anymore
    assert.doesNotThrow(() => {
      header.parse(lines)
    })
  })

  test('Empty Boundary Vulnerability', () => {
    const body = new Body()
    // Simulate a multipart header with a space as boundary
    body.header.parse(['Content-Type: multipart/mixed; boundary=" "\n'])
    body.parse_more('-- \n')
    // It should NOT have transitioned to child state because boundary was rejected as empty-like
    assert.notEqual(
      body.state,
      'child',
      'Empty-like boundary should be rejected',
    )
  })

  test('MIME Nesting Recursion', () => {
    const nested_depth = 200 // Exceeds default max_mime_depth of 100
    const body = new Body()
    body.header.parse(['Content-Type: multipart/mixed; boundary=0\n'])
    body.parse_more('\n') // end headers

    for (let i = 0; i < nested_depth; i++) {
      body.parse_more(`--${i}\n`)
      body.parse_more(`Content-Type: multipart/mixed; boundary=${i + 1}\n\n`)
    }

    // Should not crash and should have stopped nesting
    assert.doesNotThrow(() => {
      body.parse_more('data\n')
    })

    // Verify it didn't create 200 children
    assert.ok(body.children.length < 200)
  })
})

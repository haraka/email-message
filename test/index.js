const { describe, it } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { Body, Header } = require('../index')

function parseMessage(lines) {
  const header = new Header()
  const headerLines = []
  let i = 0
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (line === '\n' || line === '\r\n' || line === '') {
      break
    }
    headerLines.push(line.endsWith('\n') ? line : `${line}\n`)
  }
  header.parse(headerLines)

  const body = new Body(header)
  for (i++; i < lines.length; i++) {
    body.parse_more(lines[i])
  }
  body.parse_end()
  return body
}

describe('parsing', () => {
  it('parses a simple plain text email', () => {
    const lines = [
      'From: sender@example.com\n',
      'To: receiver@example.com\n',
      'Subject: Simple Test\n',
      'Content-Type: text/plain; charset=utf-8\n',
      '\n',
      'This is a simple test email.\n',
      'It has two lines.\n',
    ]
    const body = parseMessage(lines)

    assert.equal(body.header.get('Subject').trim(), 'Simple Test')
    assert.equal(
      body.bodytext.trim(),
      'This is a simple test email.\nIt has two lines.',
    )
    assert.equal(body.children.length, 0)
  })

  it('parses a multipart/alternative email', () => {
    const lines = [
      'From: sender@example.com\n',
      'To: receiver@example.com\n',
      'Subject: Multipart Test\n',
      'Content-Type: multipart/alternative; boundary=boundary123\n',
      '\n',
      'This is the preamble and should be ignored.\n',
      '--boundary123\n',
      'Content-Type: text/plain; charset=utf-8\n',
      '\n',
      'Plain text version.\n',
      '--boundary123\n',
      'Content-Type: text/html; charset=utf-8\n',
      '\n',
      '<p>HTML version.</p>\n',
      '--boundary123--\n',
    ]
    const body = parseMessage(lines)

    assert.equal(body.children.length, 2)
    assert.ok(body.children[0].ct.includes('text/plain'))
    assert.equal(body.children[0].bodytext.trim(), 'Plain text version.')
    assert.ok(body.children[1].ct.includes('text/html'))
    assert.equal(body.children[1].bodytext.trim(), '<p>HTML version.</p>')
  })

  it('parses a multipart/mixed email with attachment', () =>
    new Promise((resolve, reject) => {
      const lines = [
        'From: sender@example.com\n',
        'To: receiver@example.com\n',
        'Subject: Attachment Test\n',
        'Content-Type: multipart/mixed; boundary=boundary123\n',
        '\n',
        '--boundary123\n',
        'Content-Type: text/plain; charset=utf-8\n',
        '\n',
        'See attached file.\n',
        '--boundary123\n',
        'Content-Type: application/octet-stream; name="test.txt"\n',
        'Content-Disposition: attachment; filename="test.txt"\n',
        'Content-Transfer-Encoding: base64\n',
        '\n',
        `${Buffer.from('Hello World').toString('base64')}\n`,
        '--boundary123--\n',
      ]

      const header = new Header()
      header.parse(lines.slice(0, 4))
      const body = new Body(header)

      body.on('attachment_start', (ct, filename, part, stream) => {
        try {
          assert.ok(ct.includes('application/octet-stream'))
          assert.equal(filename, 'test.txt')
        } catch (err) {
          reject(err)
          return
        }

        let data = Buffer.alloc(0)
        stream.on('data', (chunk) => {
          data = Buffer.concat([data, chunk])
        })
        stream.on('end', () => {
          try {
            assert.equal(data.toString(), 'Hello World')
            resolve()
          } catch (err) {
            reject(err)
          }
        })
      })

      for (let i = 5; i < lines.length; i++) body.parse_more(lines[i])
      body.parse_end()
    }))

  it('parses nested multiparts', () =>
    new Promise((resolve, reject) => {
      const lines = [
        'Content-Type: multipart/mixed; boundary=outer\n',
        '\n',
        '--outer\n',
        'Content-Type: multipart/alternative; boundary=inner\n',
        '\n',
        '--inner\n',
        'Content-Type: text/plain\n',
        '\n',
        'Inner text\n',
        '--inner\n',
        'Content-Type: text/html\n',
        '\n',
        '<b>Inner html</b>\n',
        '--inner--\n',
        '--outer\n',
        'Content-Type: text/plain\n',
        'Content-Disposition: attachment; filename="outer.txt"\n',
        '\n',
        'Outer attachment\n',
        '--outer--\n',
      ]

      const header = new Header()
      header.parse(lines.slice(0, 1))
      const body = new Body(header)

      let outerAttachmentData = Buffer.alloc(0)

      body.on('attachment_start', (ct, filename, part, stream) => {
        try {
          assert.equal(filename, 'outer.txt')
        } catch (err) {
          reject(err)
          return
        }
        stream.on('data', (chunk) => {
          outerAttachmentData = Buffer.concat([outerAttachmentData, chunk])
        })
        stream.on('end', () => {
          try {
            assert.equal(
              outerAttachmentData.toString().trim(),
              'Outer attachment',
            )
            resolve()
          } catch (err) {
            reject(err)
          }
        })
      })

      for (let i = 2; i < lines.length; i++) body.parse_more(lines[i])
      body.parse_end()

      try {
        assert.equal(body.children.length, 2)
        assert.equal(body.children[0].children.length, 2)
        assert.equal(body.children[0].children[0].bodytext.trim(), 'Inner text')
        assert.equal(
          body.children[0].children[1].bodytext.trim(),
          '<b>Inner html</b>',
        )
      } catch (err) {
        reject(err)
      }
    }))

  it('handles base64 transfer encoding in body', () => {
    const content = 'This is a base64 encoded body.'
    const lines = [
      'Content-Type: text/plain; charset=utf-8\n',
      'Content-Transfer-Encoding: base64\n',
      '\n',
      `${Buffer.from(content).toString('base64')}\n`,
    ]
    const body = parseMessage(lines)
    assert.equal(body.bodytext.trim(), content)
  })

  it('handles quoted-printable transfer encoding in body', () => {
    const content =
      'This is a quoted-printable encoded body with special chars: = ? !'
    const lines = [
      'Content-Type: text/plain; charset=utf-8\n',
      'Content-Transfer-Encoding: quoted-printable\n',
      '\n',
      'This is a quoted-printable encoded body with special chars: =3D =3F =21\n',
    ]
    const body = parseMessage(lines)
    assert.equal(body.bodytext.trim(), content)
  })

  describe('edge cases', () => {
    it('handles malformed headers gracefully', () => {
      const lines = [
        'From: sender@example.com\n',
        'MalformedHeaderNoColon\n',
        'Subject: Test\n',
        '\n',
        'Body\n',
      ]
      const body = parseMessage(lines)
      assert.equal(body.header.get('Subject').trim(), 'Test')
      assert.equal(body.bodytext.trim(), 'Body')
    })

    it('handles missing multipart boundary gracefully', () => {
      const lines = [
        'Content-Type: multipart/alternative; boundary=missing\n',
        '\n',
        'This is the preamble.\n',
        '--wrongboundary\n',
        'Content-Type: text/plain\n',
        '\n',
        'Content that looks like it belongs to a part but boundary is wrong.\n',
      ]
      const body = parseMessage(lines)
      // If boundary is never found, it stays in multipart_preamble state
      // or child state but never finishes parts properly if they don't match.
      assert.equal(body.children.length, 0)
    })

    it('grows body buffer for large bodies', () => {
      const largeContent = 'a'.repeat(100000) // Default buf_siz is 65536
      const lines = ['Content-Type: text/plain\n', '\n', `${largeContent}\n`]
      const body = parseMessage(lines)
      assert.equal(body.bodytext.length, 100001) // +1 for \n
      assert.equal(body.bodytext.trim(), largeContent)
    })

    it('handles base64 with various line lengths and padding', () => {
      const content = 'The quick brown fox jumps over the lazy dog'
      const base64 = Buffer.from(content).toString('base64')
      // Split base64 into irregular lines
      const wrappedBase64 = `${base64.substring(0, 10)}\n${base64.substring(
        10,
        15,
      )}  \n${base64.substring(15)}\n`

      const lines = [
        'Content-Type: text/plain\n',
        'Content-Transfer-Encoding: base64\n',
        '\n',
        wrappedBase64,
      ]
      const body = parseMessage(lines)
      assert.equal(body.bodytext.trim(), content)
    })

    it('handles AttachmentStream pause/resume', () =>
      new Promise((resolve, reject) => {
        const largeContent = 'b'.repeat(100000)
        const lines = [
          'Content-Type: application/octet-stream; name="pause.txt"\n',
          'Content-Disposition: attachment; filename="pause.txt"\n',
          'Content-Transfer-Encoding: base64\n',
          '\n',
          `${Buffer.from(largeContent).toString('base64')}\n`,
        ]

        const header = new Header()
        header.parse(lines.slice(0, 3))
        const body = new Body(header)

        body.on('attachment_start', (ct, filename, part, stream) => {
          let receivedData = Buffer.alloc(0)
          stream.pause()

          stream.on('data', (chunk) => {
            receivedData = Buffer.concat([receivedData, chunk])
          })
          stream.on('end', () => {
            try {
              assert.equal(receivedData.toString(), largeContent)
              resolve()
            } catch (err) {
              reject(err)
            }
          })

          setTimeout(() => {
            try {
              assert.equal(
                receivedData.length,
                0,
                'Should not have received data while paused',
              )
              stream.resume()
            } catch (err) {
              reject(err)
            }
          }, 10)
        })

        for (let i = 4; i < lines.length; i++) body.parse_more(lines[i])
        body.parse_end()
      }))
  })

  describe('fixtures', () => {
    it('parses haraka-icon-attach.eml', () => {
      const eml = fs.readFileSync(
        path.join(__dirname, 'fixtures', 'haraka-icon-attach.eml'),
      )
      const body = new Body()
      let attachmentSeen = false
      body.on('attachment_start', (ct, filename, part, stream) => {
        attachmentSeen = true
        assert.equal(filename, '1111229.png')
        stream.resume() // drain it
      })

      const lines = eml.toString().split('\n')
      const headerLines = []
      let i = 0
      for (; i < lines.length; i++) {
        if (lines[i] === '\r' || lines[i] === '' || lines[i] === '\n') break
        headerLines.push(`${lines[i]}\n`)
      }
      body.header.parse(headerLines)

      for (i++; i < lines.length; i++) {
        body.parse_more(`${lines[i]}\n`)
      }
      body.parse_end()

      assert.ok(attachmentSeen)
      assert.equal(body.children.length, 2)
    })

    it('parses haraka-tarball-attach.eml', () => {
      const eml = fs.readFileSync(
        path.join(__dirname, 'fixtures', 'haraka-tarball-attach.eml'),
      )
      const body = new Body()
      let attachmentSeen = false
      body.on('attachment_start', (ct, filename, part, stream) => {
        attachmentSeen = true
        assert.equal(filename, 'haraka-test-fixtures-1.0.35.tar')
        stream.resume() // drain it
      })

      const lines = eml.toString().split('\n')
      const headerLines = []
      let i = 0
      for (; i < lines.length; i++) {
        if (lines[i] === '\r' || lines[i] === '' || lines[i] === '\n') break
        headerLines.push(`${lines[i]}\n`)
      }
      body.header.parse(headerLines)

      for (i++; i < lines.length; i++) {
        body.parse_more(`${lines[i]}\n`)
      }
      body.parse_end()

      assert.ok(attachmentSeen)
      assert.equal(body.children.length, 2)
    })
  })
})

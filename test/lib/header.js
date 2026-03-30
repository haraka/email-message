const { describe, it } = require('node:test')
const assert = require('node:assert')
const Header = require('../../lib/header')

const rawLines = [
  'Return-Path: <helpme@gmail.com>',
  'Received: from [1.1.1.1] ([2.2.2.2])',
  '       by smtp.gmail.com with ESMTPSA id abcdef.28.2016.03.31.12.51.37',
  '       for <foo@bar.com>',
  '       (version=TLSv1/SSLv3 cipher=OTHER);',
  '       Thu, 31 Mar 2016 12:51:37 -0700 (PDT)',
  'From: Matt Sergeant <helpme@gmail.com>',
  `FromUTF8: =?UTF-8?B?S29obOKAmXM=?=
 <Kohls@s.kohls.com>`,
  'Content-Type: multipart/alternative;',
  '   boundary=Apple-Mail-F2C5DAD3-7EB3-409D-9FE0-135C9FD43B69',
  'Content-Type2: multipart/mixed; boundary="nqp=nb64=()I9WT8XjoN"',
  'Content-Transfer-Encoding: 7bit',
  'Mime-Version: 1.0 (1.0)',
  'Subject: Re: Haraka Rocks!',
  'Message-Id: <616DF75E-D799-4F3C-9901-1642B494C45D@gmail.com>',
  'Date: Thu, 31 Mar 2016 15:51:36 -0400',
  'To: The World <world@example.com>',
  'X-Mailer: iPhone Mail (13E233)',
]

function makeHeader() {
  const h = new Header()
  h.parse(rawLines)
  return h
}

describe('header', function () {
  describe('add_headers', function () {
    it('add_basic', function () {
      const h = makeHeader()
      h.add('Foo', 'bar')
      assert.equal(h.lines()[0], 'Foo: bar\n')
      h.add_end('Fizz', 'buzz')
      assert.equal(h.lines()[14], 'Fizz: buzz\n')
    })

    it('add_utf8', function () {
      const h = makeHeader()
      h.add('Foo', 'bøø')
      assert.equal(h.lines()[0], 'Foo: =?UTF-8?Q?b=C3=B8=C3=B8?=\n')
      assert.equal(h.get_decoded('Foo'), 'bøø')

      h.add(
        'Bar',
        'bøø 1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890',
      )
      assert.equal(
        h.lines()[0],
        'Bar: =?UTF-8?Q?b=C3=B8=C3=B8?= 1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890\n',
      )
      assert.equal(
        h.get_decoded('Bar'),
        'bøø 1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890',
      )
    })

    it('add/add_end with missing key', function () {
      const h = new Header()
      h.add('', 'value1')
      assert.equal(h.get('X-Haraka-Blank'), 'value1')
      h.add_end(null, 'value2')
      assert.equal(h.get_all('X-Haraka-Blank')[1], 'value2')
    })
  })

  describe('continuations', function () {
    it('continuations_decoded', function () {
      const h = makeHeader()
      assert.ok(!/\n/.test(h.get_decoded('content-type')))
    })
  })

  describe('decode', function () {
    const cases = [
      {
        name: 'multiline 8bit header (#2675)',
        input: [
          'Content-Disposition: attachment;\n',
          " filename*0*=utf-8''%E8%AC%9B%E6%BC%94%E4%BC%9A%E6;\n",
          ' filename*1*=%A1%88%E5%86%85%E6%9B%B8%EF%BC%86%E7%94%B3%E8%BE%BC%E6%9B%B8;\n',
          ' filename*2*=%E6%94%B9%2Etxt\n',
        ],
        expected: '講演会案内書＆申込書改.txt',
      },
      {
        name: 'unfolding (#2702)',
        input: [
          'Subject: =?UTF-8?Q?Die_beliebtesten_CAD-_und_AVA-Programme;_die_kl=C3=BCgsten_K?=\n',
          ' =?UTF-8?Q?=C3=B6pfe_der_Branche;_Abschluss_eines_BIM-Pilotprojekts;_Bauen?=\n',
          ' =?UTF-8?Q?_in_Zeiten_des_Klimawandels;_u.v.m?=\n',
        ],
        expected:
          'Die beliebtesten CAD- und AVA-Programme; die klügsten Köpfe der Branche; Abschluss eines BIM-Pilotprojekts; Bauen in Zeiten des Klimawandels; u.v.m',
      },
      {
        name: 'Subject with emoji',
        input: [
          'Subject: =?utf-8?q?=F0=9F=A7=A1You_can__get_a_date_with_me_if_you_seek_a_beautiful_companion=2E=F0=9F=92=9E?=\r\n',
        ],
        expected:
          '🧡You can  get a date with me if you seek a beautiful companion.💞',
      },
      {
        name: 'Invalid encoding type',
        input: ['Subject: =?UTF-8?Z?foo?='],
        expected: '=?UTF-8?Z?foo?=',
      },
      {
        name: 'Multiple encoded words with space between',
        input: ['Subject: =?UTF-8?Q?foo?= =?UTF-8?Q?bar?='],
        expected: 'foobar',
      },
      {
        name: 'RFC2231 with different charset',
        input: [
          "Content-Type: application/x-stuff; title*=us-ascii'en-us'This%20is%20it",
        ],
        expected: 'title="This is it"',
      },
    ]

    for (const c of cases) {
      it(c.name, function () {
        const h = new Header()
        h.parse(c.input)
        assert.ok(
          h.get_decoded(c.input[0].split(':')[0]).includes(c.expected),
          `Failed: ${c.name}`,
        )
      })
    }
  })

  describe('get', function () {
    it('get_all for nonexistent key', function () {
      const h = new Header()
      const all = h.get_all('nonexistent')
      assert.deepEqual(all, [])
      assert.ok(Object.isFrozen(all))
    })
  })

  describe('parse', function () {
    it('get_decoded', function () {
      const h = makeHeader()
      assert.equal(h.lines().length, 13)
      assert.equal(
        h.get_decoded('content-type'),
        'multipart/alternative;   boundary=Apple-Mail-F2C5DAD3-7EB3-409D-9FE0-135C9FD43B69',
      )
      assert.equal(h.get_decoded('fromUTF8'), 'Kohl\u2019s <Kohls@s.kohls.com>')
    })

    it('content type w/parens', function () {
      const h = makeHeader()
      assert.equal(h.lines().length, 13)
      assert.equal(
        h.get_decoded('content-type2'),
        'multipart/mixed; boundary="nqp=nb64=()I9WT8XjoN"',
      )
    })

    it('parse malformed line', function () {
      const h = new Header()
      h.parse(['This is not a header line'])
      assert.deepEqual(h.header_list, ['This is not a header line'])
    })

    it('RFC2231 decodeURIComponent failure', function () {
      const h = new Header()
      h.parse(['Content-Disposition: attachment; filename*=%E8%AC%9B%E6%BC%94'])
      const decoded = h.get_decoded('content-disposition')
      assert.ok(decoded.includes('%E8%AC%9B%E6%BC%94'))
    })

    it('non-ASCII header without encoding', function () {
      const h = new Header()
      h.parse([
        'Content-Type: text/plain; charset=iso-8859-1\n',
        'X-Bio: Matt l\xf8v\xeas Haraka\n',
      ])
      const decoded = h.get_decoded('x-bio')
      assert.ok(decoded.includes('l\xf8v\xeas'))
    })
  })

  describe('remove', function () {
    it('removes only specified header', function () {
      const h = makeHeader()
      h.add('X-Test', 'remove-me')
      h.add('X-Test-1', 'do-not-remove-me')
      h.remove('X-Test')
      assert.equal(h.get('X-Test'), '')
      assert.equal(h.get('X-Test-1'), 'do-not-remove-me')
      assert.ok(
        h.header_list.find((name) => name === 'X-Test-1: do-not-remove-me\n'),
      )
    })

    it('removes multiple matching headers', function () {
      const h = makeHeader()
      h.add('X-Test', 'remove me')
      h.add('X-Test', 'and remove me')
      h.add('X-Test-No', 'leave me')
      h.remove('X-Test')
      assert.equal(h.get('X-Test'), '')
      assert.equal(h.get('X-Test-No'), 'leave me')
      assert.ok(h.header_list.find((name) => name === 'X-Test-No: leave me\n'))
    })

    it('remove nonexistent key', function () {
      const h = new Header()
      h.add('Exists', 'yes')
      h.remove('Nonexistent')
      assert.equal(h.get('Exists'), 'yes')
    })
  })
})

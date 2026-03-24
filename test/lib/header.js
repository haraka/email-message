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
  })

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
  })

  describe('continuations', function () {
    it('continuations_decoded', function () {
      const h = makeHeader()
      assert.ok(!/\n/.test(h.get_decoded('content-type')))
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
  })

  describe('decode', function () {
    it('multiline 8bit header (#2675)', function () {
      const h = new Header()
      h.parse([
        'Content-Disposition: attachment;\n',
        " filename*0*=utf-8''%E8%AC%9B%E6%BC%94%E4%BC%9A%E6;\n",
        ' filename*1*=%A1%88%E5%86%85%E6%9B%B8%EF%BC%86%E7%94%B3%E8%BE%BC%E6%9B%B8;\n',
        ' filename*2*=%E6%94%B9%2Etxt\n',
      ])
      assert.ok(
        h
          .get_decoded('content-disposition')
          .includes('講演会案内書＆申込書改.txt'),
      )
    })

    it('unfolding (#2702)', function () {
      const h = new Header()
      h.parse([
        'Subject: =?UTF-8?Q?Die_beliebtesten_CAD-_und_AVA-Programme;_die_kl=C3=BCgsten_K?=\n',
        ' =?UTF-8?Q?=C3=B6pfe_der_Branche;_Abschluss_eines_BIM-Pilotprojekts;_Bauen?=\n',
        ' =?UTF-8?Q?_in_Zeiten_des_Klimawandels;_u.v.m?=\n',
      ])
      assert.equal(
        h.get_decoded('subject'),
        'Die beliebtesten CAD- und AVA-Programme; die klügsten Köpfe der Branche; Abschluss eines BIM-Pilotprojekts; Bauen in Zeiten des Klimawandels; u.v.m',
      )
    })

    it('Subject with emoji', function () {
      const h = new Header()
      h.parse([
        'Subject: =?utf-8?q?=F0=9F=A7=A1You_can__get_a_date_with_me_if_you_seek_a_beautiful_companion=2E=F0=9F=92=9E?=\r\n',
      ])
      assert.equal(
        h.get_decoded('subject'),
        '🧡You can  get a date with me if you seek a beautiful companion.💞',
      )
      assert.ok(h.get_decoded('subject').match(/\p{Emoji}/gu))
    })
  })
})

const { describe, it } = require('node:test')
const assert = require('node:assert')
const { tokenize } = require('../../lib/rfc2231')

const all = (str) => [...tokenize(str)]

describe('rfc2231', () => {
  describe('grammar', () => {
    it('extended parameter (attribute*=)', () => {
      assert.deepEqual(all("title*=us-ascii'en'This%20is%20it"), [
        {
          attribute: 'title',
          section: '0',
          value: "us-ascii'en'This%20is%20it",
        },
      ])
    })

    it('continued, encoded sections (attribute*N*=)', () => {
      assert.deepEqual(
        all("filename*0*=utf-8''a; filename*1*=b; filename*2*=c"),
        [
          { attribute: 'filename', section: '0', value: "utf-8''a" },
          { attribute: 'filename', section: '1', value: 'b' },
          { attribute: 'filename', section: '2', value: 'c' },
        ],
      )
    })

    it('continued, plain sections (attribute*N=)', () => {
      assert.deepEqual(all('name*0=first; name*1=second'), [
        { attribute: 'name', section: '0', value: 'first' },
        { attribute: 'name', section: '1', value: 'second' },
      ])
    })

    it('ignores ordinary (non-2231) parameters', () => {
      assert.deepEqual(all('multipart/mixed; boundary=abc; charset=utf-8'), [])
    })

    it('finds a 2231 parameter among ordinary ones', () => {
      assert.deepEqual(all('attachment; size=10; filename*=a'), [
        { attribute: 'filename', section: '0', value: 'a' },
      ])
    })

    it('quoted value has its quotes stripped', () => {
      assert.deepEqual(all('x*="hello world"'), [
        { attribute: 'x', section: '0', value: 'hello world' },
      ])
    })

    it('quoted value keeps escaped characters', () => {
      assert.deepEqual(all('x*="a\\"b"'), [
        { attribute: 'x', section: '0', value: 'a\\"b' },
      ])
    })

    it('strips a single trailing semicolon from a bare value', () => {
      assert.deepEqual(all('x*=a;b;'), [
        { attribute: 'x', section: '0', value: 'a;b' },
      ])
    })

    it('an unterminated quote is treated as a bare value', () => {
      assert.deepEqual(all('x*="unterminated'), [
        { attribute: 'x', section: '0', value: '"unterminated' },
      ])
    })

    it('yields nothing for input without a parameter', () => {
      assert.deepEqual(all('just some free text with no params'), [])
      assert.deepEqual(all(''), [])
    })

    it('a lone attribute* with no = yields nothing', () => {
      assert.deepEqual(all('filename*'), [])
      assert.deepEqual(all('a*0*'), [])
    })
  })

  describe('linear time (GHSA-6f4j-gpc2-6p2g)', () => {
    // The prior regex was O(n²) on these; a linear scan must stay flat. Assert
    // on scaling rather than an absolute time so the test is not machine-fragile.
    const timeFor = (str) => {
      const t = process.hrtime.bigint()
      for (const token of tokenize(str)) void token
      return Number(process.hrtime.bigint() - t) / 1e6
    }

    const cases = {
      'attr run then lone star (the classic backtrack trigger)': (n) =>
        `=${'a'.repeat(n)}*`,
      'folded header with a *= token per fold': (n) =>
        'x*=y; '.repeat(Math.floor(n / 6)),
      'giant bare value': (n) => `x*=${'a'.repeat(n)}`,
    }

    for (const [name, build] of Object.entries(cases)) {
      it(name, () => {
        // Warm up, then compare 1× vs 8× input. O(n²) would be ~64× slower;
        // require well under that. Large absolute sizes so any quadratic term
        // dominates measurement noise.
        timeFor(build(10_000))
        const small = timeFor(build(100_000))
        const large = timeFor(build(800_000))
        // 8× the input must not cost anywhere near 64× the time.
        assert.ok(
          large < Math.max(small * 20, 50),
          `non-linear scaling: 1×=${small.toFixed(1)}ms 8×=${large.toFixed(1)}ms`,
        )
      })
    }
  })
})

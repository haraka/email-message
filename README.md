[![CI Test Status][ci-img]][ci-url]
[![Code Climate][clim-img]][clim-url]
[![Test Coverage][cov-img]][cov-url]

# haraka-email-message

RFC 2822 header parser and MIME body parser used throughout [Haraka](https://haraka.github.io). Can be used standalone.

## Installation

```sh
npm install haraka-email-message
```

## Quick start

```js
const { Header, Body } = require('haraka-email-message')

const header = new Header()
header.parse([
  'From: Alice <alice@example.com>\r\n',
  'To: Bob <bob@example.com>\r\n',
  'Subject: Hello\r\n',
])

const body = new Body(header)
body.parse_more('This is the message body.\n')
body.parse_end()

console.log(header.get('from')) // 'Alice <alice@example.com>'
console.log(body.bodytext) // 'This is the message body.\n'
```

---

## `Header`

An RFC 2822 header block parser. Each MIME part in a `Body` also carries its own `Header` instance.

### Construction

```js
const header = new Header()
```

### `header.parse(lines)`

Parses an array of raw header lines. Handles folded (multi-line) headers and
decodes RFC 2047 encoded-words and RFC 2231 parameter continuations.

```js
header.parse([
  'Subject: =?UTF-8?Q?Hello_World?=\r\n',
  'Content-Type: multipart/alternative;\r\n',
  '\tboundary="----=_Part_1"\r\n',
])
```

### `header.get(key)` → `string`

Returns the raw value(s) for `key` (case-insensitive). Multiple values are
joined with `\n`. Returns `''` if absent.

```js
header.get('content-type')
// 'multipart/alternative;\r\n\tboundary="----=_Part_1"'
```

### `header.get_all(key)` → `string[]` (frozen)

Returns all values for `key` as a frozen array. Useful for headers that
legitimately repeat (e.g. `Received`).

```js
header.get_all('received') // ['from mx1 ...', 'from mx2 ...']
```

### `header.get_decoded(key)` → `string`

Like `get()`, but with RFC 2047 encoded-words decoded and RFC 2231 parameter
continuations resolved. Use this for display or further parsing.

```js
header.get_decoded('subject') // 'Hello World'
```

### `header.add(key, value)`

Prepends a header. Non-ASCII values are automatically Q-encoded.

```js
header.add('X-Spam-Score', '3.2')
header.add('X-Résumé', 'présent') // encoded automatically
```

> **Note (Haraka users):** use `transaction.add_header()` instead — that also
> updates the message stream so the change is reflected in the DATA.

### `header.add_end(key, value)`

Same as `add()` but appends instead of prepends.

### `header.remove(key)`

Removes all headers with the given name.

> **Note (Haraka users):** use `transaction.remove_header()` instead.

### `header.lines()` → `string[]` (frozen)

Returns the raw header block as an array of lines (one per logical header,
continuations merged).

### `header.toString()` → `string`

Returns the entire header block as a single string.

### `header.header_list`

The internal array of raw header lines. Readable but treat as read-only;
mutations bypass the decoded caches.

---

## `Body`

A streaming MIME body parser. Feed it lines one at a time with `parse_more()`,
then call `parse_end()` to finalise.

### Construction

```js
const body = new Body(header, options)
```

`header` is a `Header` instance (or omit for a headerless body that defaults
to `text/plain`). `options` is currently reserved for future use.

### `body.parse_more(line)` → `Buffer | ''`

Feeds one line into the parser. `line` may be a `Buffer` or `string`.
Returns the (possibly transformed) line, or `''` when a filter has consumed
the output.

### `body.parse_end([line])` → `Buffer`

Signals end of the part. Decodes the accumulated body, runs any filters, and
sets `body.bodytext`. Call once after all lines have been fed.

```js
for (const line of rawLines) body.parse_more(line)
const lastLine = body.parse_end()
```

### `body.bodytext` → `string`

The decoded, UTF-8 body text of this MIME part. HTML parts retain their tags.

### `body.ct` → `string | null`

The `Content-Type` of this part, set during `parse_start` (first non-header
line). `null` before parsing begins.

### `body.children` → `Body[]`

Child MIME parts. For a `multipart/*` message:

```
body                   ← multipart/alternative
  body.children[0]     ← text/plain
  body.children[1]     ← text/html
```

### `body.header` → `Header`

The `Header` of this MIME part.

### Event: `attachment_start`

```js
body.on('attachment_start', (contentType, filename, part, stream) => {
  stream.on('data', (chunk) => {
    /* Buffer */
  })
  stream.on('end', () => {
    /* done */
  })
})
```

Emitted when a non-inline part (attachment or non-text content type) is
encountered. `stream` is an `AttachmentStream`. The event propagates to child
parts automatically.

### Event: `mime_boundary`

```js
body.on('mime_boundary', (line) => {
  /* raw boundary line */
})
```

Emitted at each MIME boundary line.

### `body.add_filter(fn)`

Registers a filter function invoked at `parse_end()` with the decoded body
buffer. Receives `(contentType, encoding, buf, contentDisposition)` and should
return a `Buffer` (or `undefined` to leave unchanged).

```js
body.add_filter((ct, enc, buf) => {
  if (/text\/plain/i.test(ct)) {
    return Buffer.from(buf.toString().toUpperCase())
  }
})
```

### `body.set_banner([textBanner, htmlBanner])`

Convenience method that adds a filter inserting banners at the end of
`text/plain` and `text/html` parts. HTML banners are wrapped in `<P>...</P>`
and inserted just before `</body>` or `</html>`.

```js
body.set_banner([
  'This message was scanned by AcmeSecurity.',
  '<em>This message was scanned by AcmeSecurity.</em>',
])
```

### `body.force_end()`

Forces attachment streams to emit `end` even if the parser is still in
`attachment` state. Used during connection teardown.

---

## `AttachmentStream`

A `Stream` subclass that buffers attachment data and supports backpressure via
`pause()` / `resume()`. Received from the `attachment_start` event.

```js
body.on('attachment_start', (ct, filename, part, stream) => {
  const chunks = []
  stream.on('data', (chunk) => chunks.push(chunk))
  stream.on('end', () => {
    const data = Buffer.concat(chunks)
    console.log(`${filename}: ${data.length} bytes`)
  })
  stream.pipe(fs.createWriteStream(`/tmp/${filename}`))
})
```

### `stream.pause()` / `stream.resume()`

Pauses and resumes data emission. Buffered chunks are held in memory until
resumed.

### `stream.setEncoding('binary')`

Makes `data` events emit strings rather than Buffers. Only `'binary'` is
supported.

### `stream.connection`

Optional back-reference to the network socket. When set, `pause()` /
`resume()` also pause / resume the connection to provide true backpressure.

---

## `stream` export

Re-exports [`haraka-message-stream`](https://github.com/haraka/message-stream),
a dual-mode write-then-read buffer for the raw RFC 2822 wire bytes.

```js
const { stream: MessageStream } = require('haraka-email-message')
const ms = new MessageStream(cfg, uuid)
ms.add_line('From: alice@example.com\r\n')
ms.add_line('\r\n')
ms.add_line('Body text\r\n')
ms.add_line_end()
ms.pipe(socket, { dot_stuffed: true, ending_dot: true })
```

---

## `createAttachmentStream(header)` → `AttachmentStream`

Factory function that returns a new `AttachmentStream`. In Haraka, plugins
can replace this export to substitute a custom implementation.

```js
const msg = require('haraka-email-message')
const orig = msg.createAttachmentStream
msg.createAttachmentStream = (header) => {
  const s = orig(header)
  s.on('end', () => console.log('attachment done'))
  return s
}
```

---

## Encoding support

`iconv-lite` handles most encodings. For rare legacy encodings not covered by
`iconv-lite` (e.g. `x-mac-cyrillic`, `koi8-r`), install the optional native
`iconv` binding:

```sh
npm install iconv
```

When the native binding is absent a `lognotice`-level message is emitted at
startup. Unrecognised encodings fall back to `Buffer.toString()` and
`body.body_encoding` is set to `broken//<enc>`.

---

<!-- leave these buried at the bottom of the document -->

[ci-img]: https://github.com/haraka/email-message/actions/workflows/ci.yml/badge.svg
[ci-url]: https://github.com/haraka/email-message/actions/workflows/ci.yml
[clim-img]: https://qlty.sh/gh/haraka/projects/email-message/maintainability.svg
[clim-url]: https://qlty.sh/gh/haraka/projects/email-message
[cov-img]: https://coveralls.io/repos/github/haraka/email-message/badge.svg
[cov-url]: https://coveralls.io/github/haraka/email-message

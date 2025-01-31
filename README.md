[![CI Test Status][ci-img]][ci-url]
[![Code Climate][clim-img]][clim-url]

# haraka-email-message

## USAGE

```js
const message = require('haraka-email-message')
new message.Header(options)
new message.Body(header, options)
new message.stream(cfg, uuid, header_list)
```

## Exports

- [Header](#Header)
- [Body](#Body)
- stream (a [haraka-message-stream](https://github.com/haraka/message-stream))

## Header

=============

The Header object gives programmatic access to email headers. It is primarily
used from `transaction.header` but also each MIME part of the `Body` will
also have its own header object.

## API

- header.get(key)

Returns the header with the name `key`. If there are multiple headers with
the given name (as is usually the case with "Received" for example) they will
be concatenated together with "\n".

- header.get_all(key)

Returns the headers with the name `key` as an array. Multi-valued headers
will have multiple entries in the array.

- header.get_decoded(key)

Works like `get(key)`, only it gives you headers decoded from any MIME encoding
they may have used.

- header.remove(key)

Removes all headers with the given name. DO NOT USE. This is transparent to
the transaction and it will not see the header(s) you removed. Instead use
`transaction.remove_header(key)` which will also correct the data part of
the email.

- header.add(key, value)

Adds a header with the given name and value. DO NOT USE. This is transparent
to the transaction and it will not see the header you added. Instead use
`transaction.add_header(key, value)` which will add the header to the data
part of the email.

- header.lines()

Returns the entire header as a list of lines.

- header.toString()

Returns the entire header as a string.

## Body

===========

Email Message Body provides access to the textual body parts of an email.

## API

- body.bodytext

A String containing the body text. Note that HTML parts will have tags in-tact.

- body.header

The header of this MIME part. See the `Header Object` for details of the API.

- body.children

Any child MIME parts. For example a multipart/alternative mail will have a
main body part with just the MIME preamble in (which is usually either empty,
or reads something like "This is a multipart MIME message"), and two
children, one text/plain and one text/html.

<!-- leave these buried at the bottom of the document -->

[ci-img]: https://github.com/haraka/email-message/actions/workflows/ci.yml/badge.svg
[ci-url]: https://github.com/haraka/email-message/actions/workflows/ci.yml
[clim-img]: https://codeclimate.com/github/haraka/email-message/badges/gpa.svg
[clim-url]: https://codeclimate.com/github/haraka/email-message

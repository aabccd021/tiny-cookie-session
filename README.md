# tiny-cookie-sessoin

**tiny-cookie-session** is a cookie session library with cookie theft mitigation,
for JavaScript and TypeScript.

## Installation

```sh
pnpm install tiny-cookie-session@github:aabccd021/tiny-cookie-session
yarn add tiny-cookie-session@github:aabccd021/tiny-cookie-session
bun install tiny-cookie-session@github:aabccd021/tiny-cookie-session
```

## Creating a configuration

Before using this library, you need to create a configuration object,
which includes all the necessary parameters for managing sessions including the storage backend,
expiration time, and refresh interval.

This library doesn't include any adapter for a storage backend,
you need to provide your own storage implementation in the configuration object.

### Bun SQLite Configuration

```js
// Bun SQLite example

```

### In-Memory Store Configuration

See [test](./index.test.js) for actual implementation and testing.

```js
// In-Memory Store example

```

### Testing Configuration

After implementing your own storage backend, you can use the testing configuration to test your
implementation with `testConfiguration` function.

Note that this function might leave some data in the storage backend when failing,
so we don't recommend running it in production.

## Usage

```js
// login

// logout

// consume session
```

## Cookie Parsing/Serializing

This library doesn't parse or serialize cookies, you need to use your own cookie parsing/serializing
library.

```js
// `cookie` library example
```

```js
// Bun cookie example
```

## Passing Custom Data

You can pass custom data when using `login` and `consumeSession` functions.

This is useful if you have a SQL table for session, and have non-nullable columns for that custom
data.

```js
// login example with `userId` custom data


// consume session example with `userId` and `createdAt` custom data
```

## Garbage Collecting Expired Sessions

While the session will be deleted when user logs out, or user consume the session after it expires,
this library doesn't automatically delete expired sessions of inactive users.

You need to implement your own garbage collection mechanism to delete expired sessions.

```js
// Bun SQLite example

```

## CSRF

- CSRF and cookie tampering is not included, and should be performed before using

## Comparison with Device Bound Session Credentials

- DBSC will only invalidate attacker
- DBSC doesnt require storing all past session tokens

## CSRF

## Session Tampering / User Agent Detection / GeoIP

## What this library is not

- Protecting from malware continuously stealing cookies

## Improving security with service workers

- By periodically refreshing the session cookie, you can detect cookie theft faster

## Delete cookie after browser close

- remove expires/max-age attribute from cookie

## Development

```sh
# install nix with flake enabled
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install --no-confirm

# clone and enter the repository
git clone --depth 1 https://github.com/aabccd021/tiny-cookie-session.git
cd tiny-cookie-session

# format everything
nix fmt

# check everything (test, typecheck, format, lint)
nix flake check

# enter a devshell with language servers, then open editor
nix develop --command vi index.js
```

## LICENCE

```
Zero-Clause BSD
=============

Permission to use, copy, modify, and/or distribute this software for
any purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED “AS IS” AND THE AUTHOR DISCLAIMS ALL
WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES
OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLEs
FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY
DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN
AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT
OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

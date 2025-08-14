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

## Testing Configuration

After implementing your own storage backend, you can use the testing configuration to test your
implementation with `testConfig` function.

Note that this function might leave some data in the storage backend when failing,
so we don't recommend running it in production.

You can provide multiple session examples to the `testConfig` function.
The more variations you provide, the more robust your implementation will be against edge cases.
Make sure the session ids are unique.

## How to decide `sesionExpiresIn`

The session is considered expired when the current time is greater than the last time the token was refreshed
plus the `sessionExpiresIn` value.

Essentially, this is equivalent to "log out after X minutes of inactivity".

For example, if you set `sessionExpiresIn` to 30 minutes,
you can indefinitely use the session by consuming it every 29 minutes.

## How to decide `tokenExpiresIn`

The token is considered expired when the current time is greater than the last time the token was refreshed
plus the `tokenExpiresIn` value.

The token will be refreshed if the token is expired, but the session is not expired.

Making this value shorter means:

- The cookie theft will be detected faster.
- More tokens need to be stored in the storage backend.

Also for extreme case where you set this to a very short value, like 10 second,
it might unexpectedly log out the user while they are doing something valid,
but the request is taking longer than 10 seconds to complete.

## Basic Usage

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
// Bun.CookieMap and Bun.Cookie example
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

## Force logout the session

This will take effect immediately, unlike JWT.
Just delete the session from the storage backend.
Next time they consume the session, it will show `NotFound`.

```js
// example
```

## Cookie Theft Mitigation

This library mitigates cookie theft by logging out both the attacker and the user when the theft is detected.

### Detecting Cookie Theft

- A session is identified by a short-lived token.
- When the token is refreshed, new token is generated once and set in browser, old token will be kept on database.
- When someone uses the old token, it's either the user or the attacker.

### Handling Race Conditions

On above example, we said that only the latest token will be marked as valid,
but actually we will mark **two** latest tokens as valid.

While using just the latest token to identify a session would be enough to
detect cookie theft, we will instead use the two latest tokens.

We do this to prevent the user from being logged out while doing completely
valid requests, but on a certain race condition.
This is to handle a race condition, where user might do multiple requests at the same time.

Below is an example that shows a scenario where the user would be logged out
for a valid request if we only used the latest token.

1. Client sends request lorem with `cookie: token=old_token`. Valid token.
1. Server creates token `new_token` in database. Now it's the latest token.
1. Client sends request ipsum with `cookie: token=old_token`. Invalid token.
1. Server sends response lorem with `set-cookie: token=new_token`.
1. Client sends request dolor with `cookie: token=new_token`. Valid token.

The above example may be easier to imagine if you think of the user uploading
a large file in step 1, and doing something else in another browser tab in
step 3.

## Device Bound Session Credentials

DBSC is ...,

### tiny-cookie-session vs DBSC

tiny-cookie-session will invalidate both the attacker and the user on cookie theft,
since there is no way to know which one is the valid user.

DBSC will only invalidate attacker, since only the valid user can finish the challenge.

tiny-cookie-session requires to store all past token of a active session.
this is the only way we can know wether the cookie is "not existing / random" or "old token of a valid session" (stolen).

DBSC only need to store a single token.

tiny-cookie-session doesn't rely on client to have secure storage such as TPM.

DBSC relies on client to have secure storage to store a private key used to finish the challenge.

tiny-cookie-session doesn't require additional endpoint for creating / updating a token.

DBSC requires additional endpoint for creating / updating a token.

### Using tiny-cookie-session with DBSC

If the device supports DBSC, you can just insert the new token when refreshing it,
then it should work just fine.

```js
// example
```

## Session Token

Remix uses 64 bits of entropy
https://github.com/remix-run/remix/blob/b7d280140b27507530bcd66f7b30abe3e9d76436/packages/remix-node/sessions/fileStorage.ts#L45

OWASP recommends at least 64 bits of entropy
https://owasp.org/www-community/vulnerabilities/Insufficient_Session-ID_Length

Lucia uses 160 bits of entropy in their sqlite example
https://github.com/lucia-auth/lucia/blob/46b164f78dc7983d7a4c3fb184505a01a4939efd/pages/sessions/basic-api/sqlite.md?plain=1#L88

auth.js uses 256 bits of entropy in their test
https://github.com/nextauthjs/next-auth/blob/c5a70d383bb97b39f8edbbaf69c4c7620246e9a4/packages/core/test/actions/session.test.ts#L146

We use 256 bits of entropy for session token.

This way, when the database is compromised, the attacker can't just use any
data in the database to hijack the session.

Since the token itself is already a random string with high entropy, unlike a
password, we don't need any additional processing like salting, stretching, or
peppering.

Doing sha-256 for every request might seem like a lot, but it's not any more
taxing than doing cookie signing, which is a common practice in web services.

Also by doing this,
[we don't have to use `crypto.timingSafeEqual` when comparing tokens,
because we are comparing hashes of high entropy tokens.](https://security.stackexchange.com/questions/237116/using-timingsafeequal#comment521092_237133)

Actually I'm a security expert so I'm not really sure about this.
Please let me know if we do need to use `crypto.timingSafeEqual`.

## CSRF

This library doesn't provide CSRF protection.
You need to handle CSRF protection yourself for your entire application, before reaching the session management layer.

## Signed Cookies

This library doesn't sign cookies.

Biggest benefit of signed cookies is that it prevents cookie tampering without reaching storage backend.

While it's still useful, it's not essentially required for this library to work.

Although this library doesn't prevent you from implementing signed cookies.

You can sign/unsign cookies, before/after using this library.

## Your Cookie is still not 100% safe

This can mitigate cookie theft by logging out both the attacker and the user when the theft is detected,
it doesn't prevent cookie theft in the first place.

The attacker can still use the stolen cookie until the user logs in again.

If user never logs in again after the theft, the attacker can still use the stolen cookie indefinitely.

Also, this library would become essentially useless if the cookie is being constantly stolen by a
malicious background process.

No software mechanism in the world can prevent that, including DBSC.

## Improving security with service workers

By periodically refreshing the session cookie, you can detect cookie theft faster.
Although it would be inefficient.

```js
// Bun SQLite example

```

## Delete cookie after browser close

- Equivalent to when `remember me` is not checked
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

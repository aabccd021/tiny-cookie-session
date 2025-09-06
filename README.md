# tiny-cookie-session

**tiny-cookie-session** is a cookie-based session management library that detects session forking.
When session forking is detected, this library logs out both the attacker and the user.

## Important: Security limitations

While this library detects session forking, it does not provide complete protection.
You should understand its limitations before using it in production.

### How session id and token are stored

This library uses randomly generated session IDs and tokens to identify a session.
The session ID is a long-lived identifier for the session, while the token is a short-lived value
that is rotated periodically.
Both the session ID and token are stored in a cookie.

### Detecting outdated cookies

After a cookie is stolen and the token is rotated,
either the attacker or the user will have an outdated token.
When this outdated token is used, it is detected as session forking and both parties are logged out.
We log out both parties because we cannot determine which party used the invalid token.

### Attack Scenarios and Outcomes

| Scenario                                                             | Detection Possible? | Attacker can use the session until |
| -------------------------------------------------------------------- | ------------------- | ---------------------------------- |
| Attacker steals old cookie                                           | Yes                 | Never                              |
| Attacker steals the latest cookie, user uses the session after that  | Yes                 | The user's next request            |
| Attacker steals the latest cookie, user never uses the session again | No                  | Indefinitely                       |
| Attacker steals the latest cookie, logs out user                     | No                  | Indefinitely                       |
| Persistent cookie theft (e.g., background malware)                   | No                  | Indefinitely                       |

### If the attacker steals an old cookie

If the attacker steals an old cookie (stolen before the latest rotation),
both parties will be logged out when the attacker uses the cookie.
In this case, no harm is done to the user, except that the user will be logged out unexpectedly.

### If the attacker steals a recent cookie

There are two worst-case scenarios where we can't detect session forking:

1. The attacker steals a cookie, and the user never uses the session again (inactive).
2. The attacker steals a cookie, and somehow (forcefully) logs out the user.

These cases cannot be mitigated unless the user has some way to prove their identity, as is done with Device Bound Session Credentials (DBSC).

#### If the user is inactive after the cookie is stolen

One thing we can do is to set a short session expiration time (`sessionExpiresIn`).
This will limit the window of opportunity for the attacker,
but it will also inconvenience users by requiring them to log in more frequently.

A stricter approach is to implement a "Don't remember me" option, which deletes the cookie when the
browser is closed.
This can be done by removing the `Expires` and `Max-Age` attributes from the session cookie.
In this case, the only way for the attacker to do harm is to steal the last cookie used before
closing the browser.

#### If the attacker forcefully logs out the user

One thing we can do is to implement a "Log out other devices" feature.
This way, when the user logs in again they can log out all other devices, including the attacker.

You can make it even safer by only allowing the user to have one active session at a time,
so that logging in again will automatically log out all other devices, including the attacker.
This requires no manual action (choosing devices to log out), making it safer than the previous
approach.

However, none of these approaches prevents the attacker from using the session until the user logs
in again.

### Persistent cookie theft

If the cookie is stolen persistently (e.g., via malware running in the background),
it can't be prevented by any cookie-based mechanism, including this library or even DBSC.

The user is cooked at this point. The only solution is to log in from a clean device and log out
all other devices.

## Installation

```sh
pnpm install github:aabccd021/tiny-cookie-session
yarn add github:aabccd021/tiny-cookie-session
bun install github:aabccd021/tiny-cookie-session
```

## Example usage with Bun and SQLite

See [test/index.test.js](./test/index.test.js) for a complete example.

We will use above example as a reference for the code snippets below.

## Garbage collection of expired sessions

Since this library doesn't automatically delete expired sessions for inactive users,
you'll need to implement your own garbage collection mechanism:

```js
// Run this periodically
db.query("DELETE FROM session WHERE exp < :now").run({ now: Date.now() });
```

Doing or not doing garbage collection on expired sessions is always safe and has no security
implications, since those sessions would be rejected as "SessionExpired" anyway if a user tried
to use them.

## Force logout session

This library allows you to immediately invalidate sessions by deleting them from the storage
backend.

Unlike JWT, the session logout is effective immediately when this is done.

```js
// Force logout a specific session
db.query("DELETE FROM session WHERE id_hash = :idHash").run({ idHash });

// Force logout all sessions for a specific user
db.query("DELETE FROM session WHERE user_id = :userId").run({ userId });

// Force logout all users
db.query(`DELETE FROM session`).run();
```

## Path and SameSite attributes

This library sets `SameSite=Strict` and does not set `Path` by default.
This is the strictest setting for a cookie, which is a good default for a library.

But practically, you usually want `Path=/` and `SameSite=Lax` for session cookies.
To do that, you can override the default options returned by this library:

```ts
import * as tcs from "tiny-cookie-session";

function serializeCookie(cookie: tcs.Cookie): string {
  const options = { ...cookie.options, path: "/", sameSite: "lax" };
  return new Bun.Cookie("mysession", cookie.value, options).serialize();
}
```

## Serializing and Parsing Cookies

This library does not handle cookie serialization and parsing.
You need to do it outside this library, by using your web framework's built-in functionality
or a third-party library.

If you use [Bun Cookie](https://bun.sh/docs/api/cookie) or
[cookie](https://www.npmjs.com/package/cookie),
you can directly use `value` and `options` as arguments to serialize the cookie.

```ts
import * as tcs from "tiny-cookie-session";
import * as cookieLib from "cookie";

const { cookie } = await tcs.login();

new Bun.Cookie("mysession", cookie.value, cookie.options).serialize();

cookieLib.serialize("mysession", cookie.value, cookie.options);
```

## Cookie Signing

The main benefit of signed cookies is being able to detect tampered cookies without
reaching the storage backend, but this isn't strictly required for this library to work or to
provide security.

You can implement cookie signing outside this library as an additional security layer.

```ts
import * as tcs from "tiny-cookie-session";

// Dummy implementations, replace with real signing logic from a library
function signCookie(value: string): string {
  return value;
}
function unsignCookie(signedValue: string): string {
  return signedValue;
}

function serializeAndSignCookie(cookie: tcs.Cookie): string {
  const signedValue = signCookie(cookie.value);
  return new Bun.Cookie("mysession", signedValue, cookie.options).serialize();
}

function parseAndUnsignCookie(request: Request): string | undefined {
  const cookieHeader = request.headers.get("Cookie");
  if (cookieHeader === null) return undefined;

  const sessionCookie = new Bun.CookieMap(cookieHeader).get("mysession");
  if (sessionCookie === null) return undefined;

  return unsignCookie(sessionCookie);
}
```

## Configuring Expiration Times

You can use custom expiration times by passing configuration options to the functions:

```ts
import * as tcs from "tiny-cookie-session";

const config = {
  sessionExpiresIn: 5 * 60 * 60 * 1000, // 5 hours
  tokenExpiresIn: 10 * 60 * 1000, // 10 minutes
};

tcs.consume({ config /* other params */ });

tcs.login({ config });
```

### Session Expiration Time

The `sessionExpiresIn` value controls how long a session can remain active without user interaction,
often referred to as "log out after X minutes of inactivity."

For example, with `sessionExpiresIn: 30 * 60 * 1000` (30 minutes),
a user can remain logged in indefinitely by making requests at least every 29 minutes.

### Token Expiration Time

The `tokenExpiresIn` value controls how frequently tokens are rotated when sessions are active.
When a token expires but the session is still valid, the system generates a new token.
The longer you set `tokenExpiresIn`,
the longer an attacker can use a stolen token before session forking is detected.

You should set this to a value as short as possible, but still longer than the longest HTTP request
time your users might experience.
For example, if your app might take up to 3 minutes (in a single request) for uploading large files,
you should set `tokenExpiresIn` to 3 minutes.
The only reason we don't rotate the token on every request is to handle a race condition
where the user makes two requests at the same time.

### Different Expiration Times per User

You can implement different expiration times for different users by passing custom configuration
to each function call.

```ts
import * as tcs from "tiny-cookie-session";

async function handleRequest(request: Request, securityType: "strict" | "lenient") {
  const config =
    securityType === "strict"
      ? {
          sessionExpiresIn: 30 * 60 * 1000, // 30 minutes
          tokenExpiresIn: 2 * 60 * 1000, // 2 minutes
        }
      : {
          sessionExpiresIn: 24 * 60 * 60 * 1000, // 24 hours
          tokenExpiresIn: 10 * 60 * 1000, // 10 minutes
        };

  await tcs.consume({ config /* other params */ });
}
```

## Session Id and Token Security

This library uses 256 bits of entropy for session id and token generation,
exceeding industry recommendations:

- OWASP recommends at least 64 bits of entropy ([OWASP Guidelines](https://owasp.org/www-community/vulnerabilities/Insufficient_Session-ID_Length))
- Remix uses 64 bits of entropy ([Remix Source](https://github.com/remix-run/remix/blob/b7d280140b27507530bcd66f7b30abe3e9d76436/packages/remix-node/sessions/fileStorage.ts#L45))
- Lucia uses 160 bits of entropy in their example ([Lucia Source](https://github.com/lucia-auth/lucia/blob/46b164f78dc7983d7a4c3fb184505a01a4939efd/pages/sessions/basic-api/sqlite.md?plain=1#L88))
- Auth.js uses 256 bits of entropy in their tests ([Auth.js Source](https://github.com/nextauthjs/next-auth/blob/c5a70d383bb97b39f8edbbaf69c4c7620246e9a4/packages/core/test/actions/session.test.ts#L146))

Since the session id and token are already random strings with high entropy
(unlike a password), we don't need additional processing like salting or peppering.

The session id and token are hashed using SHA-256 before being stored in the database.
This way a database leak would not lead to session hijacking.

Hashing the id and token on every request might seem expensive,
but it's no more demanding than cookie signing, which is a common practice in web services.

Also, [we don't have to use `crypto.timingSafeEqual` when comparing tokens because we are comparing
hashes of high entropy values](https://security.stackexchange.com/questions/237116/using-timingsafeequal#comment521092_237133).

## CSRF

This library focuses solely on session management and does not implement CSRF protection.
You should implement CSRF protection for your entire application before using any functions from
this library.

## LICENSE

```
Zero-Clause BSD
=============

Permission to use, copy, modify, and/or distribute this software for
any purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL
WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES
OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE
FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY
DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN
AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT
OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

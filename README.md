# :cookie: tiny-cookie-session.js

**tiny-cookie-session** is a cookie-based session management library that detects session forking.
When session forking is detected, this library logs out both the attacker and the user.

## Installation

```sh
pnpm install github:aabccd021/tiny-cookie-session
yarn add github:aabccd021/tiny-cookie-session
bun install github:aabccd021/tiny-cookie-session
```

## Usage

This library can be used with any storage backend that can select, set (upsert), and delete
key-value pairs.
After implementing storage functions, you can use it to handle `Action` object returned by
this library.
You should also return a response with the cookie returned by this library.

```ts
import * as tcs from "tiny-cookie-session";

async function login(db: unknown, arg: tcs.LoginArg): Promise<Response> {
  const session = await tcs.login(arg);

  // handle action
  dbSetSession(db, session.action);

  // return response with cookie
  const headers = new Headers();
  if (session.cookie !== undefined) {
    headers.append("Set-Cookie", serializeCookie(session.cookie));
  }

  return new Response("Logged in", { headers });
}
```

We strongly recommend reading the [index.test.ts](./index.test.ts) file for more detailed usage
examples.

## Bun SQLite storage example

```ts
import * as sqlite from "bun:sqlite";

function dbInit(): sqlite.Database {
  const db = sqlite.open(":memory:");
  db.run(`
    CREATE TABLE IF NOT EXISTS session (
      id_hash TEXT PRIMARY KEY,
      session_exp_epoch_ms INTEGER NOT NULL,
      token_exp_epoch_ms INTEGER NOT NULL,
      token_1_hash TEXT NOT NULL,
      token_2_hash TEXT
    )
  `);
  return db;
}

function dbSelectSession(db: sqlite.Database, idHash: string): tcs.SessionData | undefined {
  const row = db.query("SELECT * FROM session WHERE id_hash = :idHash").get({ idHash });
  if (row === null) {
    return undefined;
  }
  return {
    sessionExpEpochMs: row.session_exp_epoch_ms,
    tokenExpEpochMs: row.token_exp_epoch_ms,
    token1Hash: row.token_1_hash,
    token2Hash: row.token_2_hash,
  };
}

function dbSetSession(db: sqlite.Database, action: tcs.SetSessionAction): void {
  db.query(
    `
      INSERT OR REPLACE INTO session (id_hash, session_exp_epoch_ms, token_exp_epoch_ms, token_1_hash, token_2_hash)
      VALUES (:idHash, :sessionExpEpochMs, :tokenExpEpochMs, :token1Hash, :token2Hash)
    `,
  ).run({
    idHash: action.idHash,
    sessionExpEpochMs: action.sessionData.sessionExpEpochMs,
    tokenExpEpochMs: action.sessionData.tokenExpEpochMs,
    token1Hash: action.sessionData.token1Hash,
    token2Hash: action.sessionData.token2Hash,
  });
}

function dbDeleteSession(db: sqlite.Database, action: tcs.DeleteSessionAction): void {
  db.query("DELETE FROM session WHERE id_hash = :idHash").run({ idHash: action.idHash });
}
```

## Garbage collection of expired sessions

Since this library doesn't automatically delete expired sessions for inactive users,
you'll need to implement your own garbage collection mechanism:

```js
// Run this periodically
db.query("DELETE FROM session WHERE session_exp < :now").run({ now: Date.now() });
```

Doing or not doing garbage collection on expired sessions is always safe and has no security
implications, since those sessions would be rejected as "SessionExpired" anyway if a user tried
to use them.## Force logout session

This library allows you to immediately invalidate sessions by deleting them from the storage
backend. Unlike JWT, the session logout is effective immediately when this is done.

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

## CSRF

This library focuses solely on session management and does not implement CSRF protection.
You should implement CSRF protection for your entire application before using any functions from
this library.

## Cookie Signing

The main benefit of signed cookies is being able to detect tampered cookies without
reaching the storage backend, but this isn't strictly required for this library to work or to
provide security.

You can implement cookie signing outside this library as an additional security layer. :pencil2:

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
  sessionExpiresInMs: 5 * 60 * 60 * 1000, // 5 hours
  tokenExpiresInMs: 10 * 60 * 1000, // 10 minutes
};

tcs.consume({ config /* other params */ });

tcs.login({ config });
```

### Session Expiration Time

The `sessionExpiresInMs` value controls how long a session can remain active without user interaction,
often referred to as "log out after X minutes of inactivity."

For example, with `sessionExpiresInMs: 30 * 60 * 1000` (30 minutes),
a user can remain logged in indefinitely by making requests at least every 29 minutes.

### Token Expiration Time

The `tokenExpiresInMs` value controls how often the token is rotated.
When a token expires but the session is still valid, the system generates a new token.

You should set this to a value as short as possible, but still longer than the longest HTTP request
time your users might experience.
For example, if your app might take up to 3 minutes (in a single request) for uploading large files,
you should set `tokenExpiresInMs` to 3 minutes.
The only reason we don't rotate the token on every request is to handle a race condition
where the user makes two requests at the same time.

## :warning: Important: Security limitations

While this library detects session forking, it does not provide complete protection.
You should understand its limitations before using it in production.

### How session ID and token are stored

This library uses randomly generated session IDs and tokens to identify a session.
The session ID is a long-lived identifier for the session, while the token is a short-lived value
that is rotated periodically.
Both the session ID and token are stored in a cookie.

### Detecting outdated cookies

After a cookie is stolen and the token is rotated,
either the attacker or the user will have an outdated token.
When this outdated token is used, it is detected as session forking and both parties are logged out.
We log out both parties because we cannot determine which party used the invalid token.

### If the attacker steals an old cookie

If the attacker steals an old cookie (stolen before the latest rotation),
both parties will be logged out when the attacker uses the cookie.
In this case, no harm is done to the user, except that the user will be logged out unexpectedly.

### If the attacker steals a recent cookie

For most scenarios, session forking will be detected after the attacker uses the stolen cookie.
In that case, the attacker can only use the session until the forking is detected.

Although, there are two worst-case scenarios where we can't detect session forking,
making the attacker able to use the session indefinitely:

1. The attacker steals a cookie, and the user never uses the session again (inactive).
2. The attacker steals a cookie, and somehow (forcefully) logs out the user.

The only way to prevent these scenarios is to either use Device Bound Session Credentials (DBSC),
or to identify attackers from other signals (e.g., IP address, User-Agent, geolocation, etc.).

#### If the user is inactive after the cookie is stolen

There are two possible approaches to mitigate this risk:

1. Set a short session expiration time (`sessionExpiresInMs`).
2. Implement a "Don't remember me" option.

The "Don't remember me" feature can be implemented by removing the `Expires` and `Max-Age`
attributes from the session cookie.
This way, the only way for the attacker to do harm is to steal the last cookie used before closing
the browser.

#### If the attacker forcefully logs out the user

There are two possible approaches to mitigate this risk:

1. Implement a "Log out other devices" feature.
2. Allow only one active session at a time.

The "Log out other devices" feature enables the user to log out the attacker's session on the next
login. Allowing only one active session (the latest logged-in session) is safer since it's done
automatically.

However, none of these approaches prevents the attacker from using the session until the user logs
in again.

### Persistent cookie theft

If the cookie is stolen persistently (e.g., via malware running in the background),
it can't be prevented by any cookie-based mechanism, including this library or even DBSC.

The user is cooked at this point :fire:. The only solution is to log in from a clean device and log out
all other devices.

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

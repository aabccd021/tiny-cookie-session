# tiny-cookie-session

**tiny-cookie-session** is a cookie-based session management library that detects session forking.

## Installation

```sh
pnpm install github:aabccd021/tiny-cookie-session
yarn add github:aabccd021/tiny-cookie-session
bun install github:aabccd021/tiny-cookie-session
```

## Example Usage

```ts
import * as sqlite from "bun:sqlite";
import * as tcs from "tiny-cookie-session";

function serializeCookie(cookie: tcs.Cookie): string {
  return new Bun.Cookie("mysession", cookie.value, cookie.options).serialize();
}

function parseCookie(request: Request): string | undefined {
  const cookieHeader = request.headers.get("Cookie");
  if (cookieHeader === null) {
    return undefined;
  }

  const sessionCookie = new Bun.CookieMap(cookieHeader).get("mysession");
  if (sessionCookie === null) {
    return undefined;
  }

  return sessionCookie;
}

function dbSelect(db: sqlite.Database, idHash: string) {
  const row = db
    .query<
      {
        user_id: string;
        exp: string;
        odd_token_hash: string;
        even_token_hash: string | null;
        token_exp: string;
        is_latest_token_odd: number;
      },
      sqlite.SQLQueryBindings
    >(
      `
      SELECT user_id, exp, odd_token_hash, even_token_hash, token_exp, is_latest_token_odd
      FROM sessions WHERE id_hash = :id_hash
    `,
    )
    .get({ id_hash: idHash });

  if (row === null) {
    return null;
  }

  return {
    userId: row.user_id,
    exp: new Date(row.exp),
    oddTokenHash: row.odd_token_hash,
    evenTokenHash: row.even_token_hash,
    tokenExp: new Date(row.token_exp),
    isLatestTokenOdd: row.is_latest_token_odd === 1,
  };
}

function dbInsert(db: sqlite.Database, action: tcs.InsertAction, userId: string) {
  db.query(`
    INSERT INTO sessions (id_hash, user_id, exp, odd_token_hash, token_exp, is_latest_token_odd)
    VALUES (:id_hash, :user_id, :exp, :odd_token_hash, :token_exp, :is_latest_token_odd)
  `).run({
    id_hash: action.idHash,
    user_id: userId,
    exp: action.exp.toISOString(),
    odd_token_hash: action.oddTokenHash,
    token_exp: action.tokenExp.toISOString(),
    is_latest_token_odd: action.isLatestTokenOdd ? 1 : 0,
  });
}

function dbUpdate(db: sqlite.Database, action: tcs.UpdateAction) {
  db.query(`
    UPDATE sessions
    SET 
      exp = :exp,
      token_exp = :token_exp,
      odd_token_hash = COALESCE(:odd_token_hash, odd_token_hash),
      even_token_hash = COALESCE(:even_token_hash, even_token_hash),
      is_latest_token_odd = :is_latest_token_odd
    WHERE id_hash = :id_hash
  `).run({
    id_hash: action.idHash,
    exp: action.exp.toISOString(),
    token_exp: action.tokenExp.toISOString(),
    odd_token_hash: action.oddTokenHash ?? null,
    even_token_hash: action.evenTokenHash ?? null,
    is_latest_token_odd: action.isLatestTokenOdd ? 1 : 0,
  });
}

function dbDelete(db: sqlite.Database, action: tcs.DeleteAction) {
  db.query("DELETE FROM sessions WHERE id_hash = :id_hash").run({ id_hash: action.idHash });
}

const db = new sqlite.Database(":memory:");

db.run(`
  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    exp TEXT NOT NULL,
    odd_token_hash TEXT NOT NULL,
    even_token_hash TEXT,
    token_exp TEXT NOT NULL,
    is_latest_token_odd INTEGER NOT NULL
  )
`);

Bun.serve({
  fetch: async (request) => {
    const url = new URL(request.url);

    if (url.pathname === "/login" && request.method === "POST") {
      const body = await request.formData();
      const userId = body.get("user_id")?.toString() ?? "";

      const { action, cookie } = await tcs.login();
      if (action.type === "insert") {
        dbInsert(db, action, userId);
      } else {
        action.type satisfies never;
      }

      return new Response("Logged in", {
        status: 200,
        headers: {
          "Set-Cookie": cookie.toString(),
        },
      });
    }

    if (url.pathname === "/logout" && request.method === "POST") {
      const sessionCookie = parseCookie(request);
      if (sessionCookie === undefined) {
        return Response.json("No Session Cookie", {
          status: 400,
          headers: { "Set-Cookie": serializeCookie(tcs.logoutCookie) },
        });
      }

      const credential = await tcs.credentialFromCookie({ cookie: sessionCookie });
      if (credential === undefined) {
        return Response.json("Malformed Session Cookie", {
          status: 400,
          headers: { "Set-Cookie": serializeCookie(tcs.logoutCookie) },
        });
      }

      const { action, cookie } = await tcs.logout({ credential });

      if (action.type === "delete") {
        dbDelete(db, action);
      } else {
        action.type satisfies never;
      }

      return new Response("Logged out", {
        status: 200,
        headers: {
          "Set-Cookie": serializeCookie(cookie),
        },
      });
    }

    if (url.pathname === "/user_id" && request.method === "GET") {
      const sessionCookie = parseCookie(request);
      if (sessionCookie === undefined) {
        return Response.json("No Session Cookie", {
          status: 400,
          headers: { "Set-Cookie": serializeCookie(tcs.logoutCookie) },
        });
      }

      const credential = await tcs.credentialFromCookie({ cookie: sessionCookie });
      if (credential === undefined) {
        return Response.json("Malformed Session Cookie", {
          status: 400,
          headers: { "Set-Cookie": serializeCookie(tcs.logoutCookie) },
        });
      }

      const session = dbSelect(db, credential.idHash);
      if (session === null) {
        return Response.json("Session Not Found", {
          status: 404,
          headers: { "Set-Cookie": serializeCookie(tcs.logoutCookie) },
        });
      }

      const { action, cookie, state } = await tcs.consume({ credential, session });

      if (action?.type === "delete") {
        dbDelete(db, action);
      } else if (action?.type === "update") {
        dbUpdate(db, action);
      } else if (action !== undefined) {
        action satisfies never;
      }

      const headers = new Headers();
      if (cookie) {
        headers.set("Set-Cookie", serializeCookie(cookie));
      }

      if (state === "SessionActive" || state === "TokenRotated") {
        return Response.json({ userId: session.userId }, { status: 200, headers });
      }

      if (state === "SessionForked") {
        console.warn(`Session forked for user ${session.userId}`);
        return Response.json("", { status: 403, headers });
      }

      if (state === "SessionExpired") {
        return Response.json("Session Expired", { status: 403, headers });
      }

      state satisfies never;
    }

    return Response.json("Not Found", { status: 404 });
  },
});
```

## Cookie Parsing/Serializing

This library focuses solely on session management and doesn't handle cookie parsing or serialization.
You'll need to use your platform's cookie handling capabilities or a dedicated cookie library.

```js
// Using the `cookie` library
import cookie from "cookie";

// When logging in
const result = await login({ config });
const cookieStr = cookie.serialize("session", result.cookie.value, result.cookie.options);
response.setHeader("Set-Cookie", cookieStr);

// When using a session
const cookies = cookie.parse(request.headers.cookie || "");
const cookieValue = cookies.session;
const credentials = await credentialsFromCookie({ cookie: cookieValue });
```

## Garbage Collecting Expired Sessions

As sessions expire, they should be removed from your database to prevent it from growing indefinitely.
Since this library doesn't automatically delete expired sessions for inactive users, you'll need to implement your own garbage collection mechanism:

```js
db.query("DELETE FROM session WHERE exp < :now").run({ now: Date.now() });
```

Garbage collecting expired sessions is always safe and has no security implications, since those sessions would be rejected as "Expired" anyway if a user tried to use them.

## Force Logout Sessions

This library allows you to immediately invalidate sessions by deleting them from the storage backend:

```js
// Force logout a specific session
db.query("DELETE FROM session WHERE id_hash = :idHash").run({ idHash });

// Force logout all sessions for a specific user
db.query("DELETE FROM session WHERE user_id = :userId").run({ userId });

// Force logout all users
db.query(`DELETE FROM session`).run();
```

## Deleting Cookie After Browser Closes

To create session cookies that are removed when the browser closes (equivalent to when "Remember me" is not checked), remove the expiration attributes:

```js
// When logging in
const result = await login({ config });
await runAction(result.action);
delete result.cookie.options.expires;
delete result.cookie.options.maxAge;
const bunCookie = new Bun.Cookie("session", result.cookie.value, result.cookie.options);

// When rotating token
if (consumeResult.state === "TokenRotated") {
  delete consumeResult.cookie.options.expires;
  delete consumeResult.cookie.options.maxAge;
  const bunCookie = new Bun.Cookie("session", consumeResult.cookie.value, consumeResult.cookie.options);
}
```

## Session Forking Detection

### How the Detection Works

Session forking is detected when a request contains a token that is associated with a valid session, but is not one of the two most recently issued tokens for that session.

The system stores all tokens that have ever been issued for a session (unless you implement token garbage collection).
When a token is used, the system checks if it's one of the two most recent tokens:

- If it is, the request is considered valid (either the current or immediately previous token).
- If not, the system concludes the token was stolen and invalidates the entire session.

Only the user or the attacker can have the latest token at any given time.
If a non-latest token is used, it means someone is using an old token, either the user or an attacker.

See [test](./index.test.js) for detailed tests of the session forking detection mechanism.

When session forking is detected, the entire session is invalidated, forcing both the user and the attacker to re-authenticate.

This library can detect session forking after it has occurred and limit the attacker's window of opportunity.

### Handling Race Conditions

To prevent users from being accidentally logged out during concurrent requests, both the current and previous tokens are considered valid.

This handles cases like:

- The user loads a page (using token A).
- The first request from that page causes token rotation (token A → token B).
- A second request still uses token A (concurrent with the first request).

Without keeping the previous token valid, the second request would be incorrectly flagged as theft.

## Choosing `sessionExpiresIn` and `tokenExpiresIn`

### Session Expiration Time

The session expires after a period of inactivity equal to `sessionExpiresIn`.
This is similar to "log out after X minutes of inactivity."

For example, with `sessionExpiresIn: 30 * 60 * 1000` (30 minutes), a user can remain logged in indefinitely by making requests at least every 29 minutes.

The expiration time will be extended both in the database's `exp` column and in the cookie's `Expires` attribute.

Your choice for session expiration time should balance security and user experience:

- Shorter session durations increase security but require users to log in more frequently.
- Longer session durations improve user experience but increase the risk if credentials are stolen.

### Token Expiration Time

The `tokenExpiresIn` value controls how frequently tokens are rotated when sessions are active.
When a token expires but the session is still valid, the system generates a new token.

Your choice for token expiration time affects:

- **User Experience**: Excessively short token lifetimes may cause unexpected logouts if requests take longer than the token expiration time.

## Session Token Security

This library uses 256 bits of entropy for session tokens, exceeding industry recommendations:

- OWASP recommends at least 64 bits of entropy ([OWASP Guidelines](https://owasp.org/www-community/vulnerabilities/Insufficient_Session-ID_Length))
- Remix uses 64 bits of entropy ([Remix Source](https://github.com/remix-run/remix/blob/b7d280140b27507530bcd66f7b30abe3e9d76436/packages/remix-node/sessions/fileStorage.ts#L45))
- Lucia uses 160 bits of entropy in their SQLite example ([Lucia Source](https://github.com/lucia-auth/lucia/blob/46b164f78dc7983d7a4c3fb184505a01a4939efd/pages/sessions/basic-api/sqlite.md?plain=1#L88))
- Auth.js uses 256 bits of entropy in their tests ([Auth.js Source](https://github.com/nextauthjs/next-auth/blob/c5a70d383bb97b39f8edbbaf69c4c7620246e9a4/packages/core/test/actions/session.test.ts#L146))

Since the token itself is already a random string with high entropy (unlike a password), we don't need additional processing like salting or peppering.

The token is hashed using SHA-256 before being stored in the database. This way a database leak would not lead to token theft.

Hashing the token on every request might seem expensive, but it's no more demanding than cookie signing, which is a common practice in web services.

Also, [we don't have to use `crypto.timingSafeEqual` when comparing tokens because we are comparing hashes of high entropy tokens](https://security.stackexchange.com/questions/237116/using-timingsafeequal#comment521092_237133).

## Session Forking vs Total Hijack

Total hijack is when an attacker completely takes over a session, and logs out the legitimate user.

This is not session forking so this library does not detect or prevent it.

## CSRF

This library focuses solely on session management and does not implement CSRF protection.
You should implement CSRF protection for your entire application before using any functions from this library.

## Signed Cookies

This library doesn't sign cookies directly.
The main benefit of signed cookies is detecting cookie tampering without reaching the storage backend, but this isn't strictly required for this library to work or to provide security.

You can implement cookie signing as an additional layer in your application if desired:

## Security Limitations

While this library provides session forking detection, be aware of these limitations:

1. An attacker can use a stolen cookie until the user accesses the system again.
2. If the user never logs back in, the attacker's session may remain active.
3. Constant session forking (e.g., via persistent background malware) can't be prevented by any cookie-based mechanism, including this library and DBSC.

## Comparison of Cookie-Based Session Management Approaches

### Long-lived session ID

- The server generates a long-lived session ID and stores it in a cookie.
- If the cookie is stolen, an attacker can use it until the session expires or the user logs out manually.
- Both the attacker and the user can use the same session simultaneously.
- The server cannot distinguish between requests made by the attacker and those made by the user.

### Simple token rotation

- Each session is associated with a short-lived token that is rotated periodically.
- Only the latest token is stored in the database.
- If the token is stolen and the attacker manages to rotate the token before the user does, they take over the session and can continue using it indefinitely.
- The user may experience a mysterious logout.
- The user can use a "log out other devices" feature to manually inspect the list of devices and log out any suspicious ones.

### tiny-cookie-session

- Each session is associated with a short-lived token that is rotated periodically.
- All previous tokens (belonging to active sessions) are stored in the database.
- If the token is stolen, the attacker can use the session until the next time the user uses the session.
- When the user uses the session, both the attacker and the user will be logged out.

### Device Bound Session Credentials (DBSC)

- Each session is associated with a short-lived token that can only be rotated by the user.
- Only the latest token is stored in the database.
- If the token is stolen, the attacker can use it until the next rotation.
- The user notices nothing and can continue using the system as usual.

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

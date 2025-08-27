# tiny-cookie-session

**tiny-cookie-session** is a cookie-based session management library that detects session forking.

## Installation

```sh
pnpm install github:aabccd021/tiny-cookie-session
yarn add github:aabccd021/tiny-cookie-session
bun install github:aabccd021/tiny-cookie-session
```

## Configuration

This library requires a storage adapter configuration that implements four core functions: `selectSession`, `insertSession`, `updateSession`, and `deleteSession`.

### Bun SQLite Configuration Example

```js
// TODO library updated and no more methods like `selectSession`, instead the user need to implement `runAction`
import { Database } from "bun:sqlite";
import { login, logout, consumeSession, testConfig } from "tiny-cookie-session";

// Create and initialize your database
const db = new Database("sessions.db");
db.exec("PRAGMA foreign_keys = ON;");
db.run(`
  CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,
    expiration_time INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
`);

// Create session configuration
const sessionConfig = {
  sessionExpiresIn: 5 * 60 * 60 * 1000, // 5 hours
  tokenExpiresIn: 10 * 60 * 1000, // 10 minutes

  selectSession: async ({ tokenHash }) => {
    const session = db
      .query(
        `
          SELECT 
            s.id, 
            s.expiration_time as expirationTime, 
            s.user_id as userId,
            s.created_at as createdAt
          FROM session s
          WHERE t.hash = $tokenHash
        `,
      )
      .get({ tokenHash });

    if (!session) return undefined;

    // Get the two most recent tokens for this session
    const tokenHashes = db
      .query(
        `
          SELECT hash
          WHERE session_id = $sessionId
          ORDER BY expiration_time DESC
          LIMIT 2
        `,
      )
      .all({ sessionId: session.id });

    const [tokenHash0, tokenHash1] = tokenHashes;

    if (tokenHash0 === undefined) throw new Error("Expected at least one token");

    return {
      id: session.id,
      exp: new Date(session.expirationTime),
      tokenExp: new Date(session.expirationTime),
      latestTokenHashes: [tokenHash0, tokenHash1],
      data: {
        userId: session.userId,
        createdAt: new Date(session.createdAt),
      },
    };
  },

  insertSession: async ({ id, exp, tokenHash, tokenExp, data }) => {
      db.query(
        `
          INSERT INTO session (id, expiration_time, user_id)
          VALUES ($id, $exp, $userId)
        `,
      ).run({
        id,
        exp: exp.getTime(),
        userId: data.userId,
      });

  },

  updateSession: async ({ id, exp, tokenExp, tokenHash }) => {
      db.query(
        `
          UPDATE session
          SET expiration_time = $exp
          WHERE id = $id
        `,
      ).run({
        id,
        exp: exp.getTime(),
      });
  },

  deleteSession: async ({ tokenHash }) => {
    db.query(
      `
        DELETE FROM session
        WHERE id IN ()
      `,
    ).run({ tokenHash });
  },
};
```

### In-Memory Store Configuration Example

```js
// TODO
```

See [test](./index.test.js) for actual implementation and testing of the in-memory store.

## Basic Usage

```js
import { login, logout, consumeSession } from "tiny-cookie-session";
import { serve } from "bun";

// Initialize your session config (see previous examples)
const sessionConfig = {
  /* your session config */
};

serve({
  port: 3000,
  async fetch(request) {
    const url = new URL(request.url);

    // Login endpoint
    if (url.pathname === "/login") {
      // Create a new session
      const userId = "user-123"; // From your authentication system
      const sessionId = crypto.randomUUID();

      const cookie = await login(sessionConfig, {
        id: sessionId,
        data: { userId },
      });

      // Create a cookie using Bun's built-in Cookie API
      const bunCookie = new Bun.Cookie("session", cookie.value, cookie.options);

      return new Response("Logged in successfully", {
        headers: { "Set-Cookie": bunCookie.serialize() },
      });
    }

    // Logout endpoint
    if (url.pathname === "/logout") {
      const cookieHeader = request.headers.get("Cookie");
      if (!cookieHeader) return new Response("Not logged in", { status: 401 });

      const token = new Bun.CookieMap(cookieHeader).get("session");
      if (!token) return new Response("Not logged in", { status: 401 });

      const cookie = await logout(sessionConfig, { token });
      const bunCookie = new Bun.Cookie("session", cookie.value, cookie.options);

      return new Response("Logged out successfully", {
        headers: { "Set-Cookie": bunCookie.serialize() },
      });
    }

    // Protected endpoint that requires authentication
    if (url.pathname === "/profile") {
      const cookieHeader = request.headers.get("Cookie");
      if (!cookieHeader) return new Response("Not logged in", { status: 401 });

      const token = new Bun.CookieMap(cookieHeader).get("session");
      if (!token) return new Response("Not logged in", { status: 401 });

      // Use the session
      const session = await consumeSession(sessionConfig, { token });

      // Handle different session states
      if (session.state === "NotFound") {
        const bunCookie = new Bun.Cookie("session", session.cookie.value, session.cookie.options);
        return new Response("Not logged in", {
          status: 401,
          headers: { "Set-Cookie": bunCookie.serialize() },
        });
      }

      if (session.state === "TokenStolen") {
        const bunCookie = new Bun.Cookie("session", session.cookie.value, session.cookie.options);
        return new Response("Session invalidated due to potential theft", {
          status: 401,
          headers: { "Set-Cookie": bunCookie.serialize() },
        });
      }

      if (session.state === "Expired") {
        const bunCookie = new Bun.Cookie("session", session.cookie.value, session.cookie.options);
        return new Response("Session expired", {
          status: 401,
          headers: { "Set-Cookie": bunCookie.serialize() },
        });
      }

      if (session.state === "TokenRotated") {
        // Set the new token in the response
        const bunCookie = new Bun.Cookie("session", session.cookie.value, session.cookie.options);
        return new Response(`Hello ${session.data.userId}`, {
          headers: { "Set-Cookie": bunCookie.serialize() },
        });
      }

      if (session.state === "Active") {
        return new Response(`Hello ${session.data.userId}`);
      }
    }

    // Default response for unknown routes
    return new Response("Not found", { status: 404 });
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
const sessionCookie = await login(config, { id: sessionId, data: { userId } });
const cookieStr = cookie.serialize("session", sessionCookie.value, sessionCookie.options);
response.setHeader("Set-Cookie", cookieStr);

// When using a session
const cookies = cookie.parse(request.headers.cookie || "");
const token = cookies.session;
const session = await consumeSession(config, { token });
```

## Garbage Collecting Expired Sessions

As sessions expire, they should be removed from your database to prevent it from growing indefinitely.
Since this library doesn't automatically delete expired sessions for inactive users, you'll need to implement your own garbage collection mechanism:

```js
db.query("DELETE FROM session WHERE expiration_time < $now").run({ now });
```

Garbage collecting expired sessions is always safe and has no security implications, since those sessions would be rejected as "Expired" anyway if a user tried to use them.

## Force Logout Sessions

This library allows you to immediately invalidate sessions by deleting them from the storage backend:

```js
// Force logout a specific session
db.query("DELETE FROM session WHERE id = $sessionId").run({ sessionId });

// Force logout all sessions for a specific user
db.query("DELETE FROM session WHERE user_id = $userId").run({ userId });

// Force logout all users
db.query(`DELETE FROM session`).run();
```

## Deleting Cookie After Browser Closes

To create session cookies that are removed when the browser closes (equivalent to when "Remember me" is not checked), remove the expiration attributes:

```js
// When logging in
const cookie = await login(config, { id: sessionId });
delete cookie.options.expires;
delete cookie.options.maxAge;
const bunCookie = new Bun.Cookie("session", cookie.value, cookie.options);

// When rotating token
if (session.state === "TokenRotated") {
  delete session.cookie.options.expires;
  delete session.cookie.options.maxAge;
  const bunCookie = new Bun.Cookie("session", session.cookie.value, session.cookie.options);
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

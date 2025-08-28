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

// Cookie signing is optional and not handled by tiny-cookie-session.
function signCookie(value: string): string {
  return value;
}

function unsignCookie(value: string): string {
  return value;
}

function serializeCookie(cookie: tcs.Cookie): string {
  const options = { 
      ...cookie.options, 
      // Path is not set by default. 
      // "/" makes the cookie available to all paths.
      path: "/",
      // SameSite is set to "Strict" by default. 
      // "Lax" allows user to navigate (GET) to the site from an external link.
      sameSite: "Lax",
  }

  // We use Bun.Cookie here, but it's also compatible with https://www.npmjs.com/package/cookie.
  return new Bun.Cookie("mysession", signCookie(cookie.value), options).serialize();
}

function parseCookie(request: Request): string | undefined {
  const cookieHeader = request.headers.get("Cookie");
  if (cookieHeader === null) {
    return undefined;
  }

  // We use Bun.CookieMap here, but it's also compatible with https://www.npmjs.com/package/cookie.
  const sessionCookie = new Bun.CookieMap(cookieHeader).get("mysession");
  if (sessionCookie === null) {
    return undefined;
  }

  return unsignCookie(sessionCookie);
}

function dbSelect(db: sqlite.Database, idHash: string) {
  const row = db
    .query<
      {
        user_id: string;
        exp: string;
        token_exp: string;
        odd_token_hash: string;
        even_token_hash: string | null;
        is_latest_token_odd: number;
        platform: string | null;
      },
      sqlite.SQLQueryBindings
    >(
      `
      SELECT user_id, exp, token_exp, odd_token_hash, even_token_hash, is_latest_token_odd, platform
      FROM session WHERE id_hash = :id_hash
    `,
    )
    .get({ id_hash: idHash });

  if (row === null) {
    return null;
  }

  return {
    userId: row.user_id,
    exp: new Date(row.exp),
    tokenExp: new Date(row.token_exp),
    oddTokenHash: row.odd_token_hash,
    evenTokenHash: row.even_token_hash,
    isLatestTokenOdd: row.is_latest_token_odd === 1,
    platform: row.platform ?? undefined,
  };
}

function dbInsert(db: sqlite.Database, action: tcs.InsertAction, userId: string, platform?: string) {
  db.query(`
    INSERT INTO session (id_hash, user_id, exp, odd_token_hash, token_exp, is_latest_token_odd, platform)
    VALUES (:id_hash, :user_id, :exp, :odd_token_hash, :token_exp, :is_latest_token_odd, :platform)
  `).run({
    id_hash: action.idHash,
    user_id: userId,
    exp: action.exp.toISOString(),
    odd_token_hash: action.oddTokenHash,
    token_exp: action.tokenExp.toISOString(),
    is_latest_token_odd: action.isLatestTokenOdd ? 1 : 0,
    platform: platform ?? null,
  });
}

function dbUpdate(db: sqlite.Database, action: tcs.UpdateAction) {
  db.query(`
    UPDATE session
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
  db.query("DELETE FROM session WHERE id_hash = :id_hash").run({ id_hash: action.idHash });
}

const db = new sqlite.Database(":memory:");

db.run(`
  CREATE TABLE session (
    id_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    exp TEXT NOT NULL,
    odd_token_hash TEXT NOT NULL,
    even_token_hash TEXT,
    token_exp TEXT NOT NULL,
    is_latest_token_odd INTEGER NOT NULL,
    platform TEXT,
    CHECK (is_latest_token_odd IN (0, 1))
  )
`);

const appConfig = {
  isMultipleSessionAllowed: false,
};

const sessionConfig = {
  sessionExpiresIn: 30 * 60 * 1000, // 30 minutes
  tokenExpiresIn: 2 * 60 * 1000, // 2 minutes
}

Bun.serve({
  fetch: async (request) => {
    const url = new URL(request.url);

    if (url.pathname === "/login" && request.method === "POST") {
      const body = await request.formData();

      // User ID should be obtained from trusted source.
      const userId = body.get("user_id")?.toString();
      if (userId === undefined || userId === "") {
        return Response.json("No User ID", { status: 400 });
      }

      if (!appConfig.isMultipleSessionAllowed) {
        db.query("DELETE FROM session WHERE user_id = :user_id").run({ user_id: userId });
      }

      const { action, cookie } = await tcs.login({ config: sessionConfig });

      if (action.type === "insert") {
        dbInsert(db, action, userId);
      } else {
        action.type satisfies never;
      }

      let page = "<h1>Signed In</h1>";

      if (appConfig.isMultipleSessionAllowed) {
        const sessions = db
          .query<{ id_hash: string; platform: string | null; }, sqlite.SQLQueryBindings>(
            "SELECT id_hash, platform FROM session WHERE user_id = :user_id"
          )
          .all({ user_id: userId });
        page += "<h2>Active Sessions</h2><ul>";
        page += "<p>Please log out from devices you don't recognize.</p>";
        page += "<ul>";
        for (const session of sessions) {
          page += `<li>Session ID: ${session.id_hash}, Platform: ${session.platform ?? "Unknown"}</li>`;
        }
        page += "</ul>";
      }

      return new Response(page, {
        status: 200,
        headers: {
          "Content-Type": "text/html",
          "Set-Cookie": serializeCookie(cookie),
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
        return Response.json("No Session Cookie", { status: 400 });
      }

      const credential = await tcs.credentialFromCookie({ cookie: sessionCookie });
      if (credential === undefined) {
        return Response.json("Malformed Session Cookie", {
          status: 400,
          headers: { 
            // This will delete the malformed cookie in the browser.
            "Set-Cookie": serializeCookie(tcs.logoutCookie)
          },
        });
      }

      const session = dbSelect(db, credential.idHash);

      // Session might not be found if it was deleted manually by admin,
      // or if deleted automatically when multiple sessions are not allowed,
      // or if deleted automatically when session forking is detected.
      if (session === null) {
        return Response.json("Session Not Found", {
          status: 404,
          headers: { 
            // This will delete the stale cookie in the browser.
            "Set-Cookie": serializeCookie(tcs.logoutCookie)
          },
        });
      }

      const { action, cookie, state } = await tcs.consume({ credential, session, config: sessionConfig });

      if (action?.type === "delete") {
        dbDelete(db, action);
      } else if (action?.type === "update") {
        dbUpdate(db, action);
      } else if (action !== undefined) {
        action satisfies never;
      }

      const headers = new Headers();
      if (cookie !== undefined) {
        headers.set("Set-Cookie", serializeCookie(cookie));
      }

      if (state === "SessionActive" || state === "TokenRotated") {
        return Response.json({ userId: session.userId }, { status: 200, headers });
      }

      if (state === "SessionForked") {
        console.warn(`Session forked for user ${session.userId}`);
        return Response.json("Session Forked", { status: 403, headers });
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

## Garbage Collecting Expired Sessions

Since this library doesn't automatically delete expired sessions for inactive users, 
you'll need to implement your own garbage collection mechanism:


```js
// Run this periodically
db.query("DELETE FROM session WHERE exp < :now").run({ now: Date.now() });
```

Doing or not doing garbage collection on expired sessions is always safe and has no security 
implications, since those sessions would be rejected as "SessionExpired" anyway if a user tried 
to use them.

## Force Logout Sessions

This library allows you to immediately invalidate sessions by deleting them from the storage 
backend:

```js
// Force logout a specific session
db.query("DELETE FROM session WHERE id_hash = :idHash").run({ idHash });

// Force logout all sessions for a specific user
db.query("DELETE FROM session WHERE user_id = :userId").run({ userId });

// Force logout all users
db.query(`DELETE FROM session`).run();
```

## Remember Me

## Log Out Other Devices

## Choosing `sessionExpiresIn` and `tokenExpiresIn`

### Session Expiration Time

The `sessionExpiresIn` value controls how long a session can remain active without user interaction,
often referred to as "log out after X minutes of inactivity."

For example, with `sessionExpiresIn: 30 * 60 * 1000` (30 minutes), 
a user can remain logged in indefinitely by making requests at least every 29 minutes.

When the user makes a request before the session expires, 
the session's expiration time will be extended both in the database's `exp` column and 
in the cookie's `Expires` attribute.

Your choice for session expiration time should balance security and user experience.

### Token Expiration Time

The `tokenExpiresIn` value controls how frequently tokens are rotated when sessions are active.

When a token expires but the session is still valid, the system generates a new token.

Set to 2 minutes by default.

The longer you set `tokenExpiresIn`, 
the longer an attacker can use a stolen token before the session forking is detected.

So you should set this to a value as short as possible,
but still longer than the longest http request time your users might experience.

For example, if your app might need to upload a large file in a single request,
and that upload could take up to 3 minutes on a slow connection,
you should set `tokenExpiresIn` to 3 minutes.

## Session Id and Token Security

This library uses 256 bits of entropy for session id and token, exceeding industry recommendations:

- OWASP recommends at least 64 bits of entropy ([OWASP Guidelines](https://owasp.org/www-community/vulnerabilities/Insufficient_Session-ID_Length))
- Remix uses 64 bits of entropy ([Remix Source](https://github.com/remix-run/remix/blob/b7d280140b27507530bcd66f7b30abe3e9d76436/packages/remix-node/sessions/fileStorage.ts#L45))
- Lucia uses 160 bits of entropy in their SQLite example ([Lucia Source](https://github.com/lucia-auth/lucia/blob/46b164f78dc7983d7a4c3fb184505a01a4939efd/pages/sessions/basic-api/sqlite.md?plain=1#L88))
- Auth.js uses 256 bits of entropy in their tests ([Auth.js Source](https://github.com/nextauthjs/next-auth/blob/c5a70d383bb97b39f8edbbaf69c4c7620246e9a4/packages/core/test/actions/session.test.ts#L146))

Since the session id and token itself are already a random string with high entropy (unlike a password), 
we don't need additional processing like salting or peppering.

The session id and token are hashed using SHA-256 before being stored in the database. 
This way a database leak would not lead to session hijacking.

Hashing the id and token on every request might seem expensive, 
but it's no more demanding than cookie signing, which is a common practice in web services.

Also, [we don't have to use `crypto.timingSafeEqual` when comparing tokens because we are comparing 
hashes of high entropy values](https://security.stackexchange.com/questions/237116/using-timingsafeequal#comment521092_237133).

## CSRF

This library focuses solely on session management and does not implement CSRF protection.
You should implement CSRF protection for your entire application before using any functions from this library.

## Security Limitations

While this library provides session forking detection, be aware of these limitations:

1. An attacker can use a stolen cookie until the user accesses the system again.
1. If the user never logs back in, the attacker's session may remain active.
1. Total session hijack, where the attacker logs out the user, will not be detected.
1. Constant session forking (e.g., via persistent background malware) can't be prevented by any cookie-based mechanism, including this library and DBSC.

## `tiny-cookie-session` vs Device Bound Session Credentials (DBSC)

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

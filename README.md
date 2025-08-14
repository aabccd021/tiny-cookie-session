# tiny-cookie-session

**tiny-cookie-session** is a cookie-based session management library that detects cookie theft.

This library attempts to mitigate cookie theft as done by
[Device Bound Session Credentials](https://developer.chrome.com/docs/web-platform/device-bound-session-credentials),
making it more accessible by not requiring specialized secure hardware (e.g. TPM).

Nevertheless, this library falls short of DBSC in every other aspects,
so DBSC should always be preferred when available.

## Comparison of Cookie-Based Session Management Approaches

### Long-lived session id

- The server generates a long-lived session id and stores it in a cookie.
- After the cookie is stolen, the attacker can use it until the session expires or manually logged out.
- Both the attacker and the user can use the same session at the same time.
- The server can't even tell which request is made by the attacker and which is made by the user.

### Simple token rotation

- A session is associated with a short-lived token that is rotated periodically.
- Only the latest token is stored in the database.
- After the token is stolen, the attacker can use it until at least the next rotation.
- If the attacker manages to do next rotation before the user, it means they took over the session and can continue using it indefinitely.
- The user is left with a misterious log out.
- The user can use "log out other devices" feature to manually inspect the list of devices and log out any suspicious ones.

### tiny-cookie-session

- A session is associated with a short-lived token that is rotated periodically.
- All previous tokens are stored in the database.
- After the token is stolen, the attacker can use it until at least the next rotation.
- The attacker can use the session until the next time the user accesses the system.
- When the user (with old token) accesses the system again, both the attacker and the user will be logged out.

### Device Bound Session Credentials (DBSC)

- A session is associated with a short-lived token that is rotated periodically, and can only be rotated by the user.
- Only the latest token is stored in the database.
- After the token is stolen, the attacker can use it until the next rotation.
- The user notices nothing and can continue using the system as usual.

## Installation

```sh
pnpm install tiny-cookie-session@github:aabccd021/tiny-cookie-session
yarn add tiny-cookie-session@github:aabccd021/tiny-cookie-session
bun install tiny-cookie-session@github:aabccd021/tiny-cookie-session
```

## Configuration

This library requires a storage adapter configuration that implements four core functions: `selectSession`, `insertSession`, `updateSession`, and `deleteSession`.

### Bun SQLite Configuration Example

```js
import { Database } from "bun:sqlite";
import { login, logout, useSession, testConfig } from "tiny-cookie-session";

// Create and initialize your database
const db = new Database("sessions.db");
db.run(`
  CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,
    expiration_time INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE TABLE IF NOT EXISTS session_token (
    session_id TEXT NOT NULL,
    hash TEXT PRIMARY KEY,
    expiration_time INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
  );
`);

// Create session configuration
const sessionConfig = {
  dateNow: () => new Date(),
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
      JOIN session_token t ON s.id = t.session_id
      WHERE t.hash = $tokenHash
    `,
      )
      .get({ tokenHash });

    if (!session) return undefined;

    // Get the two most recent tokens for this session
    const tokens = db
      .query(
        `
      SELECT hash
      FROM session_token
      WHERE session_id = $sessionId
      ORDER BY expiration_time DESC
      LIMIT 2
    `,
      )
      .all({ sessionId: session.id });

    if (!tokens.length) return undefined;
    if (!tokens[0]) throw new Error("Expected at least one token");

    return {
      id: session.id,
      exp: new Date(session.expirationTime),
      tokenExp: new Date(session.expirationTime),
      latestTokenHashes: [tokens[0]?.hash, tokens[1]?.hash],
      data: {
        userId: session.userId,
        createdAt: new Date(session.createdAt),
      },
    };
  },

  insertSession: async ({ id, exp, tokenHash, tokenExp, data }) => {
    db.transaction(() => {
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

      db.query(
        `
        INSERT INTO session_token (session_id, hash, expiration_time)
        VALUES ($sessionId, $tokenHash, $tokenExp)
      `,
      ).run({
        sessionId: id,
        tokenHash,
        tokenExp: tokenExp.getTime(),
      });
    })();
  },

  updateSession: async ({ id, exp, tokenExp, tokenHash }) => {
    db.transaction(() => {
      db.query(
        `
        INSERT INTO session_token (session_id, hash, expiration_time)
        VALUES ($sessionId, $tokenHash, $tokenExp)
      `,
      ).run({
        sessionId: id,
        tokenHash,
        tokenExp: tokenExp.getTime(),
      });

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
    })();
  },

  deleteSession: async ({ tokenHash }) => {
    db.query(
      `
      DELETE FROM session
      WHERE id IN (
        SELECT session_id
        FROM session_token
        WHERE hash = $tokenHash
      )
    `,
    ).run({ tokenHash });
  },
};
```

### In-Memory Store Configuration Example

```js
import { login, logout, useSession, testConfig } from "tiny-cookie-session";

// Create a simple in-memory store
const sessions = {};

const config = {
  dateNow: () => new Date(),
  sessionExpiresIn: 5 * 60 * 60 * 1000, // 5 hours
  tokenExpiresIn: 10 * 60 * 1000, // 10 minutes

  selectSession: async ({ tokenHash }) => {
    for (const [id, session] of Object.entries(sessions)) {
      const [latestTokenHash1, latestTokenHash2] =
        session.tokenHashes.toReversed();
      if (
        latestTokenHash1 !== undefined &&
        session.tokenHashes.includes(tokenHash)
      ) {
        return {
          id,
          latestTokenHashes: [latestTokenHash1, latestTokenHash2],
          exp: session.exp,
          tokenExp: session.tokenExp,
          data: {
            userId: session.userId,
            createdAt: session.createdAt,
          },
        };
      }
    }
    return undefined;
  },

  insertSession: async ({ id, exp, tokenHash, tokenExp, data }) => {
    sessions[id] = {
      exp,
      tokenExp,
      tokenHashes: [tokenHash],
      userId: data.userId,
      createdAt: new Date(),
    };
  },

  updateSession: async ({ id, exp, tokenHash, tokenExp }) => {
    const session = sessions[id];
    if (!session) throw new Error("Session not found");

    session.tokenHashes.push(tokenHash);
    session.tokenExp = tokenExp;
    session.exp = exp;
  },

  deleteSession: async ({ tokenHash }) => {
    const sessionEntry = Object.entries(sessions).find(([_, session]) =>
      session.tokenHashes.includes(tokenHash),
    );
    if (!sessionEntry) throw new Error("Session not found");

    const [id] = sessionEntry;
    delete sessions[id];
  },
};
```

See [test](./index.test.js) for actual implementation and testing of the in-memory store.

## Testing Configuration

The `testConfig` function helps verify that your storage implementation works correctly with tiny-cookie-session:

```js
import { testConfig } from "tiny-cookie-session";

// Test the configuration with various user IDs
await testConfig(config, [
  {
    id: crypto.randomUUID(),
    data: { userId: "user-1" },
  },
  {
    id: crypto.randomUUID(),
    data: { userId: "user-2" },
  },
]);
```

You can also test a single user with multiple sessions to thoroughly test your implementation:

```js
await testConfig(config, [
  { id: crypto.randomUUID(), data: { userId: "same-user" } },
  { id: crypto.randomUUID(), data: { userId: "same-user" } },
  { id: crypto.randomUUID(), data: { userId: "same-user" } },
]);
```

This function tests your implementation by simulating session operations like insertion, token rotation, and deletion.
Note that failed tests may leave data in your storage, so avoid running this in production.

## How to decide `sessionExpiresIn` and `tokenExpiresIn`

### Session Expiration Time

The session expires after a period of inactivity equal to `sessionExpiresIn`.
This is similar to "log out after X minutes of inactivity."
For example, with `sessionExpiresIn: 30 * 60 * 1000` (30 minutes), a user can remain logged in indefinitely by making requests at least every 29 minutes.

Expiration time will be extended both in the database `exp` and in the cookie `Expires`.

Your choice for session expiration time should balance security and user experience:

- Shorter session durations increase security but force users to log in more frequently
- Longer session durations improve user experience but increase the risk if credentials are stolen

### Token Expiration Time

The `tokenExpiresIn` value controls how frequently tokens are rotated when sessions are active.
When a token expires but the session is still valid, the system generates a new token.

Your choice for token expiration time affects:

- **Security vs. Storage Trade-off**: Shorter token expiration times help detect cookie theft faster but increase storage requirements
- **User Experience**: Excessively short token lifetimes may cause unexpected logouts if requests take longer than the token expiration time

For example, if `tokenExpiresIn` is set to 15 minutes, and a user is continuously active for 3 hours, the system will store 12 tokens for that session.

## Basic Usage

```js
import { login, logout, useSession } from "tiny-cookie-session";
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
      const userSession = await useSession(sessionConfig, { token });

      // Handle different session states
      if (userSession.state === "NotFound") {
        const bunCookie = new Bun.Cookie(
          "session",
          userSession.cookie.value,
          userSession.cookie.options,
        );
        return new Response("Not logged in", {
          status: 401,
          headers: { "Set-Cookie": bunCookie.serialize() },
        });
      } else if (userSession.state === "TokenStolen") {
        const bunCookie = new Bun.Cookie(
          "session",
          userSession.cookie.value,
          userSession.cookie.options,
        );
        return new Response("Session invalidated due to potential theft", {
          status: 401,
          headers: { "Set-Cookie": bunCookie.serialize() },
        });
      } else if (userSession.state === "Expired") {
        const bunCookie = new Bun.Cookie(
          "session",
          userSession.cookie.value,
          userSession.cookie.options,
        );
        return new Response("Session expired", {
          status: 401,
          headers: { "Set-Cookie": bunCookie.serialize() },
        });
      } else if (userSession.state === "TokenRotated") {
        // Set the new token in the response
        const bunCookie = new Bun.Cookie(
          "session",
          userSession.cookie.value,
          userSession.cookie.options,
        );
        return new Response(`Hello ${userSession.data.userId}`, {
          headers: { "Set-Cookie": bunCookie.serialize() },
        });
      } else if (userSession.state === "Active") {
        return new Response(`Hello ${userSession.data.userId}`);
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
const cookieStr = cookie.serialize(
  "session",
  sessionCookie.value,
  sessionCookie.options,
);
response.setHeader("Set-Cookie", cookieStr);

// When using a session
const cookies = cookie.parse(request.headers.cookie || "");
const token = cookies.session;
const userSession = await useSession(config, { token });
```

```js
// Using Bun.CookieMap and Bun.Cookie
// When logging in
const sessionCookie = await login(config, { id: sessionId, data: { userId } });
const bunCookie = new Bun.Cookie(
  "session",
  sessionCookie.value,
  sessionCookie.options,
);
response.headers.append("Set-Cookie", bunCookie.serialize());

// When using a session
const cookieHeader = request.headers.get("Cookie");
const token = new Bun.CookieMap(cookieHeader || "").get("session");
const userSession = await useSession(config, { token });
```

## Passing Custom Data

You can insert/select extra data associated with your session,
which is useful if your session table has non-nullable columns that must be provided when creating a session,
or you want to fetch a lot of data at once because you are using a latency sensitive database:

```js
// Configuration with different data types for insert and select
const sessionConfig = {
  // ... other config

  // Select includes user ID and auto-generated createdAt timestamp
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
      JOIN session_token t ON s.id = t.session_id
      WHERE t.hash = $tokenHash
    `,
      )
      .get({ tokenHash });

    // ... other logic

    return {
      // ... other session data
      data: {
        userId: session.userId,
        createdAt: new Date(session.createdAt),
      },
    };
  },

  // Insert only includes user ID, createdAt is auto-generated by SQLite
  insertSession: async ({ id, exp, tokenHash, tokenExp, data }) => {
    db.transaction(() => {
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

      // ... token insertion
    })();
  },
};

// Using login with just the userId
const userId = "user-123";
const sessionId = crypto.randomUUID();

const cookie = await login(sessionConfig, {
  id: sessionId,
  data: { userId },
});

// When using the session, we get both userId and createdAt
const userSession = await useSession(sessionConfig, { token });

if (userSession.state === "Active" || userSession.state === "TokenRotated") {
  console.log(`User ID: ${userSession.data.userId}`);
  console.log(`Session created at: ${userSession.data.createdAt}`); // Auto-generated by SQLite
}
```

## Garbage Collecting Expired Sessions

As sessions expire, they should be removed from your database to prevent it from growing indefinitely.
Since this library doesn't automatically delete expired sessions for inactive users, you'll need to implement your own garbage collection mechanism:

```js
function setupSessionGarbageCollection(db) {
  // Run garbage collection every hour
  setInterval(
    () => {
      const now = Date.now();

      // Delete all expired sessions
      const result = db
        .query(
          `
      DELETE FROM session
      WHERE expiration_time < $now
    `,
        )
        .run({ now });

      console.log(
        `Session garbage collection completed: ${result.changes} sessions deleted`,
      );
    },
    60 * 60 * 1000,
  ); // 1 hour
}
```

Garbage collecting expired sessions is always safe and has no security implications since those sessions would be rejected as "Expired" anyway if a user tried to use them.

## Limiting Stored Tokens

For long-lived sessions with frequent token rotation, you may want to limit the number of tokens stored per session:

```js
function setupTokenGarbageCollection(db) {
  // Run token garbage collection every day
  setInterval(
    () => {
      // Keep only the 100 most recent tokens for each session
      db.query(
        `
      DELETE FROM session_token
      WHERE rowid NOT IN (
        SELECT rowid FROM (
          SELECT rowid, session_id
          FROM session_token
          ORDER BY expiration_time DESC
        ) GROUP BY session_id HAVING COUNT(*) <= 100
      )
    `,
      ).run();

      console.log("Token garbage collection completed");
    },
    24 * 60 * 60 * 1000,
  ); // 24 hours
}
```

## "Log Out Other Devices" Feature

By implmenting a "log out other devices" feature,
you can enhance security by allowing users to manually invalidate unwanted sessions,
especially if you limit the number of stored tokens.

Consider following configurations:

- `tokenExpiresIn` = 10 minutes
- Token storage limit = 2016 tokens
- `sessionExpiresIn` = 10 minutes × 2016 = 20,160 minutes (14 days)

Note that since the cookie's `Expires` attribute has the same value as `exp` stored in the database,
it will get deleted from the browser after 14 days of inactivity.

If the user is inactive for less than 14 days,
this library will detect cookie theft as usual then logs out both the user and the attacker.

If the user is inactive for more than 14 days, the cookie will be deleted from the browser.
When they logs back in, we can show a "log out other devices" option.
Then the user can manually inspect the list of devices and log out any suspicious ones.

Although obviously, this would be less automated and less secure than the first scenario.

Also you need to carefully design when the "log out other devices" option should be shown to the user.
Otherwise, the attacker could use the "log out other devices" option to log out the user.

Note that in both scenarios, the attacker was able to use the stolen token (valid session) while the user was inactive.

## Force Logout Sessions

This library allows you to immediately invalidate sessions by deleting them from the storage backend:

```js
// Force logout a specific user
async function forceLogout(userId) {
  db.query(
    `
    DELETE FROM session
    WHERE user_id = $userId
  `,
  ).run({ userId });
}

// Force logout all users (useful for security incidents)
async function forceLogoutAll() {
  db.query(`DELETE FROM session`).run();
}
```

## Enhanced Security with Service Workers

You can further improve security by implementing a service worker that continuously rotates the session token in the background.
This reduces the window of opportunity for an attacker using a stolen token,
as the user's browser will constantly rotate tokens even when the page is closed.
Although, of course you need to consider the cost of constantly rotating tokens.

## Cookie Theft Detection

This library implements a cookie theft detection mechanism based on token rotation.

### How the Detection Works

We detect cookie theft when there's a request with a token that is associated with a valid session but is not one of the two most recently issued tokens for that session.

The system stores all tokens that have ever been issued for a session (unless you implement token garbage collection).
When a token is used, the system checks if it's one of the two most recent tokens:

- If it is, the request is considered (either the current or immediately previous token)
- If not, the system concludes the token was stolen and invalidates the entire session

Only either the user or the attacker can have the latest token at any given time.
If a non-latest token is used, it means someone is using an old token - either the user or an attacker.

See [index.test.js](./index.test.js) for detailed tests of the cookie theft detection mechanism.

When cookie theft is detected, the entire session is invalidated,
forcing both the user and the attacker to re-authenticate.

This library can detect cookie theft after it has occurred and limit the attacker's window of opportunity.

### Handling Race Conditions

To prevent users from being accidentally logged out during concurrent requests,
we consider both the current and previous token to be valid.

This handles cases like:

- User loads a page (using token A)
- First request from that page causes token rotation (token A → token B)
- Second request still uses token A (concurrent with the first request)

Without keeping the previous token valid, the second request would be incorrectly flagged as theft.

## Device Bound Session Credentials

Device Bound Session Credentials (DBSC) is a standard that cryptographically binds cookies to specific devices using secure hardware.

For more information about DBSC, see:

- [Fighting Cookie Theft using Device-Bound Session Credentials](https://blog.chromium.org/2024/04/fighting-cookie-theft-using-device.html)
- [Device-Bound Session Credentials Documentation](https://developer.chrome.com/docs/web-platform/device-bound-session-credentials)

### tiny-cookie-session vs DBSC

| Feature                    | tiny-cookie-session                           | DBSC                                                 |
| -------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| **Theft response**         | Invalidates all sessions (user + attacker)    | Only invalidates the attacker's session              |
| **Storage requirements**   | Stores token history                          | Single token storage                                 |
| **Hardware requirements**  | Works on any device                           | Requires secure hardware (TPM/SE)                    |
| **Implementation**         | Single authentication flow                    | Requires challenge-response flow                     |
| **Browser support**        | Universal                                     | Chrome-only (currently)                              |
| **Theft detection timing** | Requires both user and attacker to use tokens | Invalidates stolen tokens automatically when expired |

Key differences in security model:

- tiny-cookie-session will invalidate both the attacker and the user on cookie theft since there is no way to know which one is the valid user.
- DBSC will only invalidate the attacker, since only the valid user can finish the cryptographic challenge.
- tiny-cookie-session requires both the user and the attacker to use the token first to detect and invalidate the session.
- DBSC will invalidate the session as soon as the stolen token is expired, even if it was just stolen.

While DBSC provides superior security when available,
tiny-cookie-session provides cookie theft detection across all platforms and browsers.

For applications requiring maximum security across diverse client environments,
using tiny-cookie-session as a fallback when DBSC isn't available offers the best of both approaches.

## Session Token Security

This library uses 256 bits of entropy for session tokens, exceeding industry recommendations:

- OWASP recommends at least 64 bits of entropy ([OWASP Guidelines](https://owasp.org/www-community/vulnerabilities/Insufficient_Session-ID_Length))
- Remix uses 64 bits of entropy ([Remix Source](https://github.com/remix-run/remix/blob/b7d280140b27507530bcd66f7b30abe3e9d76436/packages/remix-node/sessions/fileStorage.ts#L45))
- Lucia uses 160 bits of entropy in their SQLite example ([Lucia Source](https://github.com/lucia-auth/lucia/blob/46b164f78dc7983d7a4c3fb184505a01a4939efd/pages/sessions/basic-api/sqlite.md?plain=1#L88))
- Auth.js uses 256 bits of entropy in their tests ([Auth.js Source](https://github.com/nextauthjs/next-auth/blob/c5a70d383bb97b39f8edbbaf69c4c7620246e9a4/packages/core/test/actions/session.test.ts#L146))

Since the token itself is already a random string with high entropy (unlike a password), we don't need additional processing like salting or peppering.

Doing SHA-256 for every request might seem like a lot, but it's not any more taxing than doing cookie signing, which is a common practice in web services.

## CSRF Protection

This library focuses solely on session management and does not implement CSRF protection.
You should implement CSRF protection for the whole application and before using any functions from this library.

## Signed Cookies

This library doesn't sign cookies directly.
The main benefit of signed cookies is preventing cookie tampering without reaching the storage backend,
but this isn't essentially required for this library to work or to provide security.

You can implement cookie signing as an additional layer in your application if desired:

```js
// Example of adding cookie signing (pseudocode)
const signedValue = sign(cookie.value, SECRET_KEY);
const bunCookie = new Bun.Cookie("session", signedValue, cookie.options);

// When verifying
const signedToken = cookieMap.get("session");
const token = verify(signedToken, SECRET_KEY);
if (!token) return new Response("Invalid cookie", { status: 401 });
```

## Security Limitations

While tiny-cookie-session provides cookie theft detection, be aware of these limitations:

1. An attacker can use a stolen cookie until the user accesses the system again
2. If the user never logs back in, the attacker's session may remain active
3. Constant theft (e.g., via persistent background malware) can't be prevented by any cookie-based mechanism

## Delete cookie after browser close

To create session cookies that are removed when the browser closes (equivalent to when "Remember me" is not checked), remove the expiration attributes:

```js
// When logging in
const cookie = await login(config, {
  id: sessionId,
  data: { userId },
});

// Remove expires/maxAge to make it a session cookie
const options = { ...cookie.options };
delete options.expires;
delete options.maxAge;
const bunCookie = new Bun.Cookie("session", cookie.value, options);

// When rotating token
if (userSession.state === "TokenRotated") {
  const options = { ...userSession.cookie.options };
  delete options.expires;
  delete options.maxAge;
  const bunCookie = new Bun.Cookie(
    "session",
    userSession.cookie.value,
    options,
  );

  return new Response("Success", {
    headers: { "Set-Cookie": bunCookie.serialize() },
  });
}
```

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

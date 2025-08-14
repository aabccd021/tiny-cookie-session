# tiny-cookie-session

**tiny-cookie-session** is a tiny cookie-based session management library with cookie theft mitigation.

## Installation

```sh
pnpm install tiny-cookie-session@github:aabccd021/tiny-cookie-session
yarn add tiny-cookie-session@github:aabccd021/tiny-cookie-session
bun install tiny-cookie-session@github:aabccd021/tiny-cookie-session
```

## Configuration

This library requires a storage adapter configuration that implements four core functions: `selectSession`, `insertSession`, `updateSession`, and `deleteSession`.
You can connect to any database or storage system by implementing these functions according to your needs.

### Bun SQLite Configuration

```js
import { Database } from "bun:sqlite";
import { login, logout, consumeSession, testConfig } from "tiny-cookie-session";

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

    return {
      id: session.id,
      exp: new Date(session.expirationTime),
      tokenExp: new Date(session.expirationTime),
      latestTokenHash: [tokens[0]?.hash, tokens[1]?.hash],
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

### In-Memory Store Configuration

```js
import { login, logout, consumeSession, testConfig } from "tiny-cookie-session";

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
          latestTokenHash: [latestTokenHash1, latestTokenHash2],
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

This function tests your implementation by simulating session operations like insertion, token rotation, and deletion.
Provide multiple test sessions with unique IDs to ensure your implementation handles various scenarios correctly.
Note that failed tests may leave data in your storage, so avoid running this in production.

## How to decide `sessionExpiresIn`

The session expires after a period of inactivity equal to `sessionExpiresIn`.
This is similar to "log out after X minutes of inactivity."
For example, with `sessionExpiresIn: 30 * 60 * 1000` (30 minutes), a user can remain logged in indefinitely by making requests at least every 29 minutes.

## How to decide `tokenExpiresIn`

The `tokenExpiresIn` value controls how frequently tokens rotate when sessions are active.
When a token expires but the session is still valid, the system generates a new token.

Shorter token expiration times:

- Detect cookie theft faster
- Increase storage requirements for token history
- May cause unexpected logouts if requests take longer than the expiration time

A typical value is 10-15 minutes, balancing security and user experience.

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

      // Consume the session
      const userSession = await consumeSession(sessionConfig, { token });

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
      } else if (userSession.state === "TokenRefreshed") {
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
// Using Bun.CookieMap and Bun.Cookie
// When logging in
const sessionCookie = await login(config, { id: sessionId, data: { userId } });
const bunCookie = new Bun.Cookie(
  "session",
  sessionCookie.value,
  sessionCookie.options,
);
response.headers.append("Set-Cookie", bunCookie.serialize());

// When consuming a session
const cookieHeader = request.headers.get("Cookie");
const token = new Bun.CookieMap(cookieHeader || "").get("session");
const userSession = await consumeSession(config, { token });
```

## Passing Custom Data

You can use different data structures for session insertion and selection, allowing for flexible storage patterns:

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

// When consuming the session, we get both userId and createdAt
const userSession = await consumeSession(sessionConfig, { token });

if (userSession.state === "Active" || userSession.state === "TokenRefreshed") {
  console.log(`User ID: ${userSession.data.userId}`);
  console.log(`Session created at: ${userSession.data.createdAt}`); // Auto-generated by SQLite
}
```

## Garbage Collecting Expired Sessions

Implement a scheduled task to remove expired sessions from your database:

```js
function setupSessionGarbageCollection(db) {
  // Run garbage collection every hour
  setInterval(
    () => {
      const now = Date.now();

      // Delete all expired sessions
      db.query(
        `
      DELETE FROM session
      WHERE expiration_time < $now
    `,
      ).run({ now });

      console.log("Session garbage collection completed");
    },
    60 * 60 * 1000,
  ); // 1 hour
}

// Initialize garbage collection
setupSessionGarbageCollection(db);
```

## Force Logout Sessions

Unlike JWT, where tokens remain valid until they expire, this library allows you to immediately invalidate sessions:

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

## Cookie Theft Mitigation

This library implements an advanced cookie theft detection mechanism based on token rotation and history tracking.

### How the Detection Works

1. **Token Rotation**: Each session has a token that expires quickly (e.g., every 10 minutes), even though the overall session lasts longer (e.g., 5 hours).
2. **Token History**: When a token is refreshed, we keep track of both the new and previous tokens.
3. **Theft Detection Logic**: We monitor token usage patterns:
   - If the two most recent tokens are being used from different locations/browsers, we detect this as potential theft.
   - When detected, we invalidate the entire session, forcing both the legitimate user and the attacker to re-authenticate.

### Real-World Example

Consider this scenario:

1. Alice logs in from her computer, receiving token A.
2. The token is refreshed during normal usage, giving Alice token B.
3. Mallory (attacker) somehow steals token A from Alice's computer.
4. Alice continues using the application with token B, getting a new token C when B expires.
5. Mallory attempts to use the stolen token A.
6. The system detects that token A is being used while newer tokens (B and C) have been issued.
7. The system immediately invalidates the entire session.
8. Both Alice and Mallory are logged out and must re-authenticate.

This approach prevents attackers from using stolen session cookies, even if they manage to steal them through methods like XSS, malware, or physical access to devices.

### Handling Race Conditions

To prevent legitimate users from being accidentally logged out during concurrent requests, we allow both the current and previous token to be valid simultaneously. This handles cases like:

1. User loads a page (using token A)
2. First API request from that page causes token rotation (token A → token B)
3. Second API request still uses token A (concurrent with the first request)

Without keeping the previous token valid, the second request would be incorrectly flagged as theft.

## Device Bound Session Credentials

Device Bound Session Credentials (DBSC) is an emerging standard developed by Google that cryptographically binds cookies to specific devices using secure hardware.

For more information about DBSC, see:

- [Fighting Cookie Theft using Device-Bound Session Credentials](https://blog.chromium.org/2024/04/fighting-cookie-theft-using-device.html)
- [Device-Bound Session Credentials Documentation](https://developer.chrome.com/docs/web-platform/device-bound-session-credentials)

### tiny-cookie-session vs DBSC

| Feature                   | tiny-cookie-session                        | DBSC                                    |
| ------------------------- | ------------------------------------------ | --------------------------------------- |
| **Theft response**        | Invalidates all sessions (user + attacker) | Only invalidates the attacker's session |
| **Storage requirements**  | Stores token history                       | Single token storage                    |
| **Hardware requirements** | Works on any device                        | Requires secure hardware (TPM/SE)       |
| **Implementation**        | Single authentication flow                 | Requires challenge-response flow        |
| **Browser support**       | Universal                                  | Chrome-only (currently)                 |

tiny-cookie-session provides strong security across all platforms and browsers, while DBSC offers even stronger protection but requires specific hardware and browser support.

### Using tiny-cookie-session with DBSC

If your application supports devices with DBSC capabilities, you can implement both systems for maximum security:

- Use tiny-cookie-session as your baseline authentication system
- Add DBSC as an enhancement for supported browsers/devices

This provides universal compatibility while leveraging the additional security of DBSC where available.

## Session Token Security

This library uses 256 bits of entropy for session tokens, exceeding industry recommendations:

- OWASP recommends at least 64 bits of entropy ([OWASP Guidelines](https://owasp.org/www-community/vulnerabilities/Insufficient_Session-ID_Length))
- Remix uses 64 bits
- Lucia uses 160 bits
- Auth.js uses 256 bits

The high entropy ensures that tokens cannot be brute-forced, and the token hashing provides additional protection if the database is compromised.

## CSRF Protection

This library focuses solely on session management and does not implement CSRF protection.
Implement CSRF protection at the application level before processing session data.

## Signed Cookies

While this library doesn't sign cookies directly, you can implement cookie signing as an additional layer in your application:

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

While tiny-cookie-session provides robust protection against cookie theft, be aware of these limitations:

1. An attacker can use a stolen cookie until the legitimate user accesses the system again
2. If the legitimate user never logs back in, the attacker's session may remain active
3. Constant theft (e.g., via persistent malware) can't be prevented by any cookie-based mechanism

For the highest level of security, combine this library with:

- Short session expiration times
- Regular re-authentication for sensitive operations
- HTTPS for all connections
- Content Security Policy to prevent XSS

## Delete cookie after browser close

To create session cookies that are removed when the browser closes (rather than persistent cookies), remove the expiration attributes:

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

// When refreshing token
if (userSession.state === "TokenRefreshed") {
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

```

```

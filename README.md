# tiny-cookie-session

**tiny-cookie-session** is a lightweight cookie session library with cookie theft mitigation for
JavaScript and TypeScript. This library helps you manage user sessions securely while protecting
against cookie theft attacks. It uses short-lived tokens that rotate frequently to detect
unauthorized access attempts.

## Installation

```sh
pnpm install tiny-cookie-session@github:aabccd021/tiny-cookie-session
yarn add tiny-cookie-session@github:aabccd021/tiny-cookie-session
bun install tiny-cookie-session@github:aabccd021/tiny-cookie-session
```

## Creating a configuration

Before using this library, you need to create a configuration object. This configuration includes
all the necessary parameters for managing sessions including the storage backend, expiration time,
and token refresh interval. This library doesn't include any adapter for a storage backend. You need
to provide your own storage implementation in the configuration object.

### Bun SQLite Configuration

```js
import { Database } from "bun:sqlite";
import * as session from "tiny-cookie-session";

// Create and initialize your database
const db = new Database("sessions.db");
db.run(`
  CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,
    expiration_time INTEGER NOT NULL,
    user_id TEXT NOT NULL
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
    const session = db.query(`
      SELECT 
        s.id, 
        s.expiration_time as expirationTime, 
        s.user_id as userId
      FROM session s
      JOIN session_token t ON s.id = t.session_id
      WHERE t.hash = $tokenHash
    `).get({ tokenHash });
    
    if (!session) return undefined;
    
    // Get the two most recent tokens for this session
    const tokens = db.query(`
      SELECT hash
      FROM session_token
      WHERE session_id = $sessionId
      ORDER BY expiration_time DESC
      LIMIT 2
    `).all({ sessionId: session.id });
    
    if (!tokens.length) return undefined;
    
    return {
      id: session.id,
      exp: new Date(Number(session.expirationTime)),
      tokenExp: new Date(Number(session.expirationTime)),
      latestTokenHash: [tokens[0]?.hash, tokens[1]?.hash],
      data: {
        userId: session.userId
      }
    };
  },
  
  insertSession: async ({ id, exp, tokenHash, tokenExp, data }) => {
    db.query(`
      INSERT INTO session (id, expiration_time, user_id)
      VALUES ($id, $exp, $userId)
    `).run({
      id,
      exp: exp.getTime(),
      userId: data.userId
    });
    
    db.query(`
      INSERT INTO session_token (session_id, hash, expiration_time)
      VALUES ($sessionId, $tokenHash, $tokenExp)
    `).run({
      sessionId: id,
      tokenHash,
      tokenExp: tokenExp.getTime()
    });
  },
  
  updateSession: async ({ id, exp, tokenExp, tokenHash }) => {
    db.query(`
      INSERT INTO session_token (session_id, hash, expiration_time)
      VALUES ($sessionId, $tokenHash, $tokenExp)
    `).run({
      sessionId: id,
      tokenHash,
      tokenExp: tokenExp.getTime()
    });
    
    db.query(`
      UPDATE session
      SET expiration_time = $exp
      WHERE id = $id
    `).run({
      id,
      exp: exp.getTime()
    });
  },
  
  deleteSession: async ({ tokenHash }) => {
    db.query(`
      DELETE FROM session
      WHERE id IN (
        SELECT session_id
        FROM session_token
        WHERE hash = $tokenHash
      )
    `).run({ tokenHash });
  }
};
```

### In-Memory Store Configuration

```js
import * as session from "tiny-cookie-session";

// Create a simple in-memory store
const sessions = {};

const config = {
  dateNow: () => new Date(),
  sessionExpiresIn: 5 * 60 * 60 * 1000, // 5 hours
  tokenExpiresIn: 10 * 60 * 1000, // 10 minutes
  
  selectSession: async ({ tokenHash }) => {
    for (const [id, session] of Object.entries(sessions)) {
      const [latestTokenHash1, latestTokenHash2] = session.tokenHashes.toReversed();
      if (latestTokenHash1 !== undefined && session.tokenHashes.includes(tokenHash)) {
        return {
          id,
          latestTokenHash: [latestTokenHash1, latestTokenHash2],
          exp: session.exp,
          tokenExp: session.tokenExp,
          data: {
            userId: session.userId
          }
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
      userId: data.userId
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
      session.tokenHashes.includes(tokenHash)
    );
    if (!sessionEntry) throw new Error("Session not found");
    
    const [id] = sessionEntry;
    delete sessions[id];
  }
};
```

## Testing Configuration

After implementing your own storage backend, you can use the testing configuration to test your
implementation with the `testConfig` function. This function tests your implementation by simulating
various session operations and checking that they work correctly.

```js
import { testConfig } from "tiny-cookie-session";

// Test the configuration with various user IDs
await testConfig(config, [
  {
    id: crypto.randomUUID(),
    data: { userId: "user-1" }
  },
  {
    id: crypto.randomUUID(),
    data: { userId: "user-2" }
  }
]);
```

Note that this function might leave some data in the storage backend when failing. We don't
recommend running it in production. The more variations you provide, the more robust your
implementation will be against edge cases. Make sure the session IDs are unique.

## How to decide `sessionExpiresIn`

The session is considered expired when the current time is greater than the last time the token was
refreshed plus the `sessionExpiresIn` value. Essentially, this is equivalent to "log out after X
minutes of inactivity". For example, if you set `sessionExpiresIn` to 30 minutes, you can
indefinitely use the session by consuming it every 29 minutes.

## How to decide `tokenExpiresIn`

The token is considered expired when the current time is greater than the last time the token was
refreshed plus the `tokenExpiresIn` value. The token will be refreshed if the token is expired, but
the session is not expired.

Making this value shorter means:

- The cookie theft will be detected faster.
- More tokens need to be stored in the storage backend.

For extreme cases where you set this to a very short value, like 10 seconds, it might unexpectedly
log out the user while they are doing something valid but the request is taking longer than 10
seconds to complete.

## Basic Usage

```js
import * as session from "tiny-cookie-session";
import { serve } from "bun";

// Initialize your session config (see previous examples)
const sessionConfig = { /* your session config */ };

// Login example
serve({
  port: 3000,
  async fetch(request) {
    if (request.url.endsWith("/login")) {
      // Create a new session
      const userId = "user-123"; // From your authentication system
      const sessionId = crypto.randomUUID();
      
      const cookie = await session.login(sessionConfig, {
        id: sessionId,
        data: { userId }
      });
      
      // Create a cookie using Bun's built-in Cookie API
      const bunCookie = new Bun.Cookie("session", cookie.value, cookie.options);
      
      return new Response("Logged in successfully", {
        headers: { "Set-Cookie": bunCookie.serialize() }
      });
    }
    
    // Rest of your server logic
    return new Response("Not found", { status: 404 });
  }
});

// Logout example
serve({
  port: 3000,
  async fetch(request) {
    if (request.url.endsWith("/logout")) {
      const cookieHeader = request.headers.get("Cookie");
      if (!cookieHeader) return new Response("Not logged in", { status: 401 });
      
      const token = new Bun.CookieMap(cookieHeader).get("session");
      if (!token) return new Response("Not logged in", { status: 401 });
      
      const cookie = await session.logout(sessionConfig, { token });
      const bunCookie = new Bun.Cookie("session", cookie.value, cookie.options);
      
      return new Response("Logged out successfully", {
        headers: { "Set-Cookie": bunCookie.serialize() }
      });
    }
    
    // Rest of your server logic
    return new Response("Not found", { status: 404 });
  }
});

// Consume session example
serve({
  port: 3000,
  async fetch(request) {
    // Get the token from the request cookie
    const cookieHeader = request.headers.get("Cookie");
    if (!cookieHeader) return new Response("Not logged in", { status: 401 });
    
    const token = new Bun.CookieMap(cookieHeader).get("session");
    if (!token) return new Response("Not logged in", { status: 401 });
    
    // Consume the session
    const userSession = await session.consumeSession(sessionConfig, { token });
    
    // Handle different session states
    if (userSession.state === "NotFound") {
      const bunCookie = new Bun.Cookie("session", userSession.cookie.value, userSession.cookie.options);
      return new Response("Not logged in", { 
        status: 401,
        headers: { "Set-Cookie": bunCookie.serialize() }
      });
    } else if (userSession.state === "TokenStolen") {
      const bunCookie = new Bun.Cookie("session", userSession.cookie.value, userSession.cookie.options);
      return new Response("Session invalidated due to potential theft", { 
        status: 401,
        headers: { "Set-Cookie": bunCookie.serialize() }
      });
    } else if (userSession.state === "Expired") {
      const bunCookie = new Bun.Cookie("session", userSession.cookie.value, userSession.cookie.options);
      return new Response("Session expired", { 
        status: 401,
        headers: { "Set-Cookie": bunCookie.serialize() }
      });
    } else if (userSession.state === "TokenRefreshed") {
      // Set the new token in the response
      const bunCookie = new Bun.Cookie("session", userSession.cookie.value, userSession.cookie.options);
      return new Response(`Hello ${userSession.data.userId}`, {
        headers: { "Set-Cookie": bunCookie.serialize() }
      });
    } else if (userSession.state === "Active") {
      return new Response(`Hello ${userSession.data.userId}`);
    }
  }
});
```

## Cookie Parsing/Serializing

This library doesn't parse or serialize cookies. You need to use your own cookie parsing/serializing
library. Below are examples of how to use this library with different cookie libraries.

```js
// Using the `cookie` library
import cookie from "cookie";

// When logging in
const sessionCookie = await session.login(config, { id: sessionId, data: { userId } });
const cookieStr = cookie.serialize("session", sessionCookie.value, sessionCookie.options);
response.setHeader("Set-Cookie", cookieStr);

// When consuming a session
const cookies = cookie.parse(request.headers.cookie || "");
const token = cookies.session;
const userSession = await session.consumeSession(config, { token });
```

```js
// Using Bun.CookieMap and Bun.Cookie
// When logging in
const sessionCookie = await session.login(config, { id: sessionId, data: { userId } });
const bunCookie = new Bun.Cookie("session", sessionCookie.value, sessionCookie.options);
response.headers.append("Set-Cookie", bunCookie.serialize());

// When consuming a session
const cookieHeader = request.headers.get("Cookie");
const token = new Bun.CookieMap(cookieHeader || "").get("session");
const userSession = await session.consumeSession(config, { token });
```

## Passing Custom Data

You can pass custom data when using `login` and `consumeSession` functions. This is useful if you
have a SQL table for session and have non-nullable columns for that custom data.

```js
// Define different types for insert and select data
// Configuration with custom data
const sessionConfig = {
  // ... other config
  
  // Custom data for selecting sessions
  selectSession: async ({ tokenHash }) => {
    const session = db.query(`
      SELECT 
        s.id, 
        s.expiration_time as expirationTime, 
        s.user_id as userId,
        s.created_at as createdAt
      FROM session s
      JOIN session_token t ON s.id = t.session_id
      WHERE t.hash = $tokenHash
    `).get({ tokenHash });
    
    // ... other logic
    
    return {
      // ... other session data
      data: {
        userId: session.userId,
        createdAt: new Date(session.createdAt)
      }
    };
  },
  
  // Custom data for inserting sessions
  insertSession: async ({ id, exp, tokenHash, tokenExp, data }) => {
    db.query(`
      INSERT INTO session (id, expiration_time, user_id, created_at)
      VALUES ($id, $exp, $userId, $createdAt)
    `).run({
      id,
      exp: exp.getTime(),
      userId: data.userId,
      createdAt: data.createdAt.getTime()
    });
    
    // ... token insertion
  },
};

// Using custom data with login
const userId = "user-123";
const sessionId = crypto.randomUUID();

const cookie = await session.login(sessionConfig, {
  id: sessionId,
  data: {
    userId,
    createdAt: new Date() // Custom field for created timestamp
  }
});

// Using custom data with consumeSession
const userSession = await session.consumeSession(sessionConfig, { token });

if (userSession.state === "Active" || userSession.state === "TokenRefreshed") {
  console.log(`User ID: ${userSession.data.userId}`);
  console.log(`Session created at: ${userSession.data.createdAt}`);
}
```

## Garbage Collecting Expired Sessions

While the session will be deleted when a user logs out, or a user consumes the session after it
expires, this library doesn't automatically delete expired sessions of inactive users. You need to
implement your own garbage collection mechanism to delete expired sessions.

```js
// Bun SQLite example for garbage collection
function setupSessionGarbageCollection(db) {
  // Run garbage collection every hour
  setInterval(() => {
    const now = Date.now();
    
    // Delete all expired sessions
    db.query(`
      DELETE FROM session
      WHERE expiration_time < $now
    `).run({ now });
    
    console.log("Session garbage collection completed");
  }, 60 * 60 * 1000); // 1 hour
}

// Initialize garbage collection
setupSessionGarbageCollection(db);
```

## Force logout the session

This library allows you to force logout a session, which will take effect immediately, unlike JWT.
Simply delete the session from the storage backend. The next time they consume the session, it will
show `NotFound`.

```js
// Force logout a specific user
async function forceLogout(userId) {
  // Delete all sessions for this user
  db.query(`
    DELETE FROM session
    WHERE user_id = $userId
  `).run({ userId });
}

// Force logout all users
async function forceLogoutAll() {
  db.query(`DELETE FROM session`).run();
}
```

## Cookie Theft Mitigation

This library mitigates cookie theft by logging out both the attacker and the user when theft is
detected.

### Detecting Cookie Theft

- A session is identified by a short-lived token.
- When the token is refreshed, a new token is generated once and set in the browser, while the old
  token is kept in the database.
- When someone uses the old token, it's either the user or an attacker.
- If multiple tokens from the same session are used from different locations/devices, the library
  detects this as cookie theft.

### Handling Race Conditions

When discussing cookie theft detection, we said that only the latest token will be marked as valid.
However, we actually mark **two** latest tokens as valid to prevent race conditions.

While using just the latest token to identify a session would be enough to detect cookie theft, we
use the two latest tokens to handle race conditions where a user might make multiple requests at the
same time.

Here's an example that shows a scenario where the user would be logged out for a valid request if we
only used the latest token:

1. Client sends request "lorem" with `cookie: token=old_token` (Valid token).
2. Server creates token `new_token` in database. Now it's the latest token.
3. Client sends request "ipsum" with `cookie: token=old_token` (Invalid token if we only checked the
   latest).
4. Server sends response "lorem" with `set-cookie: token=new_token`.
5. Client sends request "dolor" with `cookie: token=new_token` (Valid token).

The above example may be easier to imagine if you think of the user uploading a large file in step
1, and doing something else in another browser tab in step 3.

## Device Bound Session Credentials

Device Bound Session Credentials (DBSC) is a new technology developed by Google to bind
authentication cookies to a specific device using hardware-backed cryptography. It aims to prevent
cookie theft by making the stolen cookies unusable on different devices. For more information, see:

- [Fighting Cookie Theft using Device-Bound Session Credentials](https://blog.chromium.org/2024/04/fighting-cookie-theft-using-device.html)
- [Device-Bound Session Credentials Documentation](https://developer.chrome.com/docs/web-platform/device-bound-session-credentials)

### tiny-cookie-session vs DBSC

Here's how tiny-cookie-session compares to DBSC:

| Feature | tiny-cookie-session | DBSC | |---------|---------------------|------| | **Invalidation
on theft** | Invalidates both attacker and user sessions | Only invalidates attacker's session | |
**Token storage** | Requires storing all past tokens of active sessions | Only needs to store a
single token | | **Client requirements** | No special hardware required | Requires secure storage
(TPM/SE) for private key | | **Implementation complexity** | Simple integration with existing
endpoints | Requires additional endpoints for token creation/updating | | **Browser support** | All
browsers | Only Chrome (as of 2025) |

tiny-cookie-session will invalidate both the attacker and the user on cookie theft since there is no
way to know which one is the valid user. DBSC will only invalidate the attacker, since only the
valid user can finish the cryptographic challenge.

tiny-cookie-session requires storing all past tokens of an active session. This is the only way we
can know whether the cookie is "not existing/random" or "old token of a valid session" (stolen).
DBSC only needs to store a single token.

tiny-cookie-session doesn't rely on client devices to have secure storage such as TPM. DBSC relies
on clients having secure storage to store a private key used to finish the challenge.

tiny-cookie-session doesn't require additional endpoints for creating/updating a token. DBSC
requires additional endpoints for creating/updating tokens.

### Using tiny-cookie-session with DBSC

If the device supports DBSC, you can integrate it with tiny-cookie-session. When refreshing a token,
you can bind it to the device using DBSC, which provides an additional layer of security.

Since DBSC is a relatively new standard and not yet widely supported, it's best to implement
tiny-cookie-session first and then enhance it with DBSC as browser support improves.

## Session Token

This library uses 256 bits of entropy for session tokens. This provides strong security against
brute force attacks.

Some reference points on token entropy:

- Remix uses 64 bits of entropy:
  [Remix Source](https://github.com/remix-run/remix/blob/b7d280140b27507530bcd66f7b30abe3e9d76436/packages/remix-node/sessions/fileStorage.ts#L45)
- OWASP recommends at least 64 bits of entropy:
  [OWASP Guidelines](https://owasp.org/www-community/vulnerabilities/Insufficient_Session-ID_Length)
- Lucia uses 160 bits of entropy in their SQLite example:
  [Lucia Source](https://github.com/lucia-auth/lucia/blob/46b164f78dc7983d7a4c3fb184505a01a4939efd/pages/sessions/basic-api/sqlite.md?plain=1#L88)
- Auth.js uses 256 bits of entropy in their tests:
  [Auth.js Source](https://github.com/nextauthjs/next-auth/blob/c5a70d383bb97b39f8edbbaf69c4c7620246e9a4/packages/core/test/actions/session.test.ts#L146)

When the database is compromised, the attacker can't just use any data in the database to hijack the
session. Since the token itself is already a random string with high entropy (unlike a password), we
don't need additional processing like salting, stretching, or peppering.

Doing SHA-256 for every request might seem like a lot, but it's not any more taxing than doing
cookie signing, which is a common practice in web services.

Also,
[we don't have to use `crypto.timingSafeEqual` when comparing tokens because we are comparing hashes of high entropy tokens](https://security.stackexchange.com/questions/237116/using-timingsafeequal#comment521092_237133).

## CSRF

This library doesn't provide CSRF protection. You need to handle CSRF protection yourself for your
entire application, before reaching the session management layer.

## Signed Cookies

This library doesn't sign cookies. The biggest benefit of signed cookies is that they prevent cookie
tampering without reaching the storage backend. While it's still useful, it's not essentially
required for this library to work.

This library doesn't prevent you from implementing signed cookies. You can sign/unsign cookies
before/after using this library.

## Your Cookie is still not 100% safe

While this library can mitigate cookie theft by logging out both the attacker and the user when
theft is detected, it doesn't prevent cookie theft in the first place. The attacker can still use
the stolen cookie until the user logs in again. If a user never logs in again after the theft, the
attacker can still use the stolen cookie indefinitely.

Also, this library would become essentially useless if the cookie is being constantly stolen by a
malicious background process. No software mechanism in the world can prevent that, including DBSC.

## Delete cookie after browser close

To make your session cookie get deleted when the browser is closed (equivalent to when "remember me"
is not checked), you can remove the `expires` and `maxAge` attributes from the cookie:

````js
// When logging in
const cookie = await session.login(config, {
  id: sessionId,
  data: { userId }
});

// Remove expires/maxAge to make it a session cookie (deleted when browser closes)
const options = { ...cookie.options };
delete options.expires;
delete options.maxAge;
const bunCookie = new Bun.Cookie("session", cookie.value, options);

// When refreshing token
if (userSession.state === "TokenRefreshed") {
  const options = { ...userSession.cookie.options };
  delete options.expires;
  delete options.maxAge;
  const bunCookie = new Bun.Cookie("session", userSession.cookie.value, options);
  
  return new Response("Success", {
    headers: { "Set-Cookie": bunCookie.serialize() }
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
````

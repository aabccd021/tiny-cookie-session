# tiny-cookie-session

**tiny-cookie-session** is a cookie session library with cookie theft mitigation for JavaScript and
TypeScript.

## Installation

```sh
pnpm install tiny-cookie-session@github:aabccd021/tiny-cookie-session
yarn add tiny-cookie-session@github:aabccd021/tiny-cookie-session
bun install tiny-cookie-session@github:aabccd021/tiny-cookie-session
```

## Creating a configuration

Before using this library, you need to create a configuration object, which includes all the
necessary parameters for managing sessions including the storage backend, expiration time, and
refresh interval. This library doesn't include any adapter for a storage backend, so you need to
provide your own storage implementation in the configuration object.

### Bun SQLite Configuration

```js
import { Database } from "bun:sqlite";

const db = new Database("sessions.db");

// Create sessions table if it doesn't exist
db.run(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    second_token_hash TEXT,
    exp INTEGER NOT NULL,
    token_exp INTEGER NOT NULL,
    user_id TEXT NOT NULL
  )
`);

// Create token hash index for faster lookups
db.run(`CREATE INDEX IF NOT EXISTS idx_token_hash ON sessions (token_hash)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_second_token_hash ON sessions (second_token_hash)`);

const config = {
  dateNow: () => new Date(),
  tokenExpiresIn: 10 * 60 * 1000, // 10 minutes
  sessionExpiresIn: 5 * 60 * 60 * 1000, // 5 hours

  selectSession: async ({ tokenHash }) => {
    const session = db.query(`
      SELECT id, token_hash, second_token_hash, exp, token_exp, user_id
      FROM sessions
      WHERE token_hash = ? OR second_token_hash = ?
    `).get(tokenHash, tokenHash);

    if (!session) return undefined;

    return {
      id: session.id,
      latestTokenHash: [session.token_hash, session.second_token_hash],
      exp: new Date(session.exp),
      tokenExp: new Date(session.token_exp),
      data: {
        userId: session.user_id
      },
    };
  },

  insertSession: async ({ id, tokenHash, exp, tokenExp, data }) => {
    db.run(`
      INSERT INTO sessions (id, token_hash, exp, token_exp, user_id)
      VALUES (?, ?, ?, ?, ?)
    `, id, tokenHash, exp.getTime(), tokenExp.getTime(), data.userId);
  },

  updateSession: async ({ id, tokenHash, exp, tokenExp }) => {
    db.run(`
      UPDATE sessions
      SET second_token_hash = token_hash,
          token_hash = ?,
          exp = ?,
          token_exp = ?
      WHERE id = ?
    `, tokenHash, exp.getTime(), tokenExp.getTime(), id);
  },

  deleteSession: async ({ tokenHash }) => {
    db.run(`DELETE FROM sessions WHERE token_hash = ? OR second_token_hash = ?`, 
      tokenHash, tokenHash);
  },
};
```

### In-Memory Store Configuration

```js
function createInMemoryConfig() {
  // Simple in-memory storage for sessions
  const sessions = {};
  
  return {
    dateNow: () => new Date(),
    tokenExpiresIn: 10 * 60 * 1000, // 10 minutes
    sessionExpiresIn: 5 * 60 * 60 * 1000, // 5 hours

    selectSession: async ({ tokenHash }) => {
      for (const [id, session] of Object.entries(sessions)) {
        const [latestTokenHash1, latestTokenHash2] = session.tokenHashes.toReversed();
        if (latestTokenHash1 !== undefined && 
            (tokenHash === latestTokenHash1 || tokenHash === latestTokenHash2)) {
          return {
            id,
            latestTokenHash: [latestTokenHash1, latestTokenHash2],
            exp: session.exp,
            tokenExp: session.tokenExp,
            data: {
              userId: session.userId
            },
          };
        }
      }
      return undefined;
    },

    insertSession: async ({ id, exp, tokenExp, tokenHash, data }) => {
      sessions[id] = {
        exp,
        tokenExp,
        tokenHashes: [tokenHash],
        userId: data.userId
      };
    },

    updateSession: async ({ id, exp, tokenHash, tokenExp }) => {
      const session = sessions[id];
      if (session === undefined) throw new Error("Session not found");

      session.tokenHashes.push(tokenHash);
      session.tokenExp = tokenExp;
      session.exp = exp;
    },

    deleteSession: async ({ tokenHash }) => {
      const sessionEntry = Object.entries(sessions).find(([_, session]) =>
        session.tokenHashes.includes(tokenHash),
      );
      if (sessionEntry === undefined) throw new Error("Session not found");

      const [id] = sessionEntry;
      delete sessions[id];
    },
  };
}

const config = createInMemoryConfig();
```

## Testing Configuration

After implementing your own storage backend, you can test your implementation with the `testConfig`
function:

```js
import { testConfig } from "tiny-cookie-session";

// Test your configuration with multiple session examples
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

Note that this function might leave some data in the storage backend when failing, so we don't
recommend running it in production. The more variations you provide, the more robust your
implementation will be against edge cases. Make sure the session IDs are unique.

## How to decide `sessionExpiresIn`

The session is considered expired when the current time is greater than the last time the token was
refreshed plus the `sessionExpiresIn` value. Essentially, this is equivalent to "log out after X
minutes of inactivity." For example, if you set `sessionExpiresIn` to 30 minutes, you can
indefinitely use the session by consuming it at least every 29 minutes.

## How to decide `tokenExpiresIn`

The token is considered expired when the current time is greater than the last time the token was
refreshed plus the `tokenExpiresIn` value. The token will be refreshed if the token is expired but
the session is not expired. Making this value shorter means:

- The cookie theft will be detected faster
- More tokens need to be stored in the storage backend

For extreme cases where you set this to a very short value (e.g., 10 seconds), it might unexpectedly
log out users during valid but slow operations that take longer than 10 seconds to complete.

## Basic Usage

### Login

```js
import { login } from "tiny-cookie-session";
import { config } from "./session-config.js";

// Create a Bun server
const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    
    if (url.pathname === "/login" && req.method === "POST") {
      // Parse request body (assuming JSON)
      const body = await req.json();
      
      // Validate credentials (not shown)
      const userId = "user-123";
      
      // Create a new session
      const cookie = await login(config, {
        id: crypto.randomUUID(), // Unique session ID
        data: { userId }, // Custom data to store with the session
      });
      
      // Create response
      const response = new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      });
      
      // Set the cookie
      const bunCookie = new Bun.Cookie("session", cookie.value, cookie.options);
      
      response.headers.append("Set-Cookie", bunCookie.toString());
      return response;
    }
    
    return new Response("Not Found", { status: 404 });
  }
});

console.log(`Server running at http://localhost:${server.port}`);
```

### Logout

```js
import { logout } from "tiny-cookie-session";
import { config } from "./session-config.js";

// In your Bun server handler
if (url.pathname === "/logout" && req.method === "POST") {
  // Get session token from cookie
  const cookies = new Bun.CookieMap(req.headers.get("cookie") || "");
  const token = cookies.get("session");
  
  if (token) {
    // Invalidate the session
    const cookie = await logout(config, { token });
    
    // Create response
    const response = new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" }
    });
    
    // Set the logout cookie (clearing the session)
    const bunCookie = new Bun.Cookie("session", cookie.value, cookie.options);
    
    response.headers.append("Set-Cookie", bunCookie.toString());
    return response;
  }
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" }
  });
}
```

### Consume Session

```js
import { consumeSession } from "tiny-cookie-session";
import { config } from "./session-config.js";

// In your Bun server handler
if (url.pathname === "/protected") {
  // Get session token from cookie
  const cookies = new Bun.CookieMap(req.headers.get("cookie") || "");
  const token = cookies.get("session");
  
  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }
  
  const session = await consumeSession(config, { token });
  
  if (session.state === "Active") {
    // Session is valid
    return new Response(JSON.stringify({
      userId: session.data.userId,
      message: "You are logged in"
    }), {
      headers: { "Content-Type": "application/json" }
    });
  } else if (session.state === "TokenRefreshed") {
    // Token was refreshed, set new cookie
    const response = new Response(JSON.stringify({
      userId: session.data.userId,
      message: "You are logged in (token refreshed)"
    }), {
      headers: { "Content-Type": "application/json" }
    });
    
    const bunCookie = new Bun.Cookie("session", session.cookie.value, session.cookie.options);
    
    response.headers.append("Set-Cookie", bunCookie.toString());
    return response;
  } else if (session.state === "TokenStolen") {
    // Token theft detected!
    const response = new Response(JSON.stringify({
      error: "Session invalidated due to security concern"
    }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
    
    const bunCookie = new Bun.Cookie("session", session.cookie.value, session.cookie.options);
    
    response.headers.append("Set-Cookie", bunCookie.toString());
    return response;
  } else if (session.state === "Expired") {
    // Session expired
    const response = new Response(JSON.stringify({
      error: "Session expired"
    }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
    
    const bunCookie = new Bun.Cookie("session", session.cookie.value, session.cookie.options);
    
    response.headers.append("Set-Cookie", bunCookie.toString());
    return response;
  } else {
    // Session not found
    return new Response(JSON.stringify({
      error: "Invalid session"
    }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }
}
```

## Cookie Parsing/Serializing

This library doesn't parse or serialize cookies. You need to use your own cookie parsing/serializing
library.

### Using Bun.CookieMap and Bun.Cookie

Here's an example of using Bun's cookie utilities with tiny-cookie-session:

```js
import { consumeSession } from "tiny-cookie-session";

export async function withSession(
  req,
  handler
) {
  // Get the session token from cookies
  const cookieHeader = req.headers.get("Cookie");
  if (cookieHeader === null) {
    return handler(undefined);
  }

  const token = new Bun.CookieMap(cookieHeader).get("session");
  if (token === null) {
    return handler(undefined);
  }

  // Consume the session
  const session = await consumeSession(config, { token });
  
  // Handle different session states
  if (session.state === "TokenStolen" || session.state === "Expired") {
    const response = new Response(null, {
      status: 302,
      headers: { "Location": "/login" }
    });
    
    const bunCookie = new Bun.Cookie("session", session.cookie.value, session.cookie.options);
    
    response.headers.append("Set-Cookie", bunCookie.toString());
    return response;
  }
  
  // Pass the session to the handler
  const response = await handler(session);
  
  // If token was refreshed, set the new cookie
  if (session.state === "TokenRefreshed") {
    const bunCookie = new Bun.Cookie("session", session.cookie.value, session.cookie.options);
    
    response.headers.append("Set-Cookie", bunCookie.toString());
  }
  
  return response;
}
```

## Passing Custom Data

You can pass custom data when using `login` and `consumeSession` functions. The data structure can
be different between insertion and selection.

```js
// Define your configuration with different data structures for insert and select
const config = {
  // Other config properties...
  
  // When selecting sessions, we return userId, createdAt, and lastLogin
  selectSession: async ({ tokenHash }) => {
    const session = db.query(`
      SELECT id, token_hash, second_token_hash, exp, token_exp, user_id, created_at, last_login
      FROM sessions
      WHERE token_hash = ? OR second_token_hash = ?
    `).get(tokenHash, tokenHash);

    if (!session) return undefined;

    return {
      id: session.id,
      latestTokenHash: [session.token_hash, session.second_token_hash],
      exp: new Date(session.exp),
      tokenExp: new Date(session.token_exp),
      data: {
        userId: session.user_id,
        createdAt: session.created_at,
        lastLogin: session.last_login
      },
    };
  },
  
  // When inserting sessions, we only require userId and role
  insertSession: async ({ id, tokenHash, exp, tokenExp, data }) => {
    const now = new Date().toISOString();
    
    db.run(`
      INSERT INTO sessions (id, token_hash, exp, token_exp, user_id, role, created_at, last_login)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, id, tokenHash, exp.getTime(), tokenExp.getTime(), data.userId, data.role, now, now);
  },
  
  // Other methods...
};

// Login with the required data for insertSession
const cookie = await login(config, {
  id: crypto.randomUUID(),
  data: { 
    userId: "user-123",
    role: "admin"
  }
});

// Consume session will return data in the format defined by selectSession
const session = await consumeSession(config, { token });
if (session.state === "Active" || session.state === "TokenRefreshed") {
  console.log(`User ${session.data.userId} created at ${session.data.createdAt}`);
  console.log(`Last login: ${session.data.lastLogin}`);
}
```

## Garbage Collecting Expired Sessions

While sessions will be deleted when users log out or consume expired sessions, this library doesn't
automatically delete expired sessions of inactive users. You need to implement your own garbage
collection mechanism to delete expired sessions:

```js
// Bun SQLite garbage collection example
function setupSessionGarbageCollection(db, intervalMs = 3600000) {
  // Run garbage collection every hour by default
  setInterval(() => {
    const now = Date.now();
    
    // Delete expired sessions
    const deleted = db.run(`
      DELETE FROM sessions 
      WHERE exp < ?
    `, now);
    
    console.log(`Garbage collection: deleted ${deleted.changes} expired sessions`);
  }, intervalMs);
}

// Start the garbage collection
setupSessionGarbageCollection(db);
```

## Force Logout a Session

You can force logout a user by deleting their session from the storage backend. This will take
effect immediately, unlike JWT:

```js
// Force logout a user by their userId
async function forceLogoutUser(userId) {
  // For SQLite
  db.run("DELETE FROM sessions WHERE user_id = ?", userId);
}

// Usage in a Bun server
if (url.pathname === "/admin/force-logout" && req.method === "POST") {
  const body = await req.json();
  const { userId } = body;
  
  await forceLogoutUser(userId);
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" }
  });
}
```

## Cookie Theft Mitigation

This library mitigates cookie theft by logging out both the attacker and the user when theft is
detected.

### Detecting Cookie Theft

- A session is identified by a short-lived token
- When the token is refreshed, a new token is generated and set in the browser, while old tokens are
  kept in the database
- When someone uses an old token, it's either the user or an attacker
- If an old token is used after a newer token has already been used, it's likely a cookie theft

### Handling Race Conditions

To prevent false positives from race conditions, we keep track of the two latest tokens. This is
necessary because in real-world scenarios, a user might make multiple requests simultaneously:

1. Client sends request A with `cookie: token=old_token` (Valid token)
2. Server creates `new_token` in database (Now it's the latest token)
3. Client sends request B with `cookie: token=old_token` (Still valid because we track two tokens)
4. Server sends response for A with `set-cookie: token=new_token`
5. Client sends request C with `cookie: token=new_token` (Valid token)

Without tracking two tokens, request B would be falsely identified as a cookie theft.

## Device Bound Session Credentials

Device Bound Session Credentials (DBSC) is an advanced security approach that cryptographically
binds session credentials to specific devices. DBSC creates a strong link between the user's device
and their session, making it much harder for attackers to use stolen cookies.

For more information about DBSC, see:

- [Chrome's blog post on fighting cookie theft using DBSC](https://blog.chromium.org/2024/04/fighting-cookie-theft-using-device.html)
- [Chrome's developer documentation on DBSC](https://developer.chrome.com/docs/web-platform/device-bound-session-credentials)

### tiny-cookie-session vs DBSC

**tiny-cookie-session:**

- **Session theft detection:** Can detect cookie theft but only after it occurs
- **Response to theft:** Must invalidate both attacker's and user's sessions since it can't
  distinguish between them
- **Storage requirements:** Needs to store multiple tokens per active session to detect theft
- **Client requirements:** Works with any client; no special hardware or APIs needed
- **Implementation complexity:** Simpler to implement; requires no client-side cryptographic
  operations
- **User experience:** Logout affects both legitimate user and attacker when theft is detected

**DBSC:**

- **Session theft prevention:** Proactively prevents cookie theft by binding sessions to devices
- **Response to theft:** Can specifically reject only the attacker, as they can't complete
  cryptographic challenges
- **Storage requirements:** Only needs to store one token per session
- **Client requirements:** Requires secure hardware (like TPM) or secure enclaves on client devices
- **Implementation complexity:** More complex; requires client-side crypto APIs and key management
- **User experience:** Legitimate users remain logged in even after theft attempts

### Using tiny-cookie-session with DBSC

You can enhance tiny-cookie-session's security by integrating it with DBSC principles. When a client
supports DBSC, the session can be bound to the device's cryptographic identity, adding an additional
layer of security. The integration would require modifying your authentication flow to verify the
device's identity with each token refresh. The server would generate challenges that only the
legitimate device could solve using its private key stored in secure hardware. By combining both
approaches, you get the simplicity of tiny-cookie-session with the enhanced security of DBSC. This
provides defense in depth: tiny-cookie-session's token rotation detects theft attempts, while DBSC
prevents unauthorized devices from using stolen credentials in the first place. This approach is
especially valuable for high-security applications like financial services or healthcare.

## Session Token

We use 256 bits of entropy for session tokens, which is higher than many common implementations:

- Remix uses 64 bits of entropy
- OWASP recommends at least 64 bits of entropy
- Lucia uses 160 bits of entropy in their SQLite example
- Auth.js uses 256 bits of entropy in their tests

This high entropy ensures that even if the database is compromised, attackers can't easily guess
valid session tokens. Since the token itself is already a random string with high entropy (unlike
passwords), we don't need additional processing like salting, stretching, or peppering. We use
SHA-256 hashing for token storage, which provides adequate security without significant performance
impact.

## CSRF

This library doesn't provide CSRF protection. You need to implement CSRF protection separately for
your application before reaching the session management layer.

## Signed Cookies

This library doesn't sign cookies by default. While signed cookies can prevent tampering without
accessing the storage backend, they aren't strictly necessary for the core functionality. You can
implement signed cookies on top of this library if desired.

## Your Cookie is still not 100% safe

While this library can mitigate cookie theft by detecting and invalidating stolen sessions, it
cannot prevent cookie theft in the first place. Limitations to be aware of:

- Attackers can still use stolen cookies until theft is detected
- If a user never uses their session after theft, the attacker can continue indefinitely
- The library becomes ineffective if cookies are constantly stolen by malware or other persistent
  means

No purely software-based solution, including DBSC, can fully prevent these issues.

## Delete cookie after browser close

To create a session that expires when the browser is closed (equivalent to when "remember me" is not
checked), simply remove the `expires` attribute from the cookie:

```js
// Login with "remember me" option
if (url.pathname === "/login" && req.method === "POST") {
  const body = await req.json();
  const rememberMe = body.rememberMe === true;
  
  // Create a new session
  const cookie = await login(config, {
    id: crypto.randomUUID(),
    data: { userId: body.userId },
  });
  
  // Create response
  const response = new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" }
  });
  
  // Remove expires attribute if not using "remember me"
  const options = { ...cookie.options };
  if (!rememberMe) {
    delete options.expires;
  }
  
  const bunCookie = new Bun.Cookie("session", cookie.value, options);
  
  response.headers.append("Set-Cookie", bunCookie.toString());
  return response;
}

// Similarly for consumeSession when token is refreshed
if (session.state === "TokenRefreshed") {
  // Get original cookie to check if it had an expiration (remember me was enabled)
  const cookies = new Bun.CookieMap(req.headers.get("cookie") || "");
  const originalCookie = cookies.get("session", { decode: false });
  
  const options = { ...session.cookie.options };
  if (originalCookie && !originalCookie.expires) {
    delete options.expires;
  }
  
  const bunCookie = new Bun.Cookie("session", session.cookie.value, options);
  
  response.headers.append("Set-Cookie", bunCookie.toString());
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

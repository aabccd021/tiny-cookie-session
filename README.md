# tiny-cookie-session

**tiny-cookie-session** is a cookie session library with cookie theft mitigation for JavaScript and TypeScript. It provides secure session management with automatic token rotation and detection of stolen credentials.

## Installation

```sh
pnpm install tiny-cookie-session@github:aabccd021/tiny-cookie-session
yarn add tiny-cookie-session@github:aabccd021/tiny-cookie-session
bun install tiny-cookie-session@github:aabccd021/tiny-cookie-session
```

## Creating a configuration

Before using this library, you need to create a configuration object, which includes all the necessary parameters for managing sessions including the storage backend, expiration time, and refresh interval.

This library doesn't include any adapter for a storage backend, so you need to provide your own storage implementation in the configuration object.

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
        userId: session.user_id,
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
              userId: session.userId,
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
        userId: data.userId,
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

After implementing your own storage backend, you can test your implementation with the `testConfig` function:

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

Note that this function might leave some data in the storage backend when failing, so we don't recommend running it in production.

The more variations you provide, the more robust your implementation will be against edge cases. Make sure the session IDs are unique.

## How to decide `sessionExpiresIn`

The session is considered expired when the current time is greater than the last time the token was refreshed plus the `sessionExpiresIn` value.

Essentially, this is equivalent to "log out after X minutes of inactivity."

For example, if you set `sessionExpiresIn` to 30 minutes, you can indefinitely use the session by consuming it at least every 29 minutes.

## How to decide `tokenExpiresIn`

The token is considered expired when the current time is greater than the last time the token was refreshed plus the `tokenExpiresIn` value.

The token will be refreshed if the token is expired but the session is not expired.

Making this value shorter means:

- The cookie theft will be detected faster
- More tokens need to be stored in the storage backend

For extreme cases where you set this to a very short value (e.g., 10 seconds), it might unexpectedly log out users during valid but slow operations that take longer than 10 seconds to complete.

## Basic Usage

### Login

```js
import { login } from "tiny-cookie-session";
import { config } from "./session-config.js";

// Handle login request
app.post("/login", async (req, res) => {
  // Validate credentials (not shown)
  const userId = "user-123";
  
  // Create a new session
  const cookie = await login(config, {
    id: crypto.randomUUID(), // Unique session ID
    data: { userId }, // Custom data to store with the session
  });
  
  // Set the cookie in the response
  res.setHeader("Set-Cookie", 
    `session=${cookie.value}; Path=${cookie.options.path}; HttpOnly; Secure; SameSite=Lax`);
  
  res.json({ success: true });
});
```

### Logout

```js
import { logout } from "tiny-cookie-session";
import { config } from "./session-config.js";

app.post("/logout", async (req, res) => {
  const token = req.cookies.session;
  
  if (token) {
    // Invalidate the session
    const cookie = await logout(config, { token });
    
    // Clear the cookie
    res.setHeader("Set-Cookie", 
      `session=${cookie.value}; Path=${cookie.options.path}; HttpOnly; Secure; SameSite=Lax; Max-Age=${cookie.options.maxAge}`);
  }
  
  res.json({ success: true });
});
```

### Consume Session

```js
import { consumeSession } from "tiny-cookie-session";
import { config } from "./session-config.js";

app.get("/protected", async (req, res) => {
  const token = req.cookies.session;
  
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  const session = await consumeSession(config, { token });
  
  switch (session.state) {
    case "Active":
      // Session is valid
      return res.json({ 
        userId: session.data.userId, 
        message: "You are logged in" 
      });
      
    case "TokenRefreshed":
      // Token was refreshed, set new cookie
      res.setHeader("Set-Cookie", 
        `session=${session.cookie.value}; Path=${session.cookie.options.path}; HttpOnly; Secure; SameSite=Lax; Expires=${session.cookie.options.expires?.toUTCString()}`);
      
      return res.json({ 
        userId: session.data.userId, 
        message: "You are logged in (token refreshed)" 
      });
      
    case "TokenStolen":
      // Token theft detected!
      res.setHeader("Set-Cookie", 
        `session=${session.cookie.value}; Path=${session.cookie.options.path}; HttpOnly; Secure; SameSite=Lax; Max-Age=${session.cookie.options.maxAge}`);
      
      return res.status(401).json({ 
        error: "Session invalidated due to security concern" 
      });
      
    case "Expired":
      // Session expired
      res.setHeader("Set-Cookie", 
        `session=${session.cookie.value}; Path=${session.cookie.options.path}; HttpOnly; Secure; SameSite=Lax; Max-Age=${session.cookie.options.maxAge}`);
      
      return res.status(401).json({ 
        error: "Session expired" 
      });
      
    case "NotFound":
      // Session not found
      return res.status(401).json({ 
        error: "Invalid session" 
      });
  }
});
```

## Cookie Parsing/Serializing

This library doesn't parse or serialize cookies. You need to use your own cookie parsing/serializing library.

### Using the `cookie` library

```js
import { parse, serialize } from "cookie";
import { consumeSession } from "tiny-cookie-session";

// Parsing cookies from request
const cookies = parse(request.headers.get("cookie") || "");
const token = cookies.session;

// Consuming the session
const session = await consumeSession(config, { token });

// Serializing cookie for response
if (session.state === "TokenRefreshed") {
  const serialized = serialize("session", session.cookie.value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: session.cookie.options.expires,
  });
  
  response.headers.set("Set-Cookie", serialized);
}
```

### Using Bun.CookieMap and Bun.Cookie

```js
import { consumeSession } from "tiny-cookie-session";

// In a Bun server request handler
export default {
  async fetch(request) {
    const url = new URL(request.url);
    
    if (url.pathname === "/api/protected") {
      // Get the session token from cookies
      const token = request.cookies.get("session");
      
      if (!token) {
        return new Response("Unauthorized", { status: 401 });
      }
      
      const session = await consumeSession(config, { token });
      
      if (session.state === "Active" || session.state === "TokenRefreshed") {
        const response = new Response(JSON.stringify({
          userId: session.data.userId,
          message: "Protected data"
        }), {
          headers: { "Content-Type": "application/json" }
        });
        
        // Set the refreshed token if needed
        if (session.state === "TokenRefreshed") {
          response.headers.append("Set-Cookie", 
            new Bun.Cookie({
              name: "session",
              value: session.cookie.value,
              httpOnly: true,
              secure: true,
              sameSite: "Lax",
              path: "/",
              expires: session.cookie.options.expires,
            }).toString()
          );
        }
        
        return response;
      } else {
        return new Response("Unauthorized", { status: 401 });
      }
    }
    
    return new Response("Not Found", { status: 404 });
  }
}
```

## Passing Custom Data

You can pass custom data when using `login` and `consumeSession` functions.

This is useful if you have a SQL table for session with non-nullable columns for custom data.

### Login with Custom Data

```js
// Login with userId as custom data
const cookie = await login(config, {
  id: crypto.randomUUID(),
  data: { 
    userId: "user-123",
    role: "admin",
    lastLoginTime: new Date().toISOString(),
  }
});
```

### Consuming Session with Custom Data

```js
const token = request.cookies.get("session");
const session = await consumeSession(config, { token });

if (session.state === "Active" || session.state === "TokenRefreshed") {
  // Access the custom data
  const { userId, role, lastLoginTime } = session.data;
  
  // Use the data
  console.log(`User ${userId} with role ${role} logged in at ${lastLoginTime}`);
}
```

## Garbage Collecting Expired Sessions

While sessions will be deleted when users log out or consume expired sessions, this library doesn't automatically delete expired sessions of inactive users.

You need to implement your own garbage collection mechanism to delete expired sessions:

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

You can force logout a user by deleting their session from the storage backend. This will take effect immediately, unlike JWT:

```js
// Force logout a user by their userId
async function forceLogoutUser(userId) {
  // For SQLite
  db.run("DELETE FROM sessions WHERE user_id = ?", userId);
  
  // Or for in-memory store
  for (const [id, session] of Object.entries(sessions)) {
    if (session.userId === userId) {
      delete sessions[id];
    }
  }
}

// Usage
app.post("/admin/force-logout/:userId", async (req, res) => {
  const { userId } = req.params;
  
  await forceLogoutUser(userId);
  
  res.json({ success: true });
});
```

## Cookie Theft Mitigation

This library mitigates cookie theft by logging out both the attacker and the user when theft is detected.

### Detecting Cookie Theft

- A session is identified by a short-lived token
- When the token is refreshed, a new token is generated and set in the browser, while old tokens are kept in the database
- When someone uses an old token, it's either the user or an attacker
- If an old token is used after a newer token has already been used, it's likely a cookie theft

### Handling Race Conditions

To prevent false positives from race conditions, we keep track of the two latest tokens.

This is necessary because in real-world scenarios, a user might make multiple requests simultaneously:

1. Client sends request A with `cookie: token=old_token` (Valid token)
1. Server creates `new_token` in database (Now it's the latest token)
1. Client sends request B with `cookie: token=old_token` (Still valid because we track two tokens)
1. Server sends response for A with `set-cookie: token=new_token`
1. Client sends request C with `cookie: token=new_token` (Valid token)

Without tracking two tokens, request B would be falsely identified as a cookie theft.

## Device Bound Session Credentials

Device Bound Session Credentials (DBSC) is a more sophisticated approach to session security that binds the session to a specific device using cryptographic keys, often stored in secure hardware (like TPM).

### tiny-cookie-session vs DBSC

**tiny-cookie-session:**

- Invalidates both attacker and user on cookie theft detection (can't determine which is legitimate)
- Requires storing multiple tokens per active session
- Doesn't rely on client secure storage (TPM)
- Doesn't require additional endpoints for token management

**DBSC:**

- Only invalidates the attacker, as legitimate users can complete cryptographic challenges
- Only needs to store a single token per session
- Relies on client secure storage for private keys
- Requires additional endpoints for token creation/updating

### Using tiny-cookie-session with DBSC

If your client devices support DBSC, you can enhance security by combining approaches:

```js
// When refreshing a token, include a device-bound challenge
async function refreshTokenWithDBSC(session, devicePublicKey) {
  // Create new token with tiny-cookie-session
  const { cookie, tokenHash } = await createNewTokenCookie(config);
  
  // Create a challenge using the device's public key
  const challenge = createChallengeForDevice(devicePublicKey);
  
  // Update session with new token and challenge
  await config.updateSession({
    id: session.id,
    tokenHash,
    exp: session.exp,
    tokenExp: session.tokenExp,
    challenge,
  });
  
  return { cookie, challenge };
}

// When consuming a session, verify the device signature
async function verifyDeviceSignature(session, signature) {
  // Verify that the signature matches the challenge
  const isValid = verifySignatureForChallenge(
    session.challenge,
    signature,
    session.devicePublicKey
  );
  
  if (!isValid) {
    // This is likely not the original device
    await config.deleteSession({ tokenHash: session.tokenHash });
    return false;
  }
  
  return true;
}
```

## Session Token

We use 256 bits of entropy for session tokens, which is higher than many common implementations:

- Remix uses 64 bits of entropy
- OWASP recommends at least 64 bits of entropy
- Lucia uses 160 bits of entropy in their SQLite example
- Auth.js uses 256 bits of entropy in their tests

This high entropy ensures that even if the database is compromised, attackers can't easily guess valid session tokens.

Since the token itself is already a random string with high entropy (unlike passwords), we don't need additional processing like salting, stretching, or peppering.

We use SHA-256 hashing for token storage, which provides adequate security without significant performance impact.

## CSRF

This library doesn't provide CSRF protection. You need to implement CSRF protection separately for your application before reaching the session management layer.

## Signed Cookies

This library doesn't sign cookies by default. While signed cookies can prevent tampering without accessing the storage backend, they aren't strictly necessary for the core functionality.

You can easily implement signed cookies on top of this library:

```js
import { createHmac } from "crypto";

const SECRET_KEY = process.env.COOKIE_SECRET;

function signCookie(value) {
  const signature = createHmac("sha256", SECRET_KEY)
    .update(value)
    .digest("hex");
    
  return `${value}.${signature}`;
}

function verifyCookie(signedValue) {
  const [value, signature] = signedValue.split(".");
  
  const expectedSignature = createHmac("sha256", SECRET_KEY)
    .update(value)
    .digest("hex");
    
  if (signature === expectedSignature) {
    return value;
  }
  
  return null;
}

// Usage with tiny-cookie-session
const cookie = await login(config, {
  id: "session-id",
  data: { userId: "user-123" },
});

// Sign the cookie before sending
const signedCookie = signCookie(cookie.value);

// When receiving a cookie, verify before using
const token = verifyCookie(signedCookieValue);
if (token) {
  const session = await consumeSession(config, { token });
  // Handle session
}
```

## Your Cookie is still not 100% safe

While this library can mitigate cookie theft by detecting and invalidating stolen sessions, it cannot prevent cookie theft in the first place.

Limitations to be aware of:

- Attackers can still use stolen cookies until theft is detected
- If a user never uses their session after theft, the attacker can continue indefinitely
- The library becomes ineffective if cookies are constantly stolen by malware or other persistent means

No purely software-based solution, including DBSC, can fully prevent these issues.

## Improving security with service workers

You can enhance security by periodically refreshing the session using service workers:

```js
// In your service worker (service-worker.js)
const SESSION_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Periodically refresh the session cookie
setInterval(async () => {
  try {
    const response = await fetch('/api/refresh-session', {
      credentials: 'same-origin',
    });
    
    if (response.ok) {
      console.log('Session refreshed by service worker');
    }
  } catch (error) {
    console.error('Error refreshing session:', error);
  }
}, SESSION_REFRESH_INTERVAL);

// On your server
app.get('/api/refresh-session', async (req, res) => {
  const token = req.cookies.session;
  
  if (!token) {
    return res.status(401).json({ error: 'No session' });
  }
  
  const session = await consumeSession(config, { token });
  
  if (session.state === 'TokenRefreshed') {
    res.setHeader('Set-Cookie', 
      `session=${session.cookie.value}; Path=${session.cookie.options.path}; HttpOnly; Secure; SameSite=Lax; Expires=${session.cookie.options.expires?.toUTCString()}`);
  }
  
  res.json({ success: true });
});
```

## Delete cookie after browser close

To create a session that expires when the browser is closed (equivalent to when "remember me" is not checked), simply remove the `expires` and `maxAge` attributes from the cookie:

```js
// Login without "remember me" option
app.post("/login", async (req, res) => {
  const rememberMe = req.body.rememberMe === true;
  
  // Create session
  const cookie = await login(config, {
    id: crypto.randomUUID(),
    data: { userId: req.body.userId },
  });
  
  // Prepare cookie options
  const cookieOptions = {
    path: cookie.options.path,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
  };
  
  // Only set expiration if "remember me" is checked
  if (rememberMe) {
    cookieOptions.expires = cookie.options.expires;
  }
  
  // Set the cookie with or without expiration
  res.setHeader("Set-Cookie", serialize("session", cookie.value, cookieOptions));
  
  res.json({ success: true });
});
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

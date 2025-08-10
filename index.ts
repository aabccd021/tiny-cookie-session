/*
To maintain the simplicity of this library, we don't do any cookie signing.

For detecting cookie tampering, we can simply check whether the token hash is
present in the database.

You can still unsign a cookie yourself before passing it to this library, and
sign a cookie after it's returned from this library.

Also we don't cache cookies. We just access database every time.
*/

// TODO: Remove this when the proposal is implemented
declare global {
  interface Uint8Array {
    // https://tc39.es/proposal-arraybuffer-base64/spec/#sec-uint8array.prototype.tobase64
    toBase64(): string;
  }
}

export type CookieOptions = {
  readonly maxAge?: number;
  readonly expires?: Date;
  readonly domain?: string;
  readonly path?: string;
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
  readonly sameSite?: "strict" | "lax" | "none";
};

export type Cookie = {
  readonly value: string;
  readonly options: CookieOptions;
};

export type SessionData<S> = {
  readonly id: string;
  readonly exp: Date;
  readonly tokenExp: Date;
  readonly token1Hash: string;
  readonly token2Hash: string | undefined;
  readonly extra: S;
};

export type Session<S> =
  | {
      readonly state: "NotFound";
      readonly cookie: Cookie;
      readonly requestTokenHash: string;
    }
  | {
      readonly state: "TokenStolen";
      readonly cookie: Cookie;
      readonly requestTokenHash: string;
      readonly data: SessionData<S>;
    }
  | {
      readonly state: "Expired";
      readonly cookie: Cookie;
      readonly requestTokenHash: string;
      readonly data: SessionData<S>;
      readonly now: Date;
    }
  | {
      readonly state: "TokenRefreshed";
      readonly data: SessionData<S>;
      readonly cookie: Cookie;
      readonly now: Date;
    }
  | {
      readonly state: "Active";
      readonly data: SessionData<S>;
      readonly now: Date;
    };

export type Config<S, I> = {
  readonly cookieOption?: Omit<CookieOptions, "maxAge" | "expires">;
  readonly dateNow: () => Date;
  readonly sessionExpiresIn: number;
  readonly tokenExpiresIn: number;
  readonly selectSession: (params: { tokenHash: string }) => Promise<SessionData<S> | undefined>;
  readonly insertSession: (params: {
    readonly sessionId: string;
    readonly sessionExp: Date;
    readonly tokenHash: string;
    readonly tokenExp: Date;
    readonly extra: I;
  }) => Promise<void>;
  readonly insertTokenAndUpdateSession: (params: {
    readonly sessionId: string;
    readonly sessionExp: Date;
    readonly tokenExp: Date;
    readonly tokenHash: string;
  }) => Promise<void>;
  readonly deleteSession: (params: { tokenHash: string }) => Promise<void>;
  readonly generateSessionId: () => string;
};

export const defaultConfig = {
  sessionExpiresIn: 30 * 24 * 60 * 60 * 1000,
  tokenExpiresIn: 1 * 60 * 1000,
  dateNow: () => new Date(),
  generateSessionId: () => crypto.randomUUID(),
};

const defaultCookieOption: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  secure: true,
};

function logoutCookie<S, I>(config: Config<S, I>): Cookie {
  return {
    value: "",
    options: {
      ...defaultCookieOption,
      ...config.cookieOption,
      maxAge: 0,
    },
  };
}

/*
Remix uses 64 bits of entropy
https://github.com/remix-run/remix/blob/b7d280140b27507530bcd66f7b30abe3e9d76436/packages/remix-node/sessions/fileStorage.ts#L45

OWASP recommends at least 64 bits of entropy
https://owasp.org/www-community/vulnerabilities/Insufficient_Session-ID_Length

Lucia uses 160 bits of entropy in their sqlite example
https://github.com/lucia-auth/lucia/blob/46b164f78dc7983d7a4c3fb184505a01a4939efd/pages/sessions/basic-api/sqlite.md?plain=1#L88

auth.js uses 256 bits of entropy in their test
https://github.com/nextauthjs/next-auth/blob/c5a70d383bb97b39f8edbbaf69c4c7620246e9a4/packages/core/test/actions/session.test.ts#L146
*/
const tokenEntropyBit = 256;

function generateToken(): string {
  return crypto.getRandomValues(new Uint8Array(tokenEntropyBit / 8)).toBase64();
}

/*
A token is hashed before being stored in the database.

This way, when the database is compromised, the attacker can't just use any
data in the database to hijack the session.

Since the token itself is already a random string with high entropy, unlike a
password, we don't need any additional processing like salting, stretching, or
peppering.

Doing sha-256 for every request might seem like a lot, but it's not any more
taxing than doing cookie signing, which is a common practice in web services.
*/
async function hashToken(token: string): Promise<string> {
  // return crypto.createHash("sha256").update(token).digest("base64");
  const data = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hashBuffer).toBase64();
}

async function createNewTokenCookie<S, I>(
  config: Config<S, I>,
): Promise<{
  readonly cookie: Cookie;
  readonly tokenHash: string;
}> {
  const token = generateToken();
  const tokenHash = await hashToken(token);
  const now = config.dateNow();

  /*
  We use `sessionExpiresIn` instead of `tokenExpiresIn` here, because we want
  the cookie to expire when the session expires, not when the token expires.

  This allows the user to stay logged in as long as the session is valid, even
  if the token is rotated frequently.

  We primarily use short-lived tokens to detect cookie theft, and not to limit
  the session duration.
  */
  const expires = new Date(now.getTime() + config.sessionExpiresIn);

  const cookie: Cookie = {
    value: token,
    options: {
      ...defaultCookieOption,
      ...config.cookieOption,
      expires,
    },
  };

  return { cookie, tokenHash };
}

export async function logout<S, I>(config: Config<S, I>, arg: { token: string }): Promise<Cookie> {
  const tokenHash = await hashToken(arg.token);
  config.deleteSession({ tokenHash });
  return logoutCookie(config);
}

export async function login<S, I>(config: Config<S, I>, arg: { extra: I }): Promise<Cookie> {
  const { cookie, tokenHash } = await createNewTokenCookie(config);
  const now = config.dateNow();
  const sessionId = config.generateSessionId();

  config.insertSession({
    tokenHash,
    sessionId,
    sessionExp: new Date(now.getTime() + config.sessionExpiresIn),
    tokenExp: new Date(now.getTime() + config.tokenExpiresIn),
    extra: arg.extra,
  });
  return cookie;
}

export async function consumeSession<S, I>(
  config: Config<S, I>,
  arg: { token: string },
): Promise<Session<S>> {
  const requestTokenHash = await hashToken(arg.token);
  const session = await config.selectSession({ tokenHash: requestTokenHash });

  /*
  Logout the user when the session doesn't exist.

  This way, the server administrator can immediately force logout users by
  manually deleting the session.
  */
  if (session === undefined) {
    return {
      state: "NotFound",
      cookie: logoutCookie(config),
      requestTokenHash,
    };
  }

  /*
  No need to use `crypto.timingSafeEqual` here because we are comparing hashes
  https://security.stackexchange.com/questions/237116/using-timingsafeequal#comment521092_237133
  */
  const isSessionToken1 = requestTokenHash === session.token1Hash;
  const isSessionToken2 = requestTokenHash === session.token2Hash;

  /*

  # Detecting cookie theft

  The `selectSession` function returns a session (not undefined), which means
  the token is a legit token that is associated with the session, not a random
  token generated by brute force attack.

  But entering this block means the token is neither the latest token nor the
  second latest token.

  The only scenario when this can happen is when the token was stolen, so we
  will log out both the user and the attacker by deleting the session.

  # Why two latest tokens?

  While using just the latest token to identify a session would be enough to
  detect cookie theft, we will instead use the two latest tokens.

  We do this to prevent the user from being logged out while doing completely
  valid requests, but on a certain race condition.

  Below is an example that shows a scenario where the user would be logged out
  for a valid request if we only used the latest token.

  (1) Client sends request lorem with `cookie: token=old_token`. Valid token.
  (2) Server creates token `new_token` in database. Now it's the latest token.
  (3) Client sends request ipsum with `cookie: token=old_token`. Invalid token.
  (4) Server sends response lorem with `set-cookie: token=new_token`.
  (5) Client sends request dolor with `cookie: token=new_token`. Valid token.

  The above example may be easier to imagine if you think of the user uploading
  a large file in step (1), and doing something else in another browser tab in
  step (3).

  # Ideal configuration

  Ideally, `tokenExpiresIn` should be set to a duration as short as possible,
  but still longer than the longest request time.

  */
  if (!isSessionToken1 && !isSessionToken2) {
    config.deleteSession({ tokenHash: requestTokenHash });
    return {
      state: "TokenStolen",
      cookie: logoutCookie(config),
      requestTokenHash,
      data: session,
    };
  }

  const now = config.dateNow();

  if (session.exp < now) {
    config.deleteSession({ tokenHash: requestTokenHash });
    return {
      state: "Expired",
      cookie: logoutCookie(config),
      requestTokenHash,
      data: session,
      now,
    };
  }

  /*
  Generate and return a new token only if the request's token is the latest
  one, but not the second latest one.

  This way, only one of the browsers (the user's or the attacker's) can acquire
  the new token.

  We will also extend the session expiration time here, which is more efficient
  than extending it on every request.
  */
  if (session.tokenExp <= now && isSessionToken1) {
    const { cookie, tokenHash } = await createNewTokenCookie(config);
    const sessionExp = new Date(now.getTime() + config.sessionExpiresIn);
    const tokenExp = new Date(now.getTime() + config.tokenExpiresIn);
    config.insertTokenAndUpdateSession({
      sessionId: session.id,
      tokenHash,
      sessionExp,
      tokenExp,
    });
    return {
      state: "TokenRefreshed",
      cookie,
      now,
      data: {
        id: session.id,
        exp: sessionExp,
        tokenExp,
        token1Hash: tokenHash,
        token2Hash: session.token1Hash, // The second latest token is now the latest one
        extra: session.extra,
      },
    };
  }

  return {
    state: "Active",
    data: session,
    now,
  };
}

/*
Test whether the `Config` is implemented correctly.

If your `Config` implementation is not correct or throws an error, this
function might leave some dirty data in the database.
*/
export async function testConfig<S, I>(
  config: Config<S, I>,
  { insertExtra }: { insertExtra: I },
): Promise<void> {
  if (config.tokenExpiresIn >= config.sessionExpiresIn) {
    throw new Error("tokenExpiresIn must be less than sessionExpiresIn");
  }

  const sessionId = config.generateSessionId();
  const token1Hash = await hashToken(generateToken());
  const token2Hash = await hashToken(generateToken());
  const token3Hash = await hashToken(generateToken());

  const start = new Date();
  await config.insertSession({
    sessionId,
    tokenHash: token3Hash,
    sessionExp: new Date(start.getTime() + config.sessionExpiresIn),
    tokenExp: new Date(start.getTime() + config.tokenExpiresIn),
    extra: insertExtra,
  });

  await config.insertTokenAndUpdateSession({
    sessionId,
    sessionExp: new Date(start.getTime() + 10000 + config.sessionExpiresIn),
    tokenHash: token2Hash,
    tokenExp: new Date(start.getTime() + 1000 + config.tokenExpiresIn),
  });

  await config.insertTokenAndUpdateSession({
    sessionId,
    sessionExp: new Date(start.getTime() + 20000 + config.sessionExpiresIn),
    tokenHash: token1Hash,
    tokenExp: new Date(start.getTime() + 2000 + config.tokenExpiresIn),
  });

  for (const tokenHash of [token1Hash, token2Hash, token3Hash]) {
    const session = await config.selectSession({ tokenHash });
    if (session === undefined) {
      throw new Error("Session not found");
    }

    if (session.id !== sessionId) {
      throw new Error("Session id does not match");
    }

    if (session.token1Hash !== token1Hash) {
      throw new Error("Session token1Hash does not match");
    }

    if (session.token2Hash !== token2Hash) {
      throw new Error("Session token2Hash does not match");
    }

    const expectedSessionExp = new Date(start.getTime() + 20000 + config.sessionExpiresIn);
    if (session.exp.getTime() !== expectedSessionExp.getTime()) {
      throw new Error("Session expired");
    }

    const expectedTokenExp = new Date(start.getTime() + 2000 + config.tokenExpiresIn);
    if (session.tokenExp.getTime() !== expectedTokenExp.getTime()) {
      throw new Error("Token expired");
    }
  }

  await config.deleteSession({ tokenHash: token1Hash });
  for (const tokenHash of [token1Hash, token2Hash, token3Hash]) {
    const session = await config.selectSession({ tokenHash });
    if (session !== undefined) {
      console.log(session);
      throw new Error("Session should not be found");
    }
  }
}

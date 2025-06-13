export type CookieOptions = {
  readonly maxAge?: number;
  readonly domain?: string;
  readonly path?: string;
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
  readonly sameSite?: "strict" | "lax" | "none";
};

export type Cookie = readonly [string, CookieOptions];

export type Session =
  | {
      readonly requireLogout: true;
      readonly reason: "session not found" | "old token" | "session expired";
      readonly cookie: Cookie;
    }
  | {
      readonly requireLogout: false;
      readonly cookie?: Cookie;
      readonly id: string;
      readonly exp: number;
      readonly tokenExp: number;
      readonly token1Hash: string;
      readonly token2Hash: string | undefined;
      readonly userId: string;
    };

export type Config = {
  readonly cookieOption?: Omit<CookieOptions, "maxAge">;
  readonly dateNow: () => number;
  readonly sessionExpiresIn: number;
  readonly tokenExpiresIn: number;
  readonly selectSession: (params: { tokenHash: string }) => Promise<
    | {
        readonly id: string;
        readonly exp: number;
        readonly tokenExp: number;
        readonly token1Hash: string;
        readonly token2Hash: string | undefined;
        readonly userId: string;
      }
    | undefined
  >;
  readonly insertSession: (params: {
    readonly sessionId: string;
    readonly sessionExp: number;
    readonly tokenHash: string;
    readonly tokenExp: number;
    readonly userId: string;
  }) => Promise<void>;
  readonly insertTokenAndUpdateSession: (params: {
    readonly sessionId: string;
    readonly sessionExp: number;
    readonly tokenExp: number;
    readonly newTokenHash: string;
  }) => Promise<void>;
  readonly deleteSession: (params: { tokenHash: string }) => Promise<void>;
};

export const defaultConfig = {
  dateNow: (): number => Date.now(),
  sessionExpiresIn: 30 * 24 * 60 * 60 * 1000,
  tokenExpiresIn: 1 * 60 * 1000,
};

const defaultCookieOption: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  secure: true,
};

function logoutCookie(config: Config): Cookie {
  return [
    "",
    {
      ...defaultCookieOption,
      ...config.cookieOption,
      maxAge: 0,
    },
  ];
}

// remix uses 64 bits of entropy
// https://github.com/remix-run/remix/blob/b7d280140b27507530bcd66f7b30abe3e9d76436/packages/remix-node/sessions/fileStorage.ts#L45
//
// owasp recommends at least 64 bits of entropy
// https://owasp.org/www-community/vulnerabilities/Insufficient_Session-ID_Length
//
// lucia uses 160 bits of entropy in their sqlite example
// https://github.com/lucia-auth/lucia/blob/46b164f78dc7983d7a4c3fb184505a01a4939efd/pages/sessions/basic-api/sqlite.md?plain=1#L88
//
// auth.js uses 256 bits of entropy in their test
// https://github.com/nextauthjs/next-auth/blob/c5a70d383bb97b39f8edbbaf69c4c7620246e9a4/packages/core/test/actions/session.test.ts#L146
//
const entropyBits = 256;

function createRandom256BitHex(): string {
  return crypto.getRandomValues(new Uint8Array(entropyBits / 8)).toHex();
}

async function createNewTokenCookie(config: Config): Promise<{
  readonly cookie: Cookie;
  readonly tokenHash: string;
}> {
  const token = createRandom256BitHex();
  const tokenHash = await hashToken(token);

  const cookie: Cookie = [
    encodeURIComponent(token),
    {
      ...defaultCookieOption,
      ...config.cookieOption,
      maxAge: 365 * 24 * 60 * 60 * 1000,
    },
  ];

  return { cookie, tokenHash };
}

// An token needs to be hashed before storing it in the database.
// This way when the database is compromised, the attacker cannot use the tokens directly.
//
// Author (security amateur) has an opinion that we don't need to use common password storing
// methods like bcrypt encryption, salt, or pepper, because we are hashing already cryptographically
// random 256 bit hex string, which is resistant to brute force attacks and dictionary attacks.
// Instead we use SHA-256 hashing, which is secure enough for this purpose, and is fast enough
// to be done on every HTTP request, not just on login.
//
// So to hijack someone's session without stealing the cookie, the attacker would need to:
// 1. Compromise the database, and get someone's token hash
// 2. Find a 256 bit hex string which hash is equal to the token hash
// 3. Finish step 2 before the user uses the session again
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hashBuffer).toHex();
}

export async function logout(
  config: Config,
  { token }: { token: string },
): Promise<Cookie> {
  await config.deleteSession({ tokenHash: await hashToken(token) });
  return logoutCookie(config);
}

export async function login(
  config: Config,
  { userId }: { userId: string },
): Promise<Cookie> {
  const sessionId = crypto.randomUUID();
  const { cookie, tokenHash } = await createNewTokenCookie(config);
  const now = config.dateNow?.() ?? Date.now();
  await config.insertSession({
    sessionId,
    tokenHash,
    userId,
    sessionExp: now + config.sessionExpiresIn,
    tokenExp: now + config.tokenExpiresIn,
  });
  return cookie;
}

export async function consumeSession(
  config: Config,
  token: string,
): Promise<Session> {
  const tokenHash = await hashToken(token);
  const session = await config.selectSession({ tokenHash });

  // Logout the user when the session doesn't exist.
  // This way admin can force logout users by deleting the session.
  if (session === undefined) {
    return {
      requireLogout: true,
      reason: "session not found",
      cookie: logoutCookie(config),
    };
  }

  // Old token (neither latest or second latest) was used, which means the cookie was stolen.
  // So we will delete the session, which will log out both the user and the attacker.
  //
  // Two latest tokens can be used to identifying a session, instead of just the latest token.
  // We do this to prevent the user from being logged out while doing completely valid requests,
  // but on certain race conditions.
  //
  // Example:
  // 1. Client sends request lorem with `cookie: token=old_token`. Valid token.
  // 2. Server creates token `new_token` on database. Now it's the latest token.
  // 3. Client sends request ipsum with `cookie: token=old_token`. Invalid token.
  // 4. Server sends response lorem with `set-cookie: token=new_token`.
  // 5. Client sends request dolor with `cookie: token=new_token`. Valid token.
  //
  // Above example is a valid scenario that might happen, but will log out the user if we only use
  // the latest token to identify the session.
  //
  // Ideally `tokenExpiresIn` is set to a duration as short as possible, but still longer than the
  // longest request time. More precisely, it's a time between when a request is initiated and when
  // the new token is set as a cookie.
  if (tokenHash !== session.token1Hash && tokenHash !== session.token2Hash) {
    await config.deleteSession({ tokenHash });
    return {
      requireLogout: true,
      reason: "old token",
      cookie: logoutCookie(config),
    };
  }

  const now = config.dateNow?.() ?? Date.now();

  if (session.exp < now) {
    await config.deleteSession({ tokenHash });
    return {
      requireLogout: true,
      reason: "session expired",
      cookie: logoutCookie(config),
    };
  }

  // Set-Cookie to new token only if the requested token is the latest one.
  // This way only one of the user or the attacker can acquire the new token.
  if (session.tokenExp <= now && session.token1Hash === tokenHash) {
    const { cookie, tokenHash } = await createNewTokenCookie(config);
    await config.insertTokenAndUpdateSession({
      sessionId: session.id,
      sessionExp: now + config.sessionExpiresIn,
      newTokenHash: tokenHash,
      tokenExp: now + config.tokenExpiresIn,
    });
    return {
      ...session,
      requireLogout: false,
      cookie,
    };
  }

  return {
    ...session,
    requireLogout: false,
  };
}

// Test wether the configuration is impelmented correctly.
//
// If you implementation is not correct, or throws an error, this function might leave some dirty
// data in the database.
// So ideally run this function in an environment as similar as possible to production, but not in
// production.
export async function testConfig(
  config: Config,
  { userId }: { userId: string },
): Promise<void> {
  const sessionId = crypto.randomUUID();
  const token1Hash = await hashToken(createRandom256BitHex());
  const token2Hash = await hashToken(createRandom256BitHex());
  const token3Hash = await hashToken(createRandom256BitHex());

  const start = Date.now();
  await config.insertSession({
    sessionId,
    tokenHash: token3Hash,
    userId,
    sessionExp: start + config.sessionExpiresIn,
    tokenExp: start + config.tokenExpiresIn,
  });

  await config.insertTokenAndUpdateSession({
    sessionId,
    sessionExp: start + 10000 + config.sessionExpiresIn,
    newTokenHash: token2Hash,
    tokenExp: start + 1000 + config.tokenExpiresIn,
  });

  await config.insertTokenAndUpdateSession({
    sessionId,
    sessionExp: start + 20000 + config.sessionExpiresIn,
    newTokenHash: token1Hash,
    tokenExp: start + 2000 + config.tokenExpiresIn,
  });

  for (const tokenHash of [token1Hash, token2Hash, token3Hash]) {
    const session = await config.selectSession({ tokenHash });
    if (session === undefined) {
      throw new Error("Session not found");
    }

    if (session.id !== sessionId) {
      throw new Error("Session id does not match");
    }

    if (session.userId !== userId) {
      throw new Error("Session user id does not match");
    }

    if (session.token1Hash !== token1Hash) {
      throw new Error("Session token1Hash does not match");
    }

    if (session.token2Hash !== token2Hash) {
      throw new Error("Session token2Hash does not match");
    }

    if (session.exp !== start + 20000 + config.sessionExpiresIn) {
      throw new Error("Session expired");
    }

    if (session.tokenExp !== start + 2000 + config.tokenExpiresIn) {
      throw new Error("Token expired");
    }
  }

  await config.deleteSession({ tokenHash: token1Hash });
  for (const tokenHash of [token1Hash, token2Hash, token3Hash]) {
    const session = await config.selectSession({ tokenHash });
    if (session !== undefined) {
      throw new Error("Session should not be found");
    }
  }
}

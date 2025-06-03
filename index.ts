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
  readonly createSession: (params: {
    readonly sessionId: string;
    readonly sessionExp: number;
    readonly tokenHash: string;
    readonly tokenExp: number;
    readonly userId: string;
  }) => Promise<void>;
  readonly createToken: (params: {
    readonly sessionId: string;
    readonly tokenHash: string;
    readonly tokenExp: number;
  }) => Promise<void>;
  readonly deleteSession: (params: { tokenHash: string }) => Promise<void>;
  readonly updateSession: (params: {
    readonly sessionId: string;
    readonly sessionExp: number;
  }) => Promise<void>;
};

export const defaultConfig = {
  dateNow: (): number => Date.now(),
  sessionExpiresIn: 30 * 24 * 60 * 60 * 1000,
  tokenExpiresIn: 10 * 60 * 1000,
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

// An access token needs to be hashed before storing it in the database.
// This way when the database is compromised, the attacker cannot use the access tokens directly.
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hashBuffer).toHex();
}

export async function logout(
  config: Config,
  { token }: { token: string },
): Promise<Cookie> {
  config.deleteSession({ tokenHash: await hashToken(token) });
  return logoutCookie(config);
}

export async function login(
  config: Config,
  { userId }: { userId: string },
): Promise<Cookie> {
  const sessionId = crypto.randomUUID();
  const { cookie, tokenHash } = await createNewTokenCookie(config);
  const now = config.dateNow?.() ?? Date.now();
  config.createSession({
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

  // Logout the user when the session does not exist.
  // This way admin can force logout users by deleting the session.
  if (session === undefined) {
    return {
      requireLogout: true,
      reason: "session not found",
      cookie: logoutCookie(config),
    };
  }

  // Old access token (neither latest or second latest) was used, which means the cookie was stolen,
  // so logout the session and logout both user and attacker.
  //
  // Two latest tokens are valid instead of just one, to handle race conditions which might occurs
  // with valid request from the user.
  // So ideally `tokenExpiresIn` is set a value as short as possible, but still longer than the
  // longest request time expected.
  // Example:
  // 1. User does request foo with `cookie: token=old_token`.
  // 2. Token `new_token` is created on database, and is the latest token.
  // 3. User does request bar with `cookie: token=old_token`.
  // 4. Response foo with `set-cookie: token=new_token`.
  if (tokenHash !== session.token1Hash && tokenHash !== session.token2Hash) {
    await config.deleteSession({ tokenHash });
    return {
      requireLogout: true,
      reason: "old token",
      cookie: logoutCookie(config),
    };
  }

  const now = config.dateNow?.() ?? Date.now();

  // Session expired, so logout the session.
  if (session.exp < now) {
    config.deleteSession({ tokenHash });
    return {
      requireLogout: true,
      reason: "session expired",
      cookie: logoutCookie(config),
    };
  }

  // If sessionExpiresIn is set to 4 weeks,
  // - If user didn't use the session for 4 weeks, session will expire
  // - On the first two weeks, expiration date is never extended
  // - On any point on the last two weeks, if user used the session,
  //   expiration date will be extended to that point + 4 weeks
  const sessionRefreshDate = session.exp - config.sessionExpiresIn / 2;
  if (sessionRefreshDate < now) {
    config.updateSession({
      sessionId: session.id,
      sessionExp: now + config.sessionExpiresIn,
    });
  }

  // Only give new access token if token is not expired and it is the last token.
  // This way only either the user or the attacker can aquire the new token.
  //
  // Known vulnerability: as long as the token is newest, and session (not token) is not expired,
  // the attacker can keep using the session.
  if (session.tokenExp <= now && session.token1Hash === tokenHash) {
    const { cookie, tokenHash } = await createNewTokenCookie(config);
    config.createToken({
      sessionId: session.id,
      tokenHash,
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

export async function testConfig(
  config: Config,
  { userId }: { userId: string },
): Promise<void> {
  const sessionId = crypto.randomUUID();
  const token1Hash = createRandom256BitHex();
  const token2Hash = createRandom256BitHex();
  const token3 = createRandom256BitHex();

  const start = Date.now();
  config.createSession({
    sessionId,
    tokenHash: token3,
    userId,
    sessionExp: start + config.sessionExpiresIn,
    tokenExp: start + config.tokenExpiresIn,
  });

  config.createToken({
    sessionId,
    tokenHash: token2Hash,
    tokenExp: start + 1000 + config.tokenExpiresIn,
  });

  config.createToken({
    sessionId,
    tokenHash: token1Hash,
    tokenExp: start + 2000 + config.tokenExpiresIn,
  });

  for (const token of [token1Hash, token2Hash, token3]) {
    const tokenHash = await hashToken(token);
    const session = await config.selectSession({ tokenHash });
    if (session === undefined) {
      throw new Error("Session not found");
    }

    if (session.exp !== start + config.sessionExpiresIn) {
      throw new Error("Session expired");
    }

    if (session.tokenExp !== start + 2000 + config.tokenExpiresIn) {
      throw new Error("Token expired");
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
  }

  config.updateSession({
    sessionId,
    sessionExp: start + 3000 + config.sessionExpiresIn,
  });

  for (const token of [token1Hash, token2Hash, token3]) {
    const tokenHash = await hashToken(token);
    const session = await config.selectSession({ tokenHash });
    if (session === undefined) {
      throw new Error("Session not found");
    }

    if (session.exp !== start + 3000 + config.sessionExpiresIn) {
      throw new Error("Session expired");
    }

    if (session.tokenExp !== start + 2000 + config.tokenExpiresIn) {
      throw new Error("Token expired");
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
  }

  config.deleteSession({ tokenHash: token1Hash });
  for (const token of [token1Hash, token2Hash, token3]) {
    const tokenHash = await hashToken(token);
    const session = config.selectSession({ tokenHash });
    if (session !== undefined) {
      throw new Error("Session should not be found");
    }
  }
}

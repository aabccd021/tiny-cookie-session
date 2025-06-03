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
      readonly token1: string;
      readonly token2: string | undefined;
      readonly userId: string;
    };

export type Config = {
  readonly cookieOption?: Omit<CookieOptions, "maxAge">;
  readonly dateNow: () => number;
  readonly sessionExpiresIn: number;
  readonly tokenExpiresIn: number;
  readonly selectSession: (params: { token: string }) =>
    | {
        readonly id: string;
        readonly exp: number;
        readonly tokenExp: number;
        readonly token1: string;
        readonly token2: string | undefined;
        readonly userId: string;
      }
    | undefined;
  readonly createSession: (params: {
    readonly sessionId: string;
    readonly sessionExp: number;
    readonly token: string;
    readonly tokenExp: number;
    readonly userId: string;
  }) => void;
  readonly createToken: (params: {
    readonly sessionId: string;
    readonly token: string;
    readonly tokenExp: number;
  }) => void;
  readonly deleteSession: (params: { token: string }) => void;
  readonly updateSession: (params: {
    readonly sessionId: string;
    readonly sessionExp: number;
  }) => void;
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
  const randomArray = crypto.getRandomValues(new Uint8Array(entropyBits / 8));
  return Buffer.from(randomArray).toString("hex");
}

function createNewTokenCookie(config: Config): [Cookie, string] {
  const token = createRandom256BitHex();

  const cookie: Cookie = [
    encodeURIComponent(token),
    {
      ...defaultCookieOption,
      ...config.cookieOption,
      maxAge: 365 * 24 * 60 * 60 * 1000,
    },
  ];

  return [cookie, token];
}

export function logout(config: Config, { token }: { token: string }): Cookie {
  config.deleteSession({ token });
  return logoutCookie(config);
}

export function login(config: Config, { userId }: { userId: string }): Cookie {
  const sessionId = createRandom256BitHex();
  const [cookie, token] = createNewTokenCookie(config);
  const now = config.dateNow?.() ?? Date.now();
  config.createSession({
    sessionId,
    token,
    userId,
    sessionExp: now + config.sessionExpiresIn,
    tokenExp: now + config.tokenExpiresIn,
  });
  return cookie;
}

export function consumeSession(config: Config, token: string): Session {
  const session = config.selectSession({ token });

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
  // Example:
  // 1. User does request foo with `cookie: token=old_token`.
  // 2. Token `new_token` is created on database, and is the latest token.
  // 3. User does request bar with `cookie: token=old_token`.
  // 4. Response foo with `set-cookie: token=new_token`.
  if (token !== session.token1 && token !== session.token2) {
    config.deleteSession({ token });
    return {
      requireLogout: true,
      reason: "old token",
      cookie: logoutCookie(config),
    };
  }

  const now = config.dateNow?.() ?? Date.now();

  // Session expired, so logout the session.
  if (session.exp < now) {
    config.deleteSession({ token });
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
  if (session.tokenExp <= now && session.token1 === token) {
    const [cookie, newToken] = createNewTokenCookie(config);
    config.createToken({
      sessionId: session.id,
      token: newToken,
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

export function testConfig(
  config: Config,
  { userId }: { userId: string },
): void {
  const sessionId = createRandom256BitHex();
  const token1 = createRandom256BitHex();
  const token2 = createRandom256BitHex();
  const token3 = createRandom256BitHex();

  const start = Date.now();
  config.createSession({
    sessionId,
    token: token3,
    userId,
    sessionExp: start + config.sessionExpiresIn,
    tokenExp: start + config.tokenExpiresIn,
  });

  config.createToken({
    sessionId,
    token: token2,
    tokenExp: start + 1000 + config.tokenExpiresIn,
  });

  config.createToken({
    sessionId,
    token: token1,
    tokenExp: start + 2000 + config.tokenExpiresIn,
  });

  for (const token of [token1, token2, token3]) {
    const session = config.selectSession({ token });
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

    if (session.token1 !== token1) {
      throw new Error("Session token1 does not match");
    }

    if (session.token2 !== token2) {
      throw new Error("Session token2 does not match");
    }
  }

  config.updateSession({
    sessionId,
    sessionExp: start + 3000 + config.sessionExpiresIn,
  });

  for (const token of [token1, token2, token3]) {
    const session = config.selectSession({ token });
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

    if (session.token1 !== token1) {
      throw new Error("Session token1 does not match");
    }

    if (session.token2 !== token2) {
      throw new Error("Session token2 does not match");
    }
  }

  config.deleteSession({ token: token1 });
  for (const token of [token1, token2, token3]) {
    const session = config.selectSession({ token });
    if (session !== undefined) {
      throw new Error("Session should not be found");
    }
  }
}

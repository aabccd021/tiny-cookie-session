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
      readonly reason: "session not found" | "old session" | "session expired";
      readonly cookie: Cookie;
    }
  | {
      readonly requireLogout: false;
      readonly cookie?: Cookie;
      readonly id: string;
      readonly expDate: number;
      readonly tokenExpDate: number;
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
        readonly expDate: number;
        readonly tokenExpDate: number;
        readonly token1: string;
        readonly token2: string | undefined;
        readonly userId: string;
      }
    | undefined;
  readonly createSession: (params: {
    readonly sessionId: string;
    readonly sessionExpDate: number;
    readonly token: string;
    readonly tokenExpDate: number;
    readonly userId: string;
  }) => void;
  readonly createToken: (params: {
    readonly sessionId: string;
    readonly token: string;
    readonly tokenExpDate: number;
  }) => void;
  readonly deleteSession: (params: { token: string }) => void;
  readonly updateSession: (params: {
    readonly sessionId: string;
    readonly sessionExpDate: number;
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

function getRandom32bytes(): string {
  // remix uses 8 bytes (64 bits) of entropy
  // https://github.com/remix-run/remix/blob/b7d280140b27507530bcd66f7b30abe3e9d76436/packages/remix-node/sessions/fileStorage.ts#L45

  // owasp recommends at least 8 bytes (64 bits) of entropy
  // https://owasp.org/www-community/vulnerabilities/Insufficient_Session-ID_Length

  // lucia uses 20 bytes (160 bits) of entropy in their sqlite example
  // https://github.com/lucia-auth/lucia/blob/46b164f78dc7983d7a4c3fb184505a01a4939efd/pages/sessions/basic-api/sqlite.md?plain=1#L88

  // auth.js uses 32 bytes (256 bits) of entropy in their test
  // https://github.com/nextauthjs/next-auth/blob/c5a70d383bb97b39f8edbbaf69c4c7620246e9a4/packages/core/test/actions/session.test.ts#L146

  const entropy = 32;

  const randomArray = crypto.getRandomValues(new Uint8Array(entropy));

  // auth.js uses hex encoding
  // https://github.com/nextauthjs/next-auth/blob/c5a70d383bb97b39f8edbbaf69c4c7620246e9a4/packages/core/src/lib/utils/web.ts#L108

  // remix uses hex encoding
  // https://github.com/remix-run/remix/blob/b7d280140b27507530bcd66f7b30abe3e9d76436/packages/remix-node/sessions/fileStorage.ts#L50

  // lucia uses base32 encoding
  // https://github.com/lucia-auth/lucia/blob/46b164f78dc7983d7a4c3fb184505a01a4939efd/pages/sessions/basic-api/sqlite.md?plain=1#L88
  return Buffer.from(randomArray).toString("hex");
}

function createNewToken(config: Config): [Cookie, string] {
  const token = getRandom32bytes();

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

export function logout(config: Config, token: string): Cookie {
  config.deleteSession({ token });
  return logoutCookie(config);
}

export function login(config: Config, userId: string): Cookie {
  const sessionId = getRandom32bytes();
  const [cookie, token] = createNewToken(config);
  const now = config.dateNow?.() ?? Date.now();
  config.createSession({
    sessionId,
    token,
    userId,
    sessionExpDate: now + config.sessionExpiresIn,
    tokenExpDate: now + config.tokenExpiresIn,
  });
  return cookie;
}

export function consumeSession(config: Config, token: string): Session {
  const session = config.selectSession({ token });
  if (session === undefined) {
    // logout the user when the session does not exist
    // the deletion might caused by the session explicitly deleted on the server side
    return {
      requireLogout: true,
      reason: "session not found",
      cookie: logoutCookie(config),
    };
  }

  if (token !== session.token1 && token !== session.token2) {
    config.deleteSession({ token });
    return {
      requireLogout: true,
      reason: "old session",
      cookie: logoutCookie(config),
    };
  }

  const now = config.dateNow?.() ?? Date.now();

  if (session.expDate < now) {
    config.deleteSession({ token });
    return {
      requireLogout: true,
      reason: "session expired",
      cookie: logoutCookie(config),
    };
  }

  const sessionRefreshDate = session.expDate - config.sessionExpiresIn / 2;
  if (sessionRefreshDate < now) {
    config.updateSession({
      sessionId: session.id,
      sessionExpDate: now + config.sessionExpiresIn,
    });
  }

  if (session.tokenExpDate <= now && session.token1 === token) {
    const [cookie, newToken] = createNewToken(config);
    config.createToken({
      sessionId: session.id,
      token: newToken,
      tokenExpDate: now + config.tokenExpiresIn,
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

export function testConfig(config: Config): void {
  const sessionId = getRandom32bytes();
  const token1 = getRandom32bytes();
  const token2 = getRandom32bytes();
  const token3 = getRandom32bytes();
  const userId = getRandom32bytes();

  const start = Date.now();
  config.createSession({
    sessionId,
    token: token3,
    userId,
    sessionExpDate: start + config.sessionExpiresIn,
    tokenExpDate: start + config.tokenExpiresIn,
  });

  config.createToken({
    sessionId,
    token: token2,
    tokenExpDate: start + 1000 + config.tokenExpiresIn,
  });

  config.createToken({
    sessionId,
    token: token1,
    tokenExpDate: start + 2000 + config.tokenExpiresIn,
  });

  for (const token of [token1, token2, token3]) {
    const session = config.selectSession({ token });
    if (session === undefined) {
      throw new Error("Session not found");
    }

    if (session.expDate !== start + config.sessionExpiresIn) {
      throw new Error("Session expired");
    }

    if (session.tokenExpDate !== start + 2000 + config.tokenExpiresIn) {
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
    sessionExpDate: start + 3000 + config.sessionExpiresIn,
  });

  for (const token of [token1, token2, token3]) {
    const session = config.selectSession({ token });
    if (session === undefined) {
      throw new Error("Session not found");
    }

    if (session.expDate !== start + 3000 + config.sessionExpiresIn) {
      throw new Error("Session expired");
    }

    if (session.tokenExpDate !== start + 2000 + config.tokenExpiresIn) {
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

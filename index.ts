export type CookieOptions = {
  readonly maxAge?: number;
  readonly domain?: string;
  readonly path?: string;
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
  readonly sameSite?: "strict" | "lax" | "none";
};

export type Cookie = readonly [string, CookieOptions];

export interface Config<D = undefined> {
  readonly cookieOption?: Omit<CookieOptions, "maxAge">;
  readonly dateNow: () => number;
  readonly sessionExpiresIn: number;
  readonly tokenExpiresIn: number;
  readonly selectSession: (params: { token: string }) =>
    | {
        readonly id: string;
        readonly expirationDate: number;
        readonly tokenExpirationDate: number;
        readonly token1: string;
        readonly token2: string | undefined;
        readonly data: D;
      }
    | undefined;
  readonly createSession: (params: {
    readonly sessionId: string;
    readonly sessionExpirationDate: number;
    readonly token: string;
    readonly tokenExpirationDate: number;
    readonly data: D;
  }) => void;
  readonly createToken: (params: {
    readonly sessionId: string;
    readonly token: string;
    readonly tokenExpirationDate: number;
  }) => void;
  readonly deleteSession: (params: { token: string }) => void;
  readonly updateSession: (params: {
    readonly sessionId: string;
    readonly sessionExpirationDate: number;
  }) => void;
}

export const defaultConfig = {
  dateNow: (): number => Date.now(),
  sessionExpiresIn: 30 * 24 * 60 * 60 * 1000,
  tokenExpiresIn: 10 * 60 * 1000,
} satisfies Partial<Config>;

const defaultCookieOption: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  secure: true,
};

function logoutCookie<D>(config: Config<D>): Cookie {
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

function createNewToken<D>(config: Config<D>): [Cookie, string] {
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

export function logout<D>(config: Config<D>, token: string): Cookie {
  config.deleteSession({ token });
  return logoutCookie(config);
}

export function login<D>(config: Config<D>, data: D): Cookie {
  const sessionId = getRandom32bytes();
  const [cookie, token] = createNewToken(config);
  const now = config.dateNow?.() ?? Date.now();
  config.createSession({
    sessionId,
    token,
    data,
    sessionExpirationDate: now + config.sessionExpiresIn,
    tokenExpirationDate: now + config.tokenExpiresIn,
  });
  return cookie;
}

export type Session<D> =
  | {
      readonly requireLogout: true;
      readonly reason: "session not found" | "old session" | "session expired";
      readonly cookie: Cookie;
    }
  | {
      readonly requireLogout: false;
      readonly cookie?: Cookie;
      readonly id: string;
      readonly expirationDate: number;
      readonly tokenExpirationDate: number;
      readonly token1: string;
      readonly token2: string | undefined;
      readonly data: D;
    };

export function consumeSession<D>(
  config: Config<D>,
  token: string,
): Session<D> {
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

  if (session.expirationDate < now) {
    config.deleteSession({ token });
    return {
      requireLogout: true,
      reason: "session expired",
      cookie: logoutCookie(config),
    };
  }

  const sessionRefreshDate =
    session.expirationDate - config.sessionExpiresIn / 2;
  if (sessionRefreshDate < now) {
    config.updateSession({
      sessionId: session.id,
      sessionExpirationDate: now + config.sessionExpiresIn,
    });
  }

  if (session.tokenExpirationDate <= now && session.token1 === token) {
    const [cookie, newToken] = createNewToken(config);
    config.createToken({
      sessionId: session.id,
      token: newToken,
      tokenExpirationDate: now + config.tokenExpiresIn,
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

import { getRandomValues } from "node:crypto";
import {
  type SerializeOptions,
  parse as parseCookie,
  serialize as serializeCookie,
} from "@tinyhttp/cookie";

type Session = {
  readonly id: string;
  readonly expirationDate: number;
};

export type Token = {
  readonly value: string;
  readonly used: boolean;
  readonly expirationDate: number;
};

export interface Config<I, S extends Session = Session> {
  readonly cookieOption?: SerializeOptions;
  readonly tokenCookieName: string;
  readonly dateNow: () => number;
  readonly sessionExpiresIn: number;
  readonly tokenExpiresIn: number;
  readonly selectSession: (token: string) =>
    | {
        readonly newestToken: Token;
        readonly secondNewestToken: Token | undefined;
        readonly session: NonNullable<S>;
      }
    | undefined;
  readonly setTokenUsed: (token: string) => void;
  readonly createSession: (params: {
    readonly sessionId: string;
    readonly sessionExpirationDate: number;
    readonly token: string;
    readonly tokenExpirationDate: number;
    readonly insertData: I;
  }) => void;
  readonly createToken: (params: {
    readonly sessionId: string;
    readonly token: string;
    readonly tokenExpirationDate: number;
  }) => void;

  readonly deleteSession: (token: string) => void;
  readonly updateSessionExpirationDate: (params: {
    readonly sessionId: string;
    readonly sessionExpirationDate: number;
  }) => void;
}

export const defaultConfig: Pick<
  Config<unknown>,
  "tokenCookieName" | "dateNow" | "sessionExpiresIn" | "tokenExpiresIn"
> = {
  tokenCookieName: "session_id",
  dateNow: () => Date.now(),
  sessionExpiresIn: 30 * 24 * 60 * 60 * 1000,
  tokenExpiresIn: 10 * 60 * 1000,
};

const defaultCookieOption: SerializeOptions = {
  httpOnly: true,
  sameSite: "Lax",
  path: "/",
};

function logoutCookie<I, S extends Session = Session>(
  config: Config<I, S>,
): string {
  return serializeCookie(config.tokenCookieName, "", {
    ...config.cookieOption,
    ...defaultCookieOption,
    maxAge: 0,
  });
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

  const randomArray = getRandomValues(new Uint8Array(entropy));

  // auth.js uses hex encoding
  // https://github.com/nextauthjs/next-auth/blob/c5a70d383bb97b39f8edbbaf69c4c7620246e9a4/packages/core/src/lib/utils/web.ts#L108

  // remix uses hex encoding
  // https://github.com/remix-run/remix/blob/b7d280140b27507530bcd66f7b30abe3e9d76436/packages/remix-node/sessions/fileStorage.ts#L50

  // lucia uses base32 encoding
  // https://github.com/lucia-auth/lucia/blob/46b164f78dc7983d7a4c3fb184505a01a4939efd/pages/sessions/basic-api/sqlite.md?plain=1#L88
  return Buffer.from(randomArray).toString("hex");
}

function loginCookie<I, S extends Session = Session>(
  config: Config<I, S>,
): [string, string] {
  const token = getRandom32bytes();

  const cookie = serializeCookie(
    config.tokenCookieName,
    encodeURIComponent(token),
    {
      ...config.cookieOption,
      ...defaultCookieOption,
      maxAge: 365 * 24 * 60 * 60 * 1000,
    },
  );

  return [cookie, token];
}

export function getToken<I, S extends Session = Session>(
  config: Config<I, S>,
  req: Request,
): string | undefined {
  const cookieHeader = req.headers.get("Cookie");
  if (cookieHeader === null) {
    return undefined;
  }

  const cookies = parseCookie(cookieHeader);
  return cookies[config.tokenCookieName];
}

export function logout<I, S extends Session = Session>(
  config: Config<I, S>,
  req: Request,
): readonly [string] {
  const token = getToken(config, req);
  if (token !== undefined) {
    config.deleteSession(token);
  }
  return [logoutCookie(config)];
}

export function login<I, S extends Session = Session>(
  config: Config<I, S>,
  insertData: I,
): readonly [string] {
  const sessionId = getRandom32bytes();
  const [cookie, token] = loginCookie(config);

  const now = config.dateNow?.() ?? Date.now();
  config.createSession({
    sessionId,
    sessionExpirationDate: now + config.sessionExpiresIn,
    token,
    tokenExpirationDate: now + config.tokenExpiresIn,
    insertData,
  });
  return [cookie];
}

export function hasSessionCookie<I, S extends Session = Session>(
  config: Config<I, S>,
  req: Request,
): boolean {
  const cookieHeader = req.headers.get("Cookie");
  if (cookieHeader === null) {
    return false;
  }

  const cookies = parseCookie(cookieHeader);
  return config.tokenCookieName in cookies;
}

// token2 used, token1     used, token2 req -> logout
// token2 used, token1 not used, token2 req -> normal
// token2 used, token1     used, token1 req -> normal
// token2 used, token1 not used, token1 req -> normal

function getRequestToken(
  newestToken: Token,
  secondNewestToken: Token | undefined,
  value: string,
):
  | {
      readonly value: Token;
      readonly index: 1 | 2;
    }
  | undefined {
  if (newestToken.value === value) {
    return { value: newestToken, index: 1 };
  }
  if (secondNewestToken?.value === value) {
    return { value: secondNewestToken, index: 2 };
  }
  return undefined;
}

export function consumeSession<I, S extends Session = Session>(
  config: Config<I, S>,
  req: Request,
): readonly [string | undefined, NonNullable<S> | undefined] {
  const tokenValue = getToken(config, req);
  if (tokenValue === undefined) {
    return [undefined, undefined];
  }

  const sessionResult = config.selectSession(tokenValue);
  if (sessionResult === undefined) {
    return [undefined, undefined];
  }

  const now = config.dateNow?.() ?? Date.now();

  const { session, newestToken, secondNewestToken } = sessionResult;
  if (session.expirationDate < now) {
    config.deleteSession(tokenValue);
    return [logoutCookie(config), undefined];
  }

  const requestToken = getRequestToken(
    newestToken,
    secondNewestToken,
    tokenValue,
  );
  if (requestToken === undefined) {
    throw new Error("Absurd: Token neither newest nor second newest");
  }

  if (requestToken.index === 2 && newestToken.used) {
    console.error(
      "Potential security threat: Older token is used after newer one",
    );
    config.deleteSession(tokenValue);
    return [logoutCookie(config), undefined];
  }

  if (!requestToken.value.used) {
    if (requestToken.index === 1) {
      config.setTokenUsed(tokenValue);
    }

    if (requestToken.index === 2) {
      throw new Error("Absurd: second newest token never used");
    }
  }

  const sessionRefreshDate =
    session.expirationDate - config.sessionExpiresIn / 2;
  if (sessionRefreshDate < now) {
    config.updateSessionExpirationDate({
      sessionId: session.id,
      sessionExpirationDate: now + config.sessionExpiresIn,
    });
  }

  if (requestToken.value.expirationDate < now) {
    const [cookie, newToken] = loginCookie(config);
    config.createToken({
      sessionId: session.id,
      token: newToken,
      tokenExpirationDate: now + config.tokenExpiresIn,
    });
    return [cookie, session];
  }
  return [undefined, session];
}

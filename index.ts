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

export interface Config<S extends Session = Session, I = unknown> {
  readonly cookieOption?: SerializeOptions;
  readonly tokenCookieName: string;
  readonly dateNow: () => number;
  readonly sessionExpiresIn: number;
  readonly tokenExpiresIn: number;
  readonly selectSession: (token: string) =>
    | {
        readonly token1: Token;
        readonly token2: Token | undefined;
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
  readonly deleteSessionByToken: (token: string) => void;
  readonly deleteSessionById: (sessionId: string) => void;
  readonly setSessionExpirationDate: (params: {
    readonly sessionId: string;
    readonly sessionExpirationDate: number;
  }) => void;
}

export const defaultConfig: Pick<
  Config,
  "tokenCookieName" | "dateNow" | "sessionExpiresIn" | "tokenExpiresIn"
> = {
  tokenCookieName: "access_token",
  dateNow: () => Date.now(),
  sessionExpiresIn: 30 * 24 * 60 * 60 * 1000,
  tokenExpiresIn: 10 * 60 * 1000,
};

const defaultCookieOption: SerializeOptions = {
  httpOnly: true,
  sameSite: "Lax",
  path: "/",
};

function logoutCookie<S extends Session = Session, I = unknown>(
  config: Config<S, I>,
): string {
  return serializeCookie(config.tokenCookieName, "", {
    ...defaultCookieOption,
    ...config.cookieOption,
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

function createNewToken<S extends Session = Session, I = unknown>(
  config: Config<S, I>,
): [string, string] {
  const token = getRandom32bytes();

  const cookie = serializeCookie(
    config.tokenCookieName,
    encodeURIComponent(token),
    {
      ...defaultCookieOption,
      ...config.cookieOption,
      maxAge: 365 * 24 * 60 * 60 * 1000,
    },
  );

  return [cookie, token];
}

export function parseToken<S extends Session = Session, I = unknown>(
  config: Config<S, I>,
  cookieHeader: string | null | undefined,
): string | undefined {
  if (cookieHeader === null || cookieHeader === undefined) {
    return undefined;
  }
  const cookies = parseCookie(cookieHeader);
  return cookies[config.tokenCookieName];
}

export function logout<S extends Session = Session, I = unknown>(
  config: Config<S, I>,
  cookieHeader: string | null | undefined,
): readonly [string] {
  const token = parseToken(config, cookieHeader);
  if (token !== undefined) {
    config.deleteSessionByToken(token);
  }
  return [logoutCookie(config)];
}

export function login<S extends Session = Session, I = unknown>(
  config: Config<S, I>,
  insertData: I,
): readonly [string] {
  const sessionId = getRandom32bytes();
  const [cookie, token] = createNewToken(config);

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

export function hasSessionCookie<S extends Session = Session, I = unknown>(
  config: Config<S, I>,
  cookieHeader: string | null | undefined,
): boolean {
  if (cookieHeader === null || cookieHeader === undefined) {
    return false;
  }

  const cookies = parseCookie(cookieHeader);
  return config.tokenCookieName in cookies;
}

function getRequestToken(
  token1: Token,
  token2: Token | undefined,
  value: string,
):
  | {
      readonly value: Token;
      readonly index: 1 | 2;
    }
  | undefined {
  if (token1.value === value) {
    return { value: token1, index: 1 };
  }
  if (token2?.value === value) {
    return { value: token2, index: 2 };
  }
  return undefined;
}

export function consumeSession<S extends Session = Session, I = unknown>(
  config: Config<S, I>,
  cookieHeader: string | null | undefined,
): readonly [string | undefined, NonNullable<S> | undefined] {
  const tokenValue = parseToken(config, cookieHeader);
  if (tokenValue === undefined) {
    return [undefined, undefined];
  }

  const sessionResult = config.selectSession(tokenValue);
  if (sessionResult === undefined) {
    return [undefined, undefined];
  }

  const now = config.dateNow?.() ?? Date.now();

  const { session, token1, token2 } = sessionResult;

  if (session.expirationDate < now) {
    config.deleteSessionById(session.id);
    return [logoutCookie(config), undefined];
  }

  const requestToken = getRequestToken(token1, token2, tokenValue);
  if (
    requestToken === undefined ||
    (!requestToken.value.used && requestToken.index === 2)
  ) {
    console.error("Potential cookie theft: There are two unused tokens");
    config.deleteSessionById(session.id);
    return [logoutCookie(config), undefined];
  }

  if (requestToken.index === 2 && token1.used) {
    console.error(
      "Potential cookie theft: Older token is used after newer one",
    );
    config.deleteSessionById(session.id);
    return [logoutCookie(config), undefined];
  }

  if (!requestToken.value.used && requestToken.index === 1) {
    config.setTokenUsed(tokenValue);
  }

  const sessionRefreshDate =
    session.expirationDate - config.sessionExpiresIn / 2;
  if (sessionRefreshDate < now) {
    config.setSessionExpirationDate({
      sessionId: session.id,
      sessionExpirationDate: now + config.sessionExpiresIn,
    });
  }

  // Make sure only create new token when the latest token is already used.
  // This case might happen when two concurrent requests are made
  if (token1.expirationDate < now) {
    const [cookie, newToken] = createNewToken(config);
    config.createToken({
      sessionId: session.id,
      token: newToken,
      tokenExpirationDate: now + config.tokenExpiresIn,
    });
    return [cookie, session];
  }
  return [undefined, session];
}

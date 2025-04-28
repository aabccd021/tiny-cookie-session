import { getRandomValues } from "node:crypto";
import {
  type SerializeOptions,
  parse as parseCookie,
  serialize as serializeCookie,
} from "@tinyhttp/cookie";

type Session<D = unknown> = {
  readonly id: string;
  readonly expirationDate: number;
  readonly tokenExpirationDate: number;
  readonly token1: string;
  readonly token2: string | undefined;
  readonly data: D;
};

export interface Config<D = unknown, I = unknown> {
  readonly cookieOption?: SerializeOptions;
  readonly tokenCookieName: string;
  readonly dateNow: () => number;
  readonly sessionExpiresIn: number;
  readonly tokenExpiresIn: number;
  readonly selectSession: (token: string) => Session<D> | undefined;
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

function logoutCookie<D = unknown, I = unknown>(config: Config<D, I>): string {
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

function createNewToken<D = unknown, I = unknown>(
  config: Config<D, I>,
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

export function parseToken<D = unknown, I = unknown>(
  config: Config<D, I>,
  cookieHeader: string | null | undefined,
): string | undefined {
  if (cookieHeader === null || cookieHeader === undefined) {
    return undefined;
  }
  const cookies = parseCookie(cookieHeader);
  return cookies[config.tokenCookieName];
}

export function logout<D = unknown, I = unknown>(
  config: Config<D, I>,
  cookieHeader: string | null | undefined,
): readonly [string] {
  const token = parseToken(config, cookieHeader);
  if (token !== undefined) {
    config.deleteSessionByToken(token);
  }
  return [logoutCookie(config)];
}

export function login<D = unknown, I = unknown>(
  config: Config<D, I>,
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

export function hasSessionCookie<D = unknown, I = unknown>(
  config: Config<D, I>,
  cookieHeader: string | null | undefined,
): boolean {
  if (cookieHeader === null || cookieHeader === undefined) {
    return false;
  }

  const cookies = parseCookie(cookieHeader);
  return config.tokenCookieName in cookies;
}

export function consumeSession<D = unknown, I = unknown>(
  config: Config<D, I>,
  cookieHeader: string | null | undefined,
): readonly [string | undefined, Session<D> | undefined] {
  const reqToken = parseToken(config, cookieHeader);
  if (reqToken === undefined) {
    return [undefined, undefined];
  }

  const session = config.selectSession(reqToken);
  if (session === undefined) {
    // logout the user when the session does not exist
    // the deletion might caused by the session explicitly deleted on the server side
    return [logoutCookie(config), undefined];
  }

  if (reqToken !== session.token1 && reqToken !== session.token2) {
    config.deleteSessionById(session.id);
    return [logoutCookie(config), undefined];
  }

  const now = config.dateNow?.() ?? Date.now();

  if (session.expirationDate < now) {
    config.deleteSessionById(session.id);
    return [logoutCookie(config), undefined];
  }

  const sessionRefreshDate =
    session.expirationDate - config.sessionExpiresIn / 2;
  if (sessionRefreshDate < now) {
    config.setSessionExpirationDate({
      sessionId: session.id,
      sessionExpirationDate: now + config.sessionExpiresIn,
    });
  }

  if (session.tokenExpirationDate <= now && session.token1 === reqToken) {
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

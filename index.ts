import { getRandomValues } from "node:crypto";
import {
  type SerializeOptions,
  parse as parseCookie,
  serialize as serializeCookie,
} from "@tinyhttp/cookie";

type Session = {
  readonly id: string;
  readonly exp: number;
};

export type TokenData<S extends Session = Session> = {
  readonly session: NonNullable<S>;
  readonly isLastToken: boolean;
  readonly exp: number;
};

export interface Config<S extends Session = Session, I = unknown> {
  readonly cookieOption?: SerializeOptions;
  readonly tokenCookieName: string;
  readonly dateNow: () => number;
  readonly sessionExpiresIn: number;
  readonly tokenExpiresIn: number;
  readonly getTokenDetails: (token: string) => TokenData<S> | undefined;
  readonly createSession: (params: {
    readonly sessionId: string;
    readonly sessionExp: number;
    readonly token: string;
    readonly tokenExp: number;
    readonly insertData: I;
  }) => void;
  readonly insertOrReplaceToken: (params: {
    readonly sessionId: string;
    readonly token: string;
    readonly tokenExp: number;
  }) => void;
  readonly deleteSessionByToken: (token: string) => void;
  readonly deleteSessionById: (sessionId: string) => void;
  readonly setSessionExp: (params: {
    readonly sessionId: string;
    readonly sessionExp: number;
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
    sessionExp: now + config.sessionExpiresIn,
    token,
    tokenExp: now + config.tokenExpiresIn,
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

export function consumeSession<S extends Session = Session, I = unknown>(
  config: Config<S, I>,
  cookieHeader: string | null | undefined,
): readonly [string | undefined, TokenData<S> | undefined] {
  const tokenValue = parseToken(config, cookieHeader);
  if (tokenValue === undefined) {
    return [undefined, undefined];
  }

  const tokenData = config.getTokenDetails(tokenValue);
  if (tokenData === undefined) {
    return [undefined, undefined];
  }

  const { session, isLastToken } = tokenData;

  const now = config.dateNow?.() ?? Date.now();

  if (session.exp < now) {
    config.deleteSessionById(session.id);
    return [logoutCookie(config), undefined];
  }

  if (!isLastToken) {
    console.error(
      "Potential cookie theft: the token used is neither latest nor second latest",
    );
    config.deleteSessionById(session.id);
    return [logoutCookie(config), undefined];
  }

  const sessionRefreshDate = session.exp - config.sessionExpiresIn / 2;
  if (sessionRefreshDate < now) {
    config.setSessionExp({
      sessionId: session.id,
      sessionExp: now + config.sessionExpiresIn,
    });
  }

  return [undefined, tokenData];
}

export function extendToken<S extends Session = Session, I = unknown>(
  config: Config<S, I>,
  token: TokenData<S>,
): readonly [string | undefined] {
  const now = config.dateNow?.() ?? Date.now();
  if (token.exp >= now) {
    return [undefined];
  }

  const [cookie, newToken] = createNewToken(config);
  config.insertOrReplaceToken({
    sessionId: token.session.id,
    token: newToken,
    tokenExp: now + config.tokenExpiresIn,
  });
  return [cookie];
}

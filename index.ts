import { getRandomValues } from "node:crypto";
import {
  type SerializeOptions,
  parse as parseCookie,
  serialize as serializeCookie,
} from "@tinyhttp/cookie";

export interface Config<S, I> {
  readonly cookieOption?: SerializeOptions;
  readonly sessionCookieName: string;
  readonly dateNow: () => number;
  readonly expiresIn: number;
  readonly getExpiresAt: (session: S) => number;
  readonly selectSession: (sessionId: string) => NonNullable<S> | undefined;
  readonly insertSession: (
    sessionId: string,
    expiresAt: number,
    insertData: I,
  ) => void;
  readonly deleteSession: (sessionId: string) => void;
  readonly updateSession: (sessionId: string, expiresAt: number) => void;
  readonly getRefreshDate?: (session: S) => number;
}

export const defaultConfig: Pick<
  Config<unknown, unknown>,
  "sessionCookieName" | "dateNow" | "expiresIn"
> = {
  sessionCookieName: "session_id",
  dateNow: () => Date.now(),
  expiresIn: 30 * 24 * 60 * 60 * 1000,
};

const defaultCookieOption: SerializeOptions = {
  httpOnly: true,
  sameSite: "Lax",
  path: "/",
};
const logoutCookieOption: SerializeOptions = {
  ...defaultCookieOption,
  maxAge: 0,
};

function createLogoutCookie<S, I>(config: Config<S, I>): string {
  return serializeCookie(config.sessionCookieName, "", {
    ...config.cookieOption,
    ...logoutCookieOption,
  });
}

function sessionIdFromReq<S, I>(
  config: Config<S, I>,
  req: Request,
): string | undefined {
  const cookieHeader = req.headers.get("Cookie");
  if (cookieHeader === null) {
    return undefined;
  }

  const cookies = parseCookie(cookieHeader);
  return cookies[config.sessionCookieName];
}

export function logout<S, I>(
  config: Config<S, I>,
  req: Request,
): readonly [string] {
  const sessionId = sessionIdFromReq(config, req);
  const cookie = createLogoutCookie(config);
  if (sessionId !== undefined) {
    config.deleteSession(sessionId);
  }
  return [cookie];
}

function createLoginCookie<S, I>(
  config: Config<S, I>,
  sessionId: string,
): { readonly expiresAt: number; readonly cookie: string } {
  const now = config.dateNow?.() ?? Date.now();
  const expiresIn = config.expiresIn;
  const expiresAt = now + expiresIn;

  const encodedSessionId = encodeURIComponent(sessionId);

  const cookie = serializeCookie(config.sessionCookieName, encodedSessionId, {
    ...config.cookieOption,
    ...defaultCookieOption,
    maxAge: 365 * 24 * 60 * 60 * 1000,
  });
  return { expiresAt, cookie };
}

export function login<S, I>(
  config: Config<S, I>,
  insertData: I,
): readonly [string] {
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
  const sessionId = Buffer.from(randomArray).toString("hex");

  const { cookie, expiresAt } = createLoginCookie(config, sessionId);
  config.insertSession(sessionId, expiresAt, insertData);
  return [cookie];
}

export function hasSessionCookie<S, I>(
  config: Config<S, I>,
  req: Request,
): boolean {
  const cookieHeader = req.headers.get("Cookie");
  if (cookieHeader === null) {
    return false;
  }

  const cookies = parseCookie(cookieHeader);
  return config.sessionCookieName in cookies;
}

export function consumeSession<S, I>(
  config: Config<S, I>,
  req: Request,
): readonly [string | undefined, NonNullable<S> | undefined] {
  const sessionId = sessionIdFromReq(config, req);
  if (sessionId === undefined) {
    return [createLogoutCookie(config), undefined];
  }

  const session = config.selectSession(sessionId);
  if (session === undefined) {
    return [createLogoutCookie(config), undefined];
  }

  const nowMs = config.dateNow?.() ?? Date.now();
  const sessionExpiresAt = config.getExpiresAt(session);
  if (sessionExpiresAt < nowMs) {
    config.deleteSession(sessionId);
    return [createLogoutCookie(config), undefined];
  }

  const refreshDate = sessionExpiresAt - config.expiresIn / 2;
  if (refreshDate < nowMs) {
    const { cookie, expiresAt } = createLoginCookie(config, sessionId);
    config.updateSession(sessionId, expiresAt);
    return [cookie, session];
  }

  return [undefined, session];
}

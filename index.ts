import { getRandomValues } from "node:crypto";
import {
  type SerializeOptions,
  parse as parseCookie,
  serialize as serializeCookie,
} from "@tinyhttp/cookie";

type Session = {
  readonly expirationDate: number;
};

export interface Config<I, S extends Session = Session> {
  readonly cookieOption?: SerializeOptions;
  readonly sessionCookieName: string;
  readonly dateNow: () => number;
  readonly expiresIn: number;
  readonly selectSession: (id: string) => NonNullable<S> | undefined;
  readonly insertSession: (
    id: string,
    expirationDate: number,
    insertData: I,
  ) => void;
  readonly deleteSession: (id: string) => void;
  readonly updateSession: (id: string, expirationDate: number) => void;
}

export const defaultConfig: Pick<
  Config<unknown>,
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

function logoutCookie<I, S extends Session = Session>(
  config: Config<I, S>,
): string {
  return serializeCookie(config.sessionCookieName, "", {
    ...config.cookieOption,
    ...defaultCookieOption,
    maxAge: 0,
  });
}

export function getSessionId<I, S extends Session = Session>(
  config: Config<I, S>,
  req: Request,
): string | undefined {
  const cookieHeader = req.headers.get("Cookie");
  if (cookieHeader === null) {
    return undefined;
  }

  const cookies = parseCookie(cookieHeader);
  return cookies[config.sessionCookieName];
}

export function logout<I, S extends Session = Session>(
  config: Config<I, S>,
  req: Request,
): readonly [string] {
  const id = getSessionId(config, req);
  if (id !== undefined) {
    config.deleteSession(id);
  }
  return [logoutCookie(config)];
}

export function login<I, S extends Session = Session>(
  config: Config<I, S>,
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
  const id = Buffer.from(randomArray).toString("hex");

  const cookie = serializeCookie(
    config.sessionCookieName,
    encodeURIComponent(id),
    {
      ...config.cookieOption,
      ...defaultCookieOption,
      maxAge: 365 * 24 * 60 * 60 * 1000,
    },
  );

  const now = config.dateNow?.() ?? Date.now();
  const expirationDate = now + config.expiresIn;
  config.insertSession(id, expirationDate, insertData);
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
  return config.sessionCookieName in cookies;
}

export function consumeSession<I, S extends Session = Session>(
  config: Config<I, S>,
  req: Request,
): readonly [string | undefined, NonNullable<S> | undefined] {
  const id = getSessionId(config, req);
  if (id === undefined) {
    return [logoutCookie(config), undefined];
  }

  const session = config.selectSession(id);
  if (session === undefined) {
    return [logoutCookie(config), undefined];
  }

  const now = config.dateNow?.() ?? Date.now();
  if (session.expirationDate < now) {
    config.deleteSession(id);
    return [logoutCookie(config), undefined];
  }

  const refreshDate = session.expirationDate - config.expiresIn / 2;
  if (refreshDate < now) {
    const sessionExpirationDate = now + config.expiresIn;
    config.updateSession(id, sessionExpirationDate);
    return [undefined, session];
  }

  return [undefined, session];
}

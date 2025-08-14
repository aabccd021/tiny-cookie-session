export type CookieOptions = {
  maxAge?: number;
  expires?: Date;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "strict" | "lax" | "none";
};

export type Cookie = {
  value: string;
  options: CookieOptions;
};

export type SessionSelect<S> = {
  id: string;
  exp: Date;
  tokenExp: Date;
  data: S;
  latestTokenHash: readonly [string, string | undefined];
};

export type NotFoundSession<_S> = {
  state: "NotFound";
  cookie: Cookie;
};

export type TokenStolenSession<S> = {
  state: "TokenStolen";
  cookie: Cookie;
  id: string;
  exp: Date;
  tokenExp: Date;
  data: S;
};

export type ExpiredSession<S> = {
  state: "Expired";
  cookie: Cookie;
  id: string;
  exp: Date;
  tokenExp: Date;
  data: S;
};

export type TokenRotatedSession<S> = {
  state: "TokenRotated";
  cookie: Cookie;
  id: string;
  exp: Date;
  tokenExp: Date;
  data: S;
};

export type ActiveSession<S> = {
  state: "Active";
  id: string;
  exp: Date;
  tokenExp: Date;
  data: S;
};

export type Session<S> =
  | NotFoundSession<S>
  | TokenStolenSession<S>
  | ExpiredSession<S>
  | TokenRotatedSession<S>
  | ActiveSession<S>;

export type Config<S, I> = {
  dateNow?: () => Date;
  sessionExpiresIn: number;
  tokenExpiresIn: number;
  selectSession: (arg: { tokenHash: string }) => Promise<SessionSelect<S> | undefined>;
  insertSession: (arg: {
    id: string;
    exp: Date;
    tokenHash: string;
    tokenExp: Date;
    data: I;
  }) => Promise<void>;
  updateSession: (arg: {
    id: string;
    exp: Date;
    tokenExp: Date;
    tokenHash: string;
  }) => Promise<void>;
  deleteSession: (arg: { tokenHash: string }) => Promise<void>;
};
type logout = <S, I>(
  config: Config<S, I>,
  arg: {
    token: string;
  },
) => Promise<Cookie>;
export const logout: logout;

type login = <S, I>(
  config: Config<S, I>,
  arg: {
    data: I;
    id: string;
  },
) => Promise<Cookie>;
export const login: login;

type consumeSession = <S, I>(
  config: Config<S, I>,
  arg: {
    token: string;
  },
) => Promise<Session<S>>;

export const consumeSession: consumeSession;

type testConfig = <S, I>(
  config: Config<S, I>,
  argSessions: {
    data: I;
    id: string;
  }[],
) => Promise<void>;
export const testConfig: testConfig;

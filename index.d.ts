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

export type Config = {
  readonly dateNow?: () => Date;
  readonly sessionExpiresIn?: number;
  readonly tokenExpiresIn?: number;
};

type Credentials = {
  readonly id: string;
  readonly idHash: string;
  readonly token: string;
};

export type Action =
  | {
      readonly type: "insert";
      readonly idHash: string;
      readonly exp: Date;
      readonly oddTokenHash: string;
      readonly tokenExp: Date;
      readonly isLatestTokenOdd: boolean;
    }
  | {
      readonly type: "update";
      readonly idHash: string;
      readonly exp: Date;
      readonly oddTokenHash?: string;
      readonly evenTokenHash?: string;
      readonly tokenExp: Date;
      readonly isLatestTokenOdd: boolean;
    }
  | {
      readonly type: "delete";
      readonly idHash: string;
    };

type hash = (token: string) => Promise<string>;

type logout = (arg: { readonly credentials: Credentials }) => Promise<{
  readonly cookie: Cookie;
  readonly action: Action;
}>;
export const logout: logout;

type login = (arg: { config?: Config }) => Promise<{
  readonly cookie: Cookie;
  readonly action: Action;
}>;
export const login: login;

type consume = (arg: {
  readonly credentials: Credentials;
  readonly session: {
    readonly idHash: string;
    readonly oddTokenHash: string;
    readonly evenTokenHash?: string;
    readonly exp: Date;
    readonly tokenExp: Date;
    readonly isLatestTokenOdd: boolean;
  };
  readonly config?: Config;
}) => Promise<{
  readonly state:
    | "SessionForked"
    | "SessionExpired"
    | "TokenRotated"
    | "SessionActive"
    | "CookieMalformed";

  readonly cookie?: Cookie;
  readonly action?: Action;
}>;
export const consume: consume;

type credentialsFromCookie = (arg: { readonly cookie: string }) => Promise<Credentials | undefined>;
export const credentialsFromCookie: credentialsFromCookie;

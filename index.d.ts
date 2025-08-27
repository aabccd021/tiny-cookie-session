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

export type InsertAction = {
  readonly type: "insert";
  readonly idHash: string;
  readonly exp: Date;
  readonly oddTokenHash: string;
  readonly tokenExp: Date;
  readonly isLatestTokenOdd: boolean;
};
export type UpdateAction = {
  readonly type: "update";
  readonly idHash: string;
  readonly exp: Date;
  readonly oddTokenHash?: string;
  readonly evenTokenHash?: string;
  readonly tokenExp: Date;
  readonly isLatestTokenOdd: boolean;
};
export type DeleteAction = {
  readonly type: "delete";
  readonly idHash: string;
};

export type Action = InsertAction | DeleteAction | UpdateAction;

type LogoutArg = {
  readonly credentials: Credentials;
};

type LogoutResult = {
  readonly cookie: Cookie;
  readonly action: DeleteAction;
};

export const logout: (arg: LogoutArg) => Promise<LogoutResult>;

type LoginArg = {
  readonly config?: Config;
};

type LoginResult = {
  readonly cookie: Cookie;
  readonly action: InsertAction;
};

export const login: (arg: LoginArg) => Promise<LoginResult>;

export type ConsumeArg = {
  readonly credentials: Credentials;
  readonly session: {
    readonly oddTokenHash: string;
    readonly evenTokenHash?: string;
    readonly exp: Date;
    readonly tokenExp: Date;
    readonly isLatestTokenOdd: boolean;
  };
  readonly config?: Config;
};

export type ConsumeResult =
  | {
      readonly state: "SessionForked";
      readonly cookie: Cookie;
      readonly action: DeleteAction;
    }
  | {
      readonly state: "SessionExpired";
      readonly cookie: Cookie;
      readonly action: DeleteAction;
    }
  | {
      readonly state: "TokenRotated";
      readonly cookie: Cookie;
      readonly action: UpdateAction;
    }
  | {
      readonly state: "SessionActive";
      readonly cookie: undefined;
      readonly action: undefined;
    };

export const consume: (arg: ConsumeArg) => Promise<ConsumeResult>;

export type CredentialsFromCookieArg = {
  readonly cookie: string;
};

export type CredentialsFromCookieResult = Credentials | undefined;

type credentialsFromCookie = (arg: { readonly cookie: string }) => Promise<Credentials | undefined>;
export const credentialsFromCookie: credentialsFromCookie;

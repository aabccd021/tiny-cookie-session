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

type Credential = {
  readonly id: string;
  readonly idHash: string;
  readonly token: string;
};

export type SessionData = {
  readonly sessionExp: Date;
  readonly token1Hash: string;
  readonly token2Hash: string | null;
  readonly tokenExp: Date;
};

export type DeleteSessionAction = {
  readonly type: "DeleteSession";
  readonly idHash: string;
};
export type SetSessionAction = {
  readonly type: "SetSession";
  readonly idHash: string;
  readonly reason: "SessionCreated" | "TokenRotated" | "TokenDeleted";
  readonly sessionData: SessionData;
};

export type Action = SetSessionAction | DeleteSessionAction;

export const logoutCookie: Cookie;

type LogoutArg = {
  readonly credential: Credential;
};

type LogoutResult = {
  readonly cookie: Cookie;
  readonly action: DeleteSessionAction;
};

export const logout: (arg: LogoutArg) => Promise<LogoutResult>;

type LoginArg = {
  readonly config?: Config;
};

type LoginResult = {
  readonly cookie: Cookie;
  readonly action: SetSessionAction;
};

export const login: (arg?: LoginArg) => Promise<LoginResult>;

export type ConsumeArg = {
  readonly credential: Credential;
  readonly sessionData: SessionData;
  readonly config?: Config;
};

export type ConsumeResult =
  | {
      readonly state: "Forked";
      readonly cookie: Cookie;
      readonly action: DeleteSessionAction;
    }
  | {
      readonly state: "Expired";
      readonly cookie: Cookie;
      readonly action: DeleteSessionAction;
    }
  | {
      readonly state: "Active";
      readonly cookie?: Cookie;
      readonly action?: SetSessionAction;
    };

export const consume: (arg: ConsumeArg) => Promise<ConsumeResult>;

export type CredentialFromCookieArg = {
  readonly cookie: string;
};

export type CredentialFromCookieResult = Credential | undefined;

type credentialFromCookie = (arg: {
  readonly cookie: string;
}) => Promise<CredentialFromCookieResult>;
export const credentialFromCookie: credentialFromCookie;

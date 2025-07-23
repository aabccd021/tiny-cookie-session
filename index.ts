import * as crypto from "node:crypto";

export type CookieOptions = {
  readonly maxAge?: number;
  readonly expires?: Date;
  readonly domain?: string;
  readonly path?: string;
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
  readonly sameSite?: "strict" | "lax" | "none";
};

export type Cookie = readonly [string, CookieOptions];

export type Session =
  | {
      readonly requireLogout: true;
      readonly reason: "session not found" | "old token" | "session expired";
      readonly cookie: Cookie;
    }
  | {
      readonly requireLogout: false;
      readonly cookie?: Cookie;
      readonly id: string;
      readonly exp: number;
      readonly tokenExp: number;
      readonly token1Hash: string;
      readonly token2Hash: string | undefined;
      readonly userId: string;
    };

export type Config = {
  readonly cookieOption?: Omit<CookieOptions, "maxAge" | "expires">;
  readonly dateNow: () => number;
  readonly sessionExpiresIn: number;
  readonly tokenExpiresIn: number;
  readonly selectSession: (params: { tokenHash: string }) =>
    | {
        readonly id: string;
        readonly exp: number;
        readonly tokenExp: number;
        readonly token1Hash: string;
        readonly token2Hash: string | undefined;
        readonly userId: string;
      }
    | undefined;
  readonly insertSession: (params: {
    readonly sessionId: string;
    readonly sessionExp: number;
    readonly tokenHash: string;
    readonly tokenExp: number;
    readonly userId: string;
  }) => void;
  readonly insertTokenAndUpdateSession: (params: {
    readonly sessionId: string;
    readonly sessionExp: number;
    readonly tokenExp: number;
    readonly newTokenHash: string;
  }) => void;
  readonly deleteSession: (params: { tokenHash: string }) => void;
};

export const defaultConfig = {
  sessionExpiresIn: 30 * 24 * 60 * 60 * 1000,
  tokenExpiresIn: 1 * 60 * 1000,
};

const defaultCookieOption: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  secure: true,
};

function logoutCookie(config: Config): Cookie {
  return [
    "",
    {
      ...defaultCookieOption,
      ...config.cookieOption,
      maxAge: 0,
    },
  ];
}

/*
remix uses 64 bits of entropy
https://github.com/remix-run/remix/blob/b7d280140b27507530bcd66f7b30abe3e9d76436/packages/remix-node/sessions/fileStorage.ts#L45

owasp recommends at least 64 bits of entropy
https://owasp.org/www-community/vulnerabilities/Insufficient_Session-ID_Length

lucia uses 160 bits of entropy in their sqlite example
https://github.com/lucia-auth/lucia/blob/46b164f78dc7983d7a4c3fb184505a01a4939efd/pages/sessions/basic-api/sqlite.md?plain=1#L88

auth.js uses 256 bits of entropy in their test
https://github.com/nextauthjs/next-auth/blob/c5a70d383bb97b39f8edbbaf69c4c7620246e9a4/packages/core/test/actions/session.test.ts#L146
*/
const tokenEntropyBit = 256;

function generateToken(): string {
  return crypto.randomBytes(tokenEntropyBit / 8).toString("hex");
}

/*
A token is hashed before being stored in the database.

This way when the database is compromised, the attacker can't just use any data
in the database to hijack the session.

Since the token itself is already a random string with high entropy, unlike a 
password, we don't need any additional processing like salting, stretching, or
peppering.

Doing sha-256 for every request might seem like a lot, but it's not any more 
taxing than doing cookie signing, which is a common practice in web services.
*/
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createNewTokenCookie(config: Config): {
  readonly cookie: Cookie;
  readonly tokenHash: string;
} {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const now = config.dateNow?.() ?? Date.now();

  const cookie: Cookie = [
    token,
    {
      ...defaultCookieOption,
      ...config.cookieOption,

      /*
      We use `sessionExpiresIn` instead of `tokenExpiresIn` here, because we
      want the cookie to expire when the session expires, not when the token
      expires.

      This allows the user to stay logged in as long as the session is valid,
      even if the token is rotated frequently.

      We primarily use short-lived tokens to detect cookie theft, and not to
      limit the session duration.
      */
      expires: new Date(now + config.sessionExpiresIn),
    },
  ];

  return { cookie, tokenHash };
}

export function logout(config: Config, { token }: { token: string }): Cookie {
  config.deleteSession({ tokenHash: hashToken(token) });
  return logoutCookie(config);
}

export function login(config: Config, { userId }: { userId: string }): Cookie {
  const sessionId = crypto.randomUUID();
  const { cookie, tokenHash } = createNewTokenCookie(config);
  const now = config.dateNow?.() ?? Date.now();
  config.insertSession({
    sessionId,
    tokenHash,
    userId,
    sessionExp: now + config.sessionExpiresIn,
    tokenExp: now + config.tokenExpiresIn,
  });
  return cookie;
}

export function consumeSession(config: Config, token: string): Session {
  const tokenHash = hashToken(token);
  const session = config.selectSession({ tokenHash });

  /*
  Logout the user when the session doesn't exist.
  This way the server administrator can immediately force logout users by 
  manually deleting the session.
  */
  if (session === undefined) {
    return {
      requireLogout: true,
      reason: "session not found",
      cookie: logoutCookie(config),
    };
  }

  /*
  Personally I don't think we need to use timingSafeEqual here since we are 
  comparing hashed high entropy tokens, but LLM keeps saying "Just do it,
  it's a good practice" so here we go.
  */
  const isToken1 =
    tokenHash.length === session.token1Hash.length &&
    crypto.timingSafeEqual(
      Buffer.from(tokenHash),
      Buffer.from(session.token1Hash),
    );
  const isToken2 =
    tokenHash.length === session.token2Hash?.length &&
    crypto.timingSafeEqual(
      Buffer.from(tokenHash),
      Buffer.from(session.token2Hash),
    );

  /*
  The `selectSession` function returns a session (not undefined), 
  which means the token is a legit token that is associated with the session, 
  not a random token generated by brute force attack.

  But entering this block means the token is neither the latest token nor the 
  second latest token.

  The only scenario when this can happen is when the token was stolen, so we 
  will log out both the user and the attacker by deleting the session.

  While using just the latest token to identify a session would be enough to 
  detect cookie theft, we will instead use two latest tokens.

  We do this to prevent the user from being logged out while doing completely 
  valid requests, but on a certain race condition.
  
  Below example shows a scenario where the user would be logged out for a valid
  request, if we only used the latest token.

  1. Client sends request lorem with `cookie: token=old_token`. Valid token.
  2. Server creates token `new_token` on database. Now it's the latest token.
  3. Client sends request ipsum with `cookie: token=old_token`. Invalid token.
  4. Server sends response lorem with `set-cookie: token=new_token`.
  5. Client sends request dolor with `cookie: token=new_token`. Valid token.
  
  Ideally `tokenExpiresIn` should set to a duration as short as possible, but 
  still longer than the longest request time. 
  */
  if (!isToken1 && !isToken2) {
    config.deleteSession({ tokenHash });
    return {
      requireLogout: true,
      reason: "old token",
      cookie: logoutCookie(config),
    };
  }

  const now = config.dateNow?.() ?? Date.now();

  if (session.exp < now) {
    config.deleteSession({ tokenHash });
    return {
      requireLogout: true,
      reason: "session expired",
      cookie: logoutCookie(config),
    };
  }

  /*
  Generate and return new token only if the request's token is the latest one,
  but not the second latest one.

  This way only one of the browsers (the user's or the attacker's) can 
  acquire the new token.

  We will also extend the session expiration time here, which is more efficient
  than extending it on every request.
  */
  if (session.tokenExp <= now && isToken1) {
    const { cookie, tokenHash } = createNewTokenCookie(config);
    config.insertTokenAndUpdateSession({
      sessionId: session.id,
      newTokenHash: tokenHash,
      sessionExp: now + config.sessionExpiresIn,
      tokenExp: now + config.tokenExpiresIn,
    });
    return {
      ...session,
      requireLogout: false,
      cookie,
    };
  }

  return {
    ...session,
    requireLogout: false,
  };
}

/*
Test wether the `Config` is impelmented correctly.

If your `Config` implementation is not correct or throws an error, 
this function might leave some dirty data in the database.
*/
export function testConfig(
  config: Config,
  { userId }: { userId: string },
): void {
  if (config.tokenExpiresIn >= config.sessionExpiresIn) {
    throw new Error("tokenExpiresIn must be less than sessionExpiresIn");
  }

  const sessionId = crypto.randomUUID();
  const token1Hash = hashToken(generateToken());
  const token2Hash = hashToken(generateToken());
  const token3Hash = hashToken(generateToken());

  const start = Date.now();
  config.insertSession({
    sessionId,
    tokenHash: token3Hash,
    userId,
    sessionExp: start + config.sessionExpiresIn,
    tokenExp: start + config.tokenExpiresIn,
  });

  config.insertTokenAndUpdateSession({
    sessionId,
    sessionExp: start + 10000 + config.sessionExpiresIn,
    newTokenHash: token2Hash,
    tokenExp: start + 1000 + config.tokenExpiresIn,
  });

  config.insertTokenAndUpdateSession({
    sessionId,
    sessionExp: start + 20000 + config.sessionExpiresIn,
    newTokenHash: token1Hash,
    tokenExp: start + 2000 + config.tokenExpiresIn,
  });

  for (const tokenHash of [token1Hash, token2Hash, token3Hash]) {
    const session = config.selectSession({ tokenHash });
    if (session === undefined) {
      throw new Error("Session not found");
    }

    if (session.id !== sessionId) {
      throw new Error("Session id does not match");
    }

    if (session.userId !== userId) {
      throw new Error("Session user id does not match");
    }

    if (session.token1Hash !== token1Hash) {
      throw new Error("Session token1Hash does not match");
    }

    if (session.token2Hash !== token2Hash) {
      throw new Error("Session token2Hash does not match");
    }

    if (session.exp !== start + 20000 + config.sessionExpiresIn) {
      throw new Error("Session expired");
    }

    if (session.tokenExp !== start + 2000 + config.tokenExpiresIn) {
      throw new Error("Token expired");
    }
  }

  config.deleteSession({ tokenHash: token1Hash });
  for (const tokenHash of [token1Hash, token2Hash, token3Hash]) {
    const session = config.selectSession({ tokenHash });
    if (session !== undefined) {
      throw new Error("Session should not be found");
    }
  }
}

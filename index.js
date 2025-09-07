/**
 * @type {import("./index").logoutCookie}
 */
export const logoutCookie = {
  value: "",
  options: {
    httpOnly: true,
    sameSite: "strict",
    secure: true,
    maxAge: 0,
  },
};

const defaultSessionExpiresIn = 1000 * 60 * 60 * 24 * 7;
const defaultTokenExpiresIn = 1000 * 60 * 2;

// - OWASP - 64 bits - https://owasp.org/www-community/vulnerabilities/Insufficient_Session-ID_Length
// - Remix - 64 bits - https://github.com/remix-run/remix/blob/b7d280140b27507530bcd66f7b30abe3e9d76436/packages/remix-node/sessions/fileStorage.ts#L45
// - Lucia's example - 160 bits - https://github.com/lucia-auth/lucia/blob/46b164f78dc7983d7a4c3fb184505a01a4939efd/pages/sessions/basic-api/sqlite.md?plain=1#L88
// - Auth.js test- 256 bits - https://github.com/nextauthjs/next-auth/blob/c5a70d383bb97b39f8edbbaf69c4c7620246e9a4/packages/core/test/actions/session.test.ts#L146
/**
 * @returns {string}
 */
function generate256BitEntropyHex() {
  const value = crypto.getRandomValues(new Uint8Array(32));
  // @ts-expect-error https://tc39.es/proposal-arraybuffer-base64
  return value.toHex();
}

// Only store hashes in database so that if database is leaked, the attacker cannot impersonate
// users without first cracking the hashes.
/**
 * @param {string} token
 * @returns {Promise<string>}
 */
const hash = async (token) => {
  const data = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  // @ts-expect-error https://tc39.es/proposal-arraybuffer-base64
  return hashArray.toHex();
};

/**
 * @param {import("./index").LoginArg} [arg]
 * @returns {Promise<import("./index").LoginResult>}
 */
export async function login(arg) {
  const id = generate256BitEntropyHex();
  const idHash = await hash(id);

  const token = generate256BitEntropyHex();
  const tokenHash = await hash(token);

  const now = arg?.config?.dateNow?.() ?? new Date();

  const sessionExpiresIn = arg?.config?.sessionExpiresIn ?? defaultSessionExpiresIn;
  const sessionExp = new Date(now.getTime() + sessionExpiresIn);

  const tokenExpiresIn = arg?.config?.tokenExpiresIn ?? defaultTokenExpiresIn;
  const tokenExp = new Date(now.getTime() + tokenExpiresIn);

  /** @type {import("./index").Cookie} */
  const cookie = {
    value: `${id}:${token}`,
    options: {
      httpOnly: true,
      sameSite: "strict",
      secure: true,
      expires: sessionExp,
    },
  };

  return {
    cookie,
    action: {
      type: "SetSession",
      reason: "SessionCreated",
      idHash,
      sessionData: {
        token1Hash: tokenHash,
        token2Hash: null,
        sessionExp: sessionExp,
        tokenExp: tokenExp,
      },
    },
  };
}

/**
 * @param {import("./index").CredentialFromCookieArg} arg
 * @returns {Promise<import("./index").CredentialFromCookieResult>}
 */
export async function credentialFromCookie(arg) {
  const [id, token] = arg.cookie.split(":");
  if (id === undefined || token === undefined) {
    return undefined;
  }

  const idHash = await hash(id);
  return { id, token, idHash };
}

/**
 * @param {import("./index").LogoutArg} arg
 * @returns {Promise<import("./index").LogoutResult>}
 */
export async function logout(arg) {
  return {
    cookie: logoutCookie,
    action: {
      type: "DeleteSession",
      idHash: arg.credential.idHash,
    },
  };
}

/**
 * @param {import("./index").ConsumeArg} arg
 * @returns {Promise<import("./index").ConsumeResult>}
 */
export async function consume(arg) {
  const requestTokenHash = await hash(arg.credential.token);

  // No need to use `crypto.timingSafeEqual` here because we are comparing (SHA-256) hashes of high
  // entropy values (256 bit).
  // Reference: https://security.stackexchange.com/questions/237116/using-timingsafeequal#comment521092_237133
  const isToken1 = requestTokenHash === arg.sessionData.token1Hash;
  const isToken2 = requestTokenHash === arg.sessionData.token2Hash;

  if (!isToken1 && !isToken2) {
    return {
      state: "Forked",
      cookie: logoutCookie,
      action: {
        type: "DeleteSession",
        idHash: arg.credential.idHash,
      },
    };
  }

  const now = arg.config?.dateNow?.() ?? new Date();
  if (arg.sessionData.sessionExp.getTime() <= now.getTime()) {
    return {
      state: "Expired",
      cookie: logoutCookie,
      action: {
        type: "DeleteSession",
        idHash: arg.credential.idHash,
      },
    };
  }

  if (isToken2) {
    // Hitting this point means the second latest token is used in reqeust while the latest token is
    // already issued.
    // This might happen on a race condition where the client sends multiple requests
    // simultaneously.
    // This second latest token is still considered active, but cannot be used to rotate token.
    return { state: "Active" };
  }

  const isTokenExpired = arg.sessionData.tokenExp.getTime() <= now.getTime();
  if (!isTokenExpired) {
    if (arg.sessionData.token2Hash === null) {
      return { state: "Active" };
    }

    // Hitting this point means the latest token is confirmed to be set on client side, while the
    // second latest token is still in database, so we will delete the second latest token.
    return {
      state: "Active",
      action: {
        type: "SetSession",
        reason: "Token2Deleted",
        idHash: arg.credential.idHash,
        sessionData: {
          token1Hash: arg.sessionData.token1Hash,
          token2Hash: null,
          sessionExp: arg.sessionData.sessionExp,
          tokenExp: arg.sessionData.tokenExp,
        },
      },
    };
  }

  // Hitting this point means the latest token is used in request and already expired.
  // We will rotate the token.

  const nextToken = generate256BitEntropyHex();
  const nextTokenHash = await hash(nextToken);

  const sessionExpiresIn = arg.config?.sessionExpiresIn ?? defaultSessionExpiresIn;
  const nextSessionExp = new Date(now.getTime() + sessionExpiresIn);

  const tokenExpiresIn = arg.config?.tokenExpiresIn ?? defaultTokenExpiresIn;
  const nextTokenExp = new Date(now.getTime() + tokenExpiresIn);

  /** @type {import("./index").Cookie} */
  const cookie = {
    value: `${arg.credential.id}:${nextToken}`,
    options: {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      secure: true,
      expires: nextSessionExp,
    },
  };

  return {
    state: "Active",
    cookie,
    action: {
      type: "SetSession",
      reason: "TokenRotated",
      idHash: arg.credential.idHash,
      sessionData: {
        token1Hash: nextTokenHash,
        token2Hash: arg.sessionData.token1Hash,
        sessionExp: nextSessionExp,
        tokenExp: nextTokenExp,
      },
    },
  };
}

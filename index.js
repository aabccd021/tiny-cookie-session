/**
 * @type {import("./index").Cookie}
 */
const logoutCookie = {
  value: "",
  options: {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 0,
  },
};

const defaultSessionExpiresIn = 1000 * 60 * 60 * 24 * 7;
const defaultTokenExpiresIn = 1000 * 60 * 2;

function generateRandomHex() {
  // @ts-ignore https://tc39.es/proposal-arraybuffer-base64
  return crypto.getRandomValues(new Uint8Array(32)).toHex();
}

/**
 * @param {string} token
 * @returns {Promise<string>}
 */
const hash = async (token) => {
  const data = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  // @ts-ignore https://tc39.es/proposal-arraybuffer-base64
  return new Uint8Array(hashBuffer).toHex();
};

/**
 * @param {import("./index").LoginArg} [arg]
 * @returns {Promise<import("./index").LoginResult>}
 */
export async function login(arg) {
  const id = generateRandomHex();
  const token = generateRandomHex();
  const now = arg?.config?.dateNow?.() ?? new Date();
  const sessionExpiresIn = arg?.config?.sessionExpiresIn ?? defaultSessionExpiresIn;
  const expires = new Date(now.getTime() + sessionExpiresIn);

  /** @type {import("./index").Cookie} */
  const cookie = {
    value: `${id}:${token}`,
    options: {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      expires,
    },
  };

  const tokenExpiresIn = arg?.config?.tokenExpiresIn ?? defaultTokenExpiresIn;
  return {
    cookie,
    action: {
      type: "insert",
      idHash: await hash(id),
      exp: expires,
      isLatestTokenOdd: true,
      tokenExp: new Date(now.getTime() + tokenExpiresIn),
      oddTokenHash: await hash(token),
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
    return { data: undefined, cookie: logoutCookie };
  }

  const idHash = await hash(id);
  return { data: { id, token, idHash } };
}

/**
 * @param {import("./index").LogoutArg} arg
 * @returns {Promise<import("./index").LogoutResult>}
 */
export async function logout(arg) {
  return {
    cookie: logoutCookie,
    action: {
      type: "delete",
      idHash: arg.credentialData.idHash,
    },
  };
}

/**
 * @param {import("./index").ConsumeArg} arg
 * @returns {Promise<import("./index").ConsumeResult>}
 */
export async function consume(arg) {
  if (!arg.session.found) {
    return {
      state: "SessionNotFound",
      cookie: logoutCookie,
      action: undefined,
    };
  }

  const requestTokenHash = await hash(arg.credentialData.token);
  const isOddToken = requestTokenHash === arg.session.data.oddTokenHash;
  const isEvenToken = requestTokenHash === arg.session.data.evenTokenHash;

  if (!isOddToken && !isEvenToken) {
    return {
      state: "SessionForked",
      cookie: logoutCookie,
      action: {
        type: "delete",
        idHash: arg.credentialData.idHash,
      },
    };
  }

  const now = arg.config?.dateNow?.() ?? new Date();
  if (arg.session.data.exp.getTime() <= now.getTime()) {
    return {
      state: "SessionExpired",
      cookie: logoutCookie,
      action: {
        type: "delete",
        idHash: arg.credentialData.idHash,
      },
    };
  }

  const isLatestToken = arg.session.data.isLatestTokenOdd ? isOddToken : isEvenToken;
  const shouldRotate = arg.session.data.tokenExp.getTime() <= now.getTime() && isLatestToken;
  if (!shouldRotate) {
    return {
      state: "SessionActive",
      cookie: undefined,
      action: undefined,
    };
  }

  const sessionExpiresIn = arg.config?.sessionExpiresIn ?? defaultSessionExpiresIn;
  const exp = new Date(now.getTime() + sessionExpiresIn);
  const token = generateRandomHex();

  /** @type {import("./index").Cookie} */
  const cookie = {
    value: `${arg.credentialData.id}:${token}`,
    options: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
      expires: exp,
    },
  };

  const tokenHashStr = await hash(token);
  const isNextOddToken = !arg.session.data.isLatestTokenOdd;
  const tokenExpiresIn = arg.config?.tokenExpiresIn ?? defaultTokenExpiresIn;
  const tokenExp = new Date(now.getTime() + tokenExpiresIn);

  return {
    state: "TokenRotated",
    cookie,
    action: {
      type: "update",
      idHash: arg.credentialData.idHash,
      isLatestTokenOdd: isNextOddToken,
      oddTokenHash: isNextOddToken ? tokenHashStr : undefined,
      evenTokenHash: isNextOddToken ? undefined : tokenHashStr,
      exp,
      tokenExp,
    },
  };
}

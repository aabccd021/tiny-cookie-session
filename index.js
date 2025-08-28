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

/**
 * @returns {string}
 */
function generate256BitEntropyHex() {
  const value = crypto.getRandomValues(new Uint8Array(32));
  // @ts-ignore https://tc39.es/proposal-arraybuffer-base64
  return value.toHex();
}

/**
 * @param {string} token
 * @returns {Promise<string>}
 */
const hash = async (token) => {
  const data = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  // @ts-ignore https://tc39.es/proposal-arraybuffer-base64
  return hashArray.toHex();
};

/**
 * @param {import("./index").LoginArg} [arg]
 * @returns {Promise<import("./index").LoginResult>}
 */
export async function login(arg) {
  const id = generate256BitEntropyHex();
  const token = generate256BitEntropyHex();
  const now = arg?.config?.dateNow?.() ?? new Date();
  const sessionExpiresIn = arg?.config?.sessionExpiresIn ?? defaultSessionExpiresIn;
  const expires = new Date(now.getTime() + sessionExpiresIn);

  /** @type {import("./index").Cookie} */
  const cookie = {
    value: `${id}:${token}`,
    options: {
      httpOnly: true,
      sameSite: "strict",
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
      type: "delete",
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
  const isOddToken = requestTokenHash === arg.session.oddTokenHash;
  const isEvenToken = requestTokenHash === arg.session.evenTokenHash;

  if (!isOddToken && !isEvenToken) {
    return {
      state: "SessionForked",
      cookie: logoutCookie,
      action: {
        type: "delete",
        idHash: arg.credential.idHash,
      },
    };
  }

  const now = arg.config?.dateNow?.() ?? new Date();
  if (arg.session.exp.getTime() <= now.getTime()) {
    return {
      state: "SessionExpired",
      cookie: logoutCookie,
      action: {
        type: "delete",
        idHash: arg.credential.idHash,
      },
    };
  }

  const isLatestToken = arg.session.isLatestTokenOdd ? isOddToken : isEvenToken;
  const shouldRotate = arg.session.tokenExp.getTime() <= now.getTime() && isLatestToken;
  if (!shouldRotate) {
    return {
      state: "SessionActive",
      cookie: undefined,
      action: undefined,
    };
  }

  const sessionExpiresIn = arg.config?.sessionExpiresIn ?? defaultSessionExpiresIn;
  const exp = new Date(now.getTime() + sessionExpiresIn);
  const token = generate256BitEntropyHex();

  /** @type {import("./index").Cookie} */
  const cookie = {
    value: `${arg.credential.id}:${token}`,
    options: {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      secure: true,
      expires: exp,
    },
  };

  const tokenHashStr = await hash(token);
  const isNextOddToken = !arg.session.isLatestTokenOdd;
  const tokenExpiresIn = arg.config?.tokenExpiresIn ?? defaultTokenExpiresIn;
  const tokenExp = new Date(now.getTime() + tokenExpiresIn);

  return {
    state: "TokenRotated",
    cookie,
    action: {
      type: "update",
      idHash: arg.credential.idHash,
      isLatestTokenOdd: isNextOddToken,
      oddTokenHash: isNextOddToken ? tokenHashStr : undefined,
      evenTokenHash: isNextOddToken ? undefined : tokenHashStr,
      exp,
      tokenExp,
    },
  };
}

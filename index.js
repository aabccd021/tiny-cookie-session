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
  return crypto.getRandomValues(new Uint8Array(32)).toHex();
}

/**
 * @param {string} token
 * @returns {Promise<string>}
 */
const hash = async (token) => {
  const data = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hashBuffer).toHex();
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
      type: "InsertSession",
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
  const isOddToken = requestTokenHash === arg.sessionData.oddTokenHash;
  const isEvenToken = requestTokenHash === arg.sessionData.evenTokenHash;

  if (!isOddToken && !isEvenToken) {
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
  if (arg.sessionData.exp.getTime() <= now.getTime()) {
    return {
      state: "Expired",
      cookie: logoutCookie,
      action: {
        type: "DeleteSession",
        idHash: arg.credential.idHash,
      },
    };
  }

  // Hitting this point means old token is used while new token is already issued,
  // which might happen when race condition happens (e.g. user sends multiple requests in parallel).
  const isLatestToken = arg.sessionData.isLatestTokenOdd ? isOddToken : isEvenToken;
  if (!isLatestToken) {
    return {
      state: "Active",
    };
  }

  // Hitting this point means new token after rotation is set on client side.
  // So we will delete the old token we previously needed to handle race condition.
  const isTokenExpired = arg.sessionData.tokenExp.getTime() <= now.getTime();
  if (!isTokenExpired) {
    return {
      state: "Active",
      action: {
        type: "DeleteToken",
        idHash: arg.credential.idHash,
        tokenType: arg.sessionData.isLatestTokenOdd ? "even" : "odd",
      },
    };
  }

  const sessionExpiresIn = arg.config?.sessionExpiresIn ?? defaultSessionExpiresIn;
  const tokenExpiresIn = arg.config?.tokenExpiresIn ?? defaultTokenExpiresIn;

  const nextSessionExp = new Date(now.getTime() + sessionExpiresIn);
  const nextTokenExp = new Date(now.getTime() + tokenExpiresIn);
  const nextToken = generate256BitEntropyHex();
  const nextTokenHash = await hash(nextToken);

  const isNextTokenOdd = !arg.sessionData.isLatestTokenOdd;

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
      type: "UpdateSession",
      idHash: arg.credential.idHash,
      isLatestTokenOdd: isNextTokenOdd,
      oddTokenHash: isNextTokenOdd ? nextTokenHash : undefined,
      evenTokenHash: isNextTokenOdd ? undefined : nextTokenHash,
      exp: nextSessionExp,
      tokenExp: nextTokenExp,
    },
  };
}

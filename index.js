/**
 * @type {import("./index").Cookie}
 */
const logoutCookie = {
  value: "",
  options: {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
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
 * @type {import("./index").hash}
 */
const hash = async (token) => {
  const data = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  // @ts-ignore https://tc39.es/proposal-arraybuffer-base64
  return new Uint8Array(hashBuffer).toHex();
};

/**
 * @type {import("./index").login}
 */
export const login = async (arg) => {
  const id = generateRandomHex();
  const token = generateRandomHex();
  const now = arg.config?.dateNow?.() ?? new Date();
  const sessionExpiresIn = arg.config?.sessionExpiresIn ?? defaultSessionExpiresIn;
  const expires = new Date(now.getTime() + sessionExpiresIn);

  /** @type {import("./index").Cookie} */
  const cookie = {
    value: `${id}:${token}`,
    options: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
      expires,
    },
  };

  const tokenExpiresIn = arg.config?.tokenExpiresIn ?? defaultTokenExpiresIn;
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
};

/**
 * @type {import("./index").logout}
 */
export const logout = async (arg) => {
  return {
    cookie: logoutCookie,
    action: {
      type: "delete",
      idHash: arg.idHash,
    },
  };
};

/**
 * @type {import("./index").credentialsFromCookie}
 */
export const credentialsFromCookie = async (arg) => {
  const [sessionId, token] = arg.cookie.split(":");
  if (sessionId === undefined || token === undefined) {
    return undefined;
  }

  const sessionIdHash = await hash(sessionId);
  return { sessionId, token, sessionIdHash };
};

/**
 * @type {import("./index").consume}
 */
export const consume = async (arg) => {
  const requestTokenHash = await hash(arg.credentials.token);
  const isOddToken = requestTokenHash === arg.dbSession.oddTokenHash;
  const isEvenToken = requestTokenHash === arg.dbSession.evenTokenHash;

  if (!isOddToken && !isEvenToken) {
    return {
      state: "SessionForked",
      cookie: logoutCookie,
      action: {
        type: "delete",
        idHash: arg.dbSession.idHash,
      },
    };
  }

  const now = arg.config?.dateNow?.() ?? new Date();
  if (arg.dbSession.exp.getTime() <= now.getTime()) {
    return {
      state: "SessionExpired",
      cookie: logoutCookie,
      action: {
        type: "delete",
        idHash: arg.dbSession.idHash,
      },
    };
  }

  const isLatestToken = arg.dbSession.isLatestTokenOdd ? isOddToken : isEvenToken;
  const shouldRotate = arg.dbSession.tokenExp.getTime() <= now.getTime() && isLatestToken;
  if (!shouldRotate) {
    return { state: "SessionActive" };
  }

  const sessionExpiresIn = arg.config?.sessionExpiresIn ?? defaultSessionExpiresIn;
  const exp = new Date(now.getTime() + sessionExpiresIn);
  const token = generateRandomHex();

  /** @type {import("./index").Cookie} */
  const cookie = {
    value: `${arg.credentials.sessionId}:${token}`,
    options: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
      expires: exp,
    },
  };

  const tokenHashStr = await hash(token);
  const isNextOddToken = !arg.dbSession.isLatestTokenOdd;
  const tokenExpiresIn = arg.config?.tokenExpiresIn ?? defaultTokenExpiresIn;
  const tokenExp = new Date(now.getTime() + tokenExpiresIn);

  return {
    state: "TokenRotated",
    cookie,
    action: {
      type: "update",
      idHash: arg.dbSession.idHash,
      isLatestTokenOdd: isNextOddToken,
      oddTokenHash: isNextOddToken ? tokenHashStr : undefined,
      evenTokenHash: isNextOddToken ? undefined : tokenHashStr,
      exp,
      tokenExp,
    },
  };
};

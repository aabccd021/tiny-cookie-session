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

function generateToken() {
  // @ts-ignore https://tc39.es/proposal-arraybuffer-base64
  return crypto.getRandomValues(new Uint8Array(32)).toHex();
}

/**
 * @param {string} token
 */
async function hashToken(token) {
  const data = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  // @ts-ignore https://tc39.es/proposal-arraybuffer-base64
  return new Uint8Array(hashBuffer).toHex();
}

/**
 * @template S
 * @template I
 * @param {import("./index").Config<S, I>} config
 */
async function createNewTokenCookie(config) {
  const token = generateToken();
  const tokenHash = await hashToken(token);
  const now = config.dateNow?.() ?? new Date();

  /*
  We use `sessionExpiresIn` instead of `tokenExpiresIn` here, because we want the cookie to expire 
  when the session expires, not when the token expires. This allows the user to stay logged in as 
  long as the session is valid, even if the token is rotated frequently.
  */
  const expires = new Date(now.getTime() + config.sessionExpiresIn);

  /** @type {import("./index").Cookie} */
  const cookie = {
    value: token,
    options: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
      expires,
    },
  };

  return { cookie, tokenHash };
}

/**
 * @type {import("./index").logout}
 */
export const logout = async (config, arg) => {
  const tokenHash = await hashToken(arg.token);
  config.deleteSession({ tokenHash });
  return logoutCookie;
};

/**
 * @type {import("./index").login}
 */
export const login = async (config, arg) => {
  const { cookie, tokenHash } = await createNewTokenCookie(config);
  const now = config.dateNow?.() ?? new Date();

  config.insertSession({
    tokenHash,
    id: arg.id,
    exp: new Date(now.getTime() + config.sessionExpiresIn),
    tokenExp: new Date(now.getTime() + config.tokenExpiresIn),
    data: arg.data,
  });
  return cookie;
};

/**
 * @type {import("./index").consumeSession}
 */
export const consumeSession = async (config, arg) => {
  const requestTokenHash = await hashToken(arg.token);
  const session = await config.selectSession({ tokenHash: requestTokenHash });
  const now = config.dateNow?.() ?? new Date();

  if (session === undefined) {
    return {
      state: "NotFound",
      cookie: logoutCookie,
    };
  }

  const isTokenLatest0 = requestTokenHash === session.latestTokenHash[0];
  const isTokenLatest1 = requestTokenHash === session.latestTokenHash[1];

  // Exclude hashes to avoid accidentally logging them,
  // also explicitly specify the properties to return to avoid returning unnecessary values
  const returnData = {
    id: session.id,
    data: session.data,
    exp: session.exp,
    tokenExp: session.tokenExp,
  };

  if (!isTokenLatest0 && !isTokenLatest1) {
    config.deleteSession({ tokenHash: requestTokenHash });
    return {
      ...returnData,
      state: "TokenStolen",
      cookie: logoutCookie,
    };
  }

  if (session.exp < now) {
    config.deleteSession({ tokenHash: requestTokenHash });
    return {
      ...returnData,
      state: "Expired",
      cookie: logoutCookie,
    };
  }

  if (session.tokenExp <= now && isTokenLatest0) {
    const { cookie, tokenHash } = await createNewTokenCookie(config);
    const exp = new Date(now.getTime() + config.sessionExpiresIn);
    const tokenExp = new Date(now.getTime() + config.tokenExpiresIn);
    config.updateSession({
      id: session.id,
      tokenHash,
      exp,
      tokenExp,
    });
    return {
      ...returnData,
      state: "TokenRotated",
      cookie,
      exp,
      tokenExp,
    };
  }

  return {
    ...returnData,
    state: "Active",
  };
};

/**
 * @type {import("./index").testConfig}
 */
export const testConfig = async (config, argSessions) => {
  if (config.tokenExpiresIn >= config.sessionExpiresIn) {
    throw new Error("tokenExpiresIn must be less than sessionExpiresIn");
  }

  const states = [];

  // Simulate innserting multiple sessions
  for (const argSession of argSessions) {
    const latestTokenHash2 = await hashToken(generateToken());
    const latestTokenHash1 = await hashToken(generateToken());
    const latestTokenHash0 = await hashToken(generateToken());

    const start = new Date();
    await config.insertSession({
      id: argSession.id,
      tokenHash: latestTokenHash2,
      exp: new Date(start.getTime() + config.sessionExpiresIn),
      tokenExp: new Date(start.getTime() + config.tokenExpiresIn),
      data: argSession.data,
    });

    await config.updateSession({
      id: argSession.id,
      tokenHash: latestTokenHash1,
      exp: new Date(start.getTime() + 10000 + config.sessionExpiresIn),
      tokenExp: new Date(start.getTime() + 1000 + config.tokenExpiresIn),
    });

    await config.updateSession({
      id: argSession.id,
      tokenHash: latestTokenHash0,
      exp: new Date(start.getTime() + 20000 + config.sessionExpiresIn),
      tokenExp: new Date(start.getTime() + 2000 + config.tokenExpiresIn),
    });

    states.push({ start, latestTokenHash0, latestTokenHash1, latestTokenHash2 });
  }

  // Simulate session selection and deletion
  for (const argSession of argSessions) {
    const sessionHashes = states.shift();
    if (sessionHashes === undefined) {
      throw new Error("Absurd");
    }

    const { start, latestTokenHash0, latestTokenHash1, latestTokenHash2 } = sessionHashes;

    for (const tokenHash of [latestTokenHash0, latestTokenHash1, latestTokenHash2]) {
      const session = await config.selectSession({ tokenHash });
      if (session === undefined) {
        throw new Error("Session not found");
      }

      if (session.id !== argSession.id) {
        throw new Error("Session id does not match");
      }

      if (session.latestTokenHash[0] !== latestTokenHash0) {
        throw new Error("Session latestTokenHash0 does not match");
      }

      if (session.latestTokenHash[1] !== latestTokenHash1) {
        throw new Error("Session latestTokenHash1 does not match");
      }

      const expectedSessionExp = new Date(start.getTime() + 20000 + config.sessionExpiresIn);
      if (session.exp.getTime() !== expectedSessionExp.getTime()) {
        throw new Error("Session expired");
      }

      const expectedTokenExp = new Date(start.getTime() + 2000 + config.tokenExpiresIn);
      if (session.tokenExp.getTime() !== expectedTokenExp.getTime()) {
        throw new Error("Token expired");
      }
    }

    await config.deleteSession({ tokenHash: latestTokenHash0 });
    for (const tokenHash of [latestTokenHash0, latestTokenHash1, latestTokenHash2]) {
      const session = await config.selectSession({ tokenHash });
      if (session !== undefined) {
        throw new Error("Session should not be found after deletion");
      }
    }
  }
};

/**
 * @typedef {Object} CookieOptions
 * @property {number} [maxAge]
 * @property {Date} [expires]
 * @property {string} [domain]
 * @property {string} [path]
 * @property {boolean} [httpOnly]
 * @property {boolean} [secure]
 * @property {("strict"|"lax"|"none")} [sameSite]
 */

/**
 * @typedef {Object} Cookie
 * @property {string} value
 * @property {CookieOptions} options
 */

/**
 * @template S
 * @typedef {Object} SessionSelect
 * @property {string} id
 * @property {Date} exp
 * @property {Date} tokenExp
 * @property {string} token1Hash
 * @property {string|undefined} token2Hash
 * @property {S} extra
 */

/**
 * @template S
 * @typedef {Object} NotFoundSession
 * @property {"NotFound"} state
 * @property {Cookie} cookie
 */

/**
 * @template S
 * @typedef {Object} TokenStolenSession
 * @property {"TokenStolen"} state
 * @property {Cookie} cookie
 * @property {string} id
 * @property {Date} exp
 * @property {Date} tokenExp
 * @property {S} extra
 */

/**
 * @template S
 * @typedef {Object} ExpiredSession
 * @property {"Expired"} state
 * @property {Cookie} cookie
 * @property {string} id
 * @property {Date} exp
 * @property {Date} tokenExp
 * @property {S} extra
 */

/**
 * @template S
 * @typedef {Object} TokenRefreshedSession
 * @property {"TokenRefreshed"} state
 * @property {Cookie} cookie
 * @property {string} id
 * @property {Date} exp
 * @property {Date} tokenExp
 * @property {S} extra
 */

/**
 * @template S
 * @typedef {Object} ActiveSession
 * @property {"Active"} state
 * @property {string} id
 * @property {Date} exp
 * @property {Date} tokenExp
 * @property {S} extra
 */

/**
 * @template S
 * @typedef {NotFoundSession<S>|TokenStolenSession<S>|ExpiredSession<S>|TokenRefreshedSession<S>|ActiveSession<S>} Session
 */

/**
 * @template S
 * @template I
 * @typedef {Object} Config
 * @property {function(): Date} [ dateNow ]
 * @property {number} sessionExpiresIn
 * @property {number} tokenExpiresIn
 * @property {function({tokenHash: string}): Promise<SessionSelect<S>|undefined>} selectSession
 * @property {function({sessionId: string, sessionExp: Date, tokenHash: string, tokenExp: Date, extra: I}): Promise<void>} insertSession
 * @property {function({sessionId: string, sessionExp: Date, tokenExp: Date, tokenHash: string}): Promise<void>} insertTokenAndUpdateSession
 * @property {function({tokenHash: string}): Promise<void>} deleteSession
 */

/**
 * @type {Cookie}
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

/**
 * @returns {string}
 */
function generateToken() {
  // TODO: Remove when https://tc39.es/proposal-arraybuffer-base64 added to typescript
  // @ts-ignore https://tc39.es/proposal-arraybuffer-base64
  return crypto.getRandomValues(new Uint8Array(32)).toHex();
}

/**
 * @param {string} token
 * @returns {Promise<string>}
 */
async function hashToken(token) {
  const data = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  // TODO: Remove when https://tc39.es/proposal-arraybuffer-base64 added to typescript
  // @ts-ignore
  return new Uint8Array(hashBuffer).toHex();
}

/**
 * @template S
 * @template I
 * @param {Config<S, I>} config
 * @returns {Promise<{cookie: Cookie, tokenHash: string}>}
 */
async function createNewTokenCookie(config) {
  const token = generateToken();
  const tokenHash = await hashToken(token);
  const now = config.dateNow?.() ?? new Date();

  const expires = new Date(now.getTime() + config.sessionExpiresIn);

  /** @type {Cookie} */
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
 * @template S
 * @template I
 * @param {Config<S, I>} config
 * @param {{token: string}} arg
 * @returns {Promise<Cookie>}
 */
export async function logout(config, arg) {
  const tokenHash = await hashToken(arg.token);
  config.deleteSession({ tokenHash });
  return logoutCookie;
}

/**
 * @template S
 * @template I
 * @param {Config<S, I>} config
 * @param {{extra: I, sessionId: string}} arg
 * @returns {Promise<Cookie>}
 */
export async function login(config, arg) {
  const { cookie, tokenHash } = await createNewTokenCookie(config);
  const now = config.dateNow?.() ?? new Date();

  config.insertSession({
    tokenHash,
    sessionId: arg.sessionId,
    sessionExp: new Date(now.getTime() + config.sessionExpiresIn),
    tokenExp: new Date(now.getTime() + config.tokenExpiresIn),
    extra: arg.extra,
  });
  return cookie;
}

/**
 * @template S
 * @template I
 * @param {Config<S, I>} config
 * @param {{token: string}} arg
 * @returns {Promise<Session<S>>}
 */
export async function consumeSession(config, arg) {
  const requestTokenHash = await hashToken(arg.token);
  const session = await config.selectSession({ tokenHash: requestTokenHash });

  if (session === undefined) {
    return {
      state: "NotFound",
      cookie: logoutCookie,
    };
  }

  const isSessionToken1 = requestTokenHash === session.token1Hash;
  const isSessionToken2 = requestTokenHash === session.token2Hash;

  if (!isSessionToken1 && !isSessionToken2) {
    config.deleteSession({ tokenHash: requestTokenHash });
    return {
      state: "TokenStolen",
      cookie: logoutCookie,
      id: session.id,
      exp: session.exp,
      tokenExp: session.tokenExp,
      extra: session.extra,
    };
  }

  const now = config.dateNow?.() ?? new Date();
  if (session.exp < now) {
    config.deleteSession({ tokenHash: requestTokenHash });
    return {
      state: "Expired",
      cookie: logoutCookie,
      id: session.id,
      exp: session.exp,
      tokenExp: session.tokenExp,
      extra: session.extra,
    };
  }

  if (session.tokenExp <= now && isSessionToken1) {
    const { cookie, tokenHash } = await createNewTokenCookie(config);
    const sessionExp = new Date(now.getTime() + config.sessionExpiresIn);
    const tokenExp = new Date(now.getTime() + config.tokenExpiresIn);
    config.insertTokenAndUpdateSession({
      sessionId: session.id,
      tokenHash,
      sessionExp,
      tokenExp,
    });
    return {
      state: "TokenRefreshed",
      cookie,
      id: session.id,
      exp: sessionExp,
      tokenExp,
      extra: session.extra,
    };
  }

  return {
    state: "Active",
    id: session.id,
    exp: session.exp,
    tokenExp: session.tokenExp,
    extra: session.extra,
  };
}

/**
 * @template S
 * @template I
 * @param {Config<S, I>} config
 * @param {{insertExtra: I, sessionId: string}} arg
 * @returns {Promise<void>}
 */
export async function testConfig(config, arg) {
  if (config.tokenExpiresIn >= config.sessionExpiresIn) {
    throw new Error("tokenExpiresIn must be less than sessionExpiresIn");
  }

  const token1Hash = await hashToken(generateToken());
  const token2Hash = await hashToken(generateToken());
  const token3Hash = await hashToken(generateToken());

  const start = new Date();
  await config.insertSession({
    sessionId: arg.sessionId,
    tokenHash: token3Hash,
    sessionExp: new Date(start.getTime() + config.sessionExpiresIn),
    tokenExp: new Date(start.getTime() + config.tokenExpiresIn),
    extra: arg.insertExtra,
  });

  await config.insertTokenAndUpdateSession({
    sessionId: arg.sessionId,
    sessionExp: new Date(start.getTime() + 10000 + config.sessionExpiresIn),
    tokenHash: token2Hash,
    tokenExp: new Date(start.getTime() + 1000 + config.tokenExpiresIn),
  });

  await config.insertTokenAndUpdateSession({
    sessionId: arg.sessionId,
    sessionExp: new Date(start.getTime() + 20000 + config.sessionExpiresIn),
    tokenHash: token1Hash,
    tokenExp: new Date(start.getTime() + 2000 + config.tokenExpiresIn),
  });

  for (const tokenHash of [token1Hash, token2Hash, token3Hash]) {
    const session = await config.selectSession({ tokenHash });
    if (session === undefined) {
      throw new Error("Session not found");
    }

    if (session.id !== arg.sessionId) {
      throw new Error("Session id does not match");
    }

    if (session.token1Hash !== token1Hash) {
      throw new Error("Session token1Hash does not match");
    }

    if (session.token2Hash !== token2Hash) {
      throw new Error("Session token2Hash does not match");
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

  await config.deleteSession({ tokenHash: token1Hash });
  for (const tokenHash of [token1Hash, token2Hash, token3Hash]) {
    const session = await config.selectSession({ tokenHash });
    if (session !== undefined) {
      console.log(session);
      throw new Error("Session should not be found");
    }
  }
}

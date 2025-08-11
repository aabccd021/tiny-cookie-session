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
 * @property {S} data
 * @property {readonly [string, string | undefined]} latestTokenHash
 */

/**
 * @template S
 * @typedef {Object} NotFoundSession
 * @property {"NotFound"} state
 * @property {Cookie} cookie
 * @property {Date} now
 * @property {string} requestTokenHash
 */

/**
 * @template S
 * @typedef {Object} TokenStolenSession
 * @property {"TokenStolen"} state
 * @property {Cookie} cookie
 * @property {string} id
 * @property {Date} exp
 * @property {Date} tokenExp
 * @property {S} data
 * @property {Date} now
 * @property {string} requestTokenHash
 */

/**
 * @template S
 * @typedef {Object} ExpiredSession
 * @property {"Expired"} state
 * @property {Cookie} cookie
 * @property {string} id
 * @property {Date} exp
 * @property {Date} tokenExp
 * @property {S} data
 * @property {Date} now
 * @property {string} requestTokenHash
 */

/**
 * @template S
 * @typedef {Object} TokenRefreshedSession
 * @property {"TokenRefreshed"} state
 * @property {Cookie} cookie
 * @property {string} id
 * @property {Date} exp
 * @property {Date} tokenExp
 * @property {S} data
 * @property {Date} now
 * @property {string} requestTokenHash
 */

/**
 * @template S
 * @typedef {Object} ActiveSession
 * @property {"Active"} state
 * @property {string} id
 * @property {Date} exp
 * @property {Date} tokenExp
 * @property {S} data
 * @property {Date} now
 * @property {string} requestTokenHash
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
 * @property {function({id: string, exp: Date, tokenHash: string, tokenExp: Date, data: I}): Promise<void>} insertSession
 * @property {function({id: string, exp: Date, tokenExp: Date, tokenHash: string}): Promise<void>} insertTokenAndUpdateSession
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
  // TODO: Remove ts-ignore when https://tc39.es/proposal-arraybuffer-base64 added to typescript
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
  // TODO: Remove ts-ignore when https://tc39.es/proposal-arraybuffer-base64 added to typescript
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
 * @param {{data: I, id: string}} arg
 * @returns {Promise<Cookie>}
 */
export async function login(config, arg) {
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
  const now = config.dateNow?.() ?? new Date();

  if (session === undefined) {
    return {
      state: "NotFound",
      cookie: logoutCookie,
      now,
      requestTokenHash,
    };
  }

  const isSessionToken0 = requestTokenHash === session.latestTokenHash[0];
  const isSessionToken1 = requestTokenHash === session.latestTokenHash[1];

  if (!isSessionToken0 && !isSessionToken1) {
    config.deleteSession({ tokenHash: requestTokenHash });
    return {
      state: "TokenStolen",
      cookie: logoutCookie,
      id: session.id,
      exp: session.exp,
      tokenExp: session.tokenExp,
      data: session.data,
      now,
      requestTokenHash,
    };
  }

  if (session.exp < now) {
    config.deleteSession({ tokenHash: requestTokenHash });
    return {
      state: "Expired",
      cookie: logoutCookie,
      id: session.id,
      exp: session.exp,
      tokenExp: session.tokenExp,
      data: session.data,
      now,
      requestTokenHash,
    };
  }

  if (session.tokenExp <= now && isSessionToken0) {
    const { cookie, tokenHash } = await createNewTokenCookie(config);
    const exp = new Date(now.getTime() + config.sessionExpiresIn);
    const tokenExp = new Date(now.getTime() + config.tokenExpiresIn);
    config.insertTokenAndUpdateSession({
      id: session.id,
      tokenHash,
      exp,
      tokenExp,
    });
    return {
      state: "TokenRefreshed",
      id: session.id,
      data: session.data,
      cookie,
      exp,
      tokenExp,
      now,
      requestTokenHash,
    };
  }

  return {
    state: "Active",
    id: session.id,
    exp: session.exp,
    tokenExp: session.tokenExp,
    data: session.data,
    now,
    requestTokenHash,
  };
}

/**
 * @template S
 * @template I
 * @param {Config<S, I>} config
 * @param {{data: I, id: string}} argSession
 * @returns {Promise<void>}
 */
export async function testConfig(config, argSession) {
  if (config.tokenExpiresIn >= config.sessionExpiresIn) {
    throw new Error("tokenExpiresIn must be less than sessionExpiresIn");
  }

  const latestTokenHash1 = await hashToken(generateToken());
  const latestTokenHash2 = await hashToken(generateToken());
  const latestTokenHash3 = await hashToken(generateToken());

  const start = new Date();
  await config.insertSession({
    id: argSession.id,
    tokenHash: latestTokenHash3,
    exp: new Date(start.getTime() + config.sessionExpiresIn),
    tokenExp: new Date(start.getTime() + config.tokenExpiresIn),
    data: argSession.data,
  });

  await config.insertTokenAndUpdateSession({
    id: argSession.id,
    tokenHash: latestTokenHash2,
    exp: new Date(start.getTime() + 10000 + config.sessionExpiresIn),
    tokenExp: new Date(start.getTime() + 1000 + config.tokenExpiresIn),
  });

  await config.insertTokenAndUpdateSession({
    id: argSession.id,
    tokenHash: latestTokenHash1,
    exp: new Date(start.getTime() + 20000 + config.sessionExpiresIn),
    tokenExp: new Date(start.getTime() + 2000 + config.tokenExpiresIn),
  });

  for (const tokenHash of [latestTokenHash1, latestTokenHash2, latestTokenHash3]) {
    const session = await config.selectSession({ tokenHash });
    if (session === undefined) {
      throw new Error("Session not found");
    }

    if (session.id !== argSession.id) {
      throw new Error("Session id does not match");
    }

    if (session.latestTokenHash[0] !== latestTokenHash1) {
      throw new Error("Session latestTokenHash1 does not match");
    }

    if (session.latestTokenHash[1] !== latestTokenHash2) {
      throw new Error("Session latestTokenHash2 does not match");
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

  await config.deleteSession({ tokenHash: latestTokenHash1 });
  for (const tokenHash of [latestTokenHash1, latestTokenHash2, latestTokenHash3]) {
    const session = await config.selectSession({ tokenHash });
    if (session !== undefined) {
      console.log(session);
      throw new Error("Session should not be found");
    }
  }
}

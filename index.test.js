import { consumeSession, login, logout, testConfig } from ".";

/**
 * @typedef {Object} DBSession
 * @property {string[]} tokenHashes
 * @property {Date} tokenExp
 * @property {Date} exp
 * @property {string} userId
 */

/**
 * @param {Object} [state]
 * @param {Record<string, DBSession>} [state.sessions]
 * @param {Date} [state.date]
 */
function createConfig(state) {
  const sessions = state?.sessions ?? {};
  return {
    dateNow: () => state?.date ?? new Date(),
    tokenExpiresIn: 10 * 60 * 1000,
    sessionExpiresIn: 5 * 60 * 60 * 1000,

    /**
     * @param {Object} argSession
     * @param {string} argSession.tokenHash
     * @returns {Promise<{id: string, latestTokenHash: readonly [string, string|undefined], exp: Date, tokenExp: Date, data: {userId: string}} | undefined>}
     */
    selectSession: async (argSession) => {
      for (const [id, session] of Object.entries(sessions)) {
        const [latestTokenHash1, latestTokenHash2] = session.tokenHashes.toReversed();
        if (latestTokenHash1 !== undefined && session.tokenHashes.includes(argSession.tokenHash)) {
          return {
            id,
            latestTokenHash: [latestTokenHash1, latestTokenHash2],
            exp: session.exp,
            tokenExp: session.tokenExp,
            data: {
              userId: session.userId,
            },
          };
        }
      }

      return undefined;
    },

    /**
     * @param {Object} argSession
     * @param {string} argSession.id
     * @param {Date} argSession.exp
     * @param {Date} argSession.tokenExp
     * @param {string} argSession.tokenHash
     * @param {Object} argSession.data
     * @param {string} argSession.data.userId
     */
    insertSession: async (argSession) => {
      sessions[argSession.id] = {
        exp: argSession.exp,
        tokenExp: argSession.tokenExp,
        tokenHashes: [argSession.tokenHash],
        userId: argSession.data.userId,
      };
    },

    /**
     * @param {Object} argSession
     * @param {string} argSession.id
     * @param {Date} argSession.exp
     * @param {string} argSession.tokenHash
     * @param {Date} argSession.tokenExp
     */
    updateSession: async (argSession) => {
      const session = sessions[argSession.id];
      if (session === undefined) throw new Error();

      session.tokenHashes.push(argSession.tokenHash);
      session.tokenExp = argSession.tokenExp;
      session.exp = argSession.exp;
    },

    /**
     * @param {Object} argSession
     * @param {string} argSession.tokenHash
     */
    deleteSession: async (argSession) => {
      const sessionEntry = Object.entries(sessions).find(([_, session]) =>
        session.tokenHashes.includes(argSession.tokenHash),
      );
      if (sessionEntry === undefined) throw new Error();

      const [id] = sessionEntry;
      delete sessions[id];
    },
  };
}

{
  console.info("# testConfig");
  const config = createConfig();
  testConfig(config, [
    {
      id: crypto.randomUUID(),
      data: { userId: "test-user-1" },
    },
    {
      id: crypto.randomUUID(),
      data: { userId: "test-user-2" },
    },
    {
      id: crypto.randomUUID(),
      data: { userId: "test-user-3" },
    },
    {
      id: crypto.randomUUID(),
      data: { userId: "test-user-3" },
    },
  ]);
}

{
  console.info("# login");
  const state = { date: new Date("2023-10-01T00:00:00Z") };
  const config = createConfig(state);

  const cookie = await login(config, {
    id: "test-session-id",
    data: { userId: "test-user-id" },
  });
  const token = cookie.value;

  if (cookie.options.expires?.toISOString() !== "2023-10-01T05:00:00.000Z") throw new Error();
  if (token.length !== 64) throw new Error();
  if (!/^[a-zA-Z0-9]*$/.test(token)) throw new Error();
}

{
  console.info("# logout");
  const state = { date: new Date("2023-10-01T00:00:00Z") };
  const config = createConfig(state);

  let cookie = await login(config, {
    id: "test-session-id",
    data: { userId: "test-user-id" },
  });
  const token = cookie.value;

  state.date = new Date("2023-10-01T00:01:00Z");
  cookie = await logout(config, { token });

  if (cookie.value !== "") throw new Error();
  if (cookie.options.maxAge !== 0) throw new Error();
}

{
  console.info("# consumeSession: state NotFound for unknown token");
  const config = createConfig();

  const session = await consumeSession(config, { token: "unknown-token" });
  if (session.state !== "NotFound") throw new Error();

  if (session.cookie.value !== "") throw new Error();
  if (session.cookie.options.maxAge !== 0) throw new Error();
}

{
  console.info("# consumeSession: state Active after login");
  const state = { date: new Date("2023-10-01T00:00:00Z") };
  const config = createConfig(state);

  const cookie = await login(config, {
    id: "test-session-id",
    data: { userId: "test-user-id" },
  });
  const token = cookie.value;

  const session = await consumeSession(config, { token });
  if (session.state !== "Active") throw new Error();

  if (session.id !== "test-session-id") throw new Error();
  if (session.exp.toISOString() !== "2023-10-01T05:00:00.000Z") throw new Error();
  if (session.tokenExp.toISOString() !== "2023-10-01T00:10:00.000Z") throw new Error();
  if (session.data.userId !== "test-user-id") throw new Error();
}

{
  console.info("# consumeSession: state Active after 9 minutes");
  const state = { date: new Date("2023-10-01T00:00:00Z") };
  const config = createConfig(state);

  const cookie = await login(config, {
    id: "test-session-id",
    data: { userId: "test-user-id" },
  });
  const token = cookie.value;

  state.date = new Date("2023-10-01T00:09:00Z");
  const session = await consumeSession(config, { token });
  if (session.state !== "Active") throw new Error();

  if (session.id !== "test-session-id") throw new Error();
  if (session.exp.toISOString() !== "2023-10-01T05:00:00.000Z") throw new Error();
  if (session.tokenExp.toISOString() !== "2023-10-01T00:10:00.000Z") throw new Error();
  if (session.data.userId !== "test-user-id") throw new Error();
}

{
  console.info("# consumeSession: state TokenRotated after 11 minutes");
  const state = { date: new Date("2023-10-01T00:00:00Z") };
  const config = createConfig(state);

  const cookie = await login(config, {
    id: "test-session-id",
    data: { userId: "test-user-id" },
  });
  let token = cookie.value;

  state.date = new Date("2023-10-01T00:11:00Z");
  const session = await consumeSession(config, { token });

  if (session.state !== "TokenRotated") throw new Error();

  token = session.cookie.value;

  if (session.id !== "test-session-id") throw new Error();
  if (session.exp.toISOString() !== "2023-10-01T05:11:00.000Z") throw new Error();
  if (session.tokenExp.toISOString() !== "2023-10-01T00:21:00.000Z") throw new Error();
  if (session.data.userId !== "test-user-id") throw new Error();
  if (token.length !== 64) throw new Error();
  if (/^[a-zA-Z0-9]*$/.test(token) !== true) throw new Error();
  if (session.cookie.options.expires?.toISOString() !== "2023-10-01T05:11:00.000Z")
    throw new Error();
}

{
  console.info("# consumeSession: state Active after TokenRotated");
  const state = { date: new Date("2023-10-01T00:00:00Z") };
  const config = createConfig(state);

  const cookie = await login(config, {
    id: "test-session-id",
    data: { userId: "test-user-id" },
  });
  let token = cookie.value;

  state.date = new Date("2023-10-01T00:11:00Z");
  let session = await consumeSession(config, { token });
  if (session.state !== "TokenRotated") throw new Error();

  token = session.cookie.value;

  session = await consumeSession(config, { token });
  if (session.state !== "Active") throw new Error();

  if (session.id !== "test-session-id") throw new Error();
  if (session.data.userId !== "test-user-id") throw new Error();
  if (session.exp.toISOString() !== "2023-10-01T05:11:00.000Z") throw new Error();
  if (session.tokenExp.toISOString() !== "2023-10-01T00:21:00.000Z") throw new Error();
}

{
  console.info("# consumeSession: state Expired after 6 hours");
  const state = { date: new Date("2023-10-01T00:00:00Z") };
  const config = createConfig(state);

  const cookie = await login(config, {
    id: "test-session-id",
    data: { userId: "test-user-id" },
  });
  const token = cookie.value;

  state.date = new Date("2023-10-01T06:00:00Z");
  const session = await consumeSession(config, { token });
  if (session.state !== "Expired") throw new Error();

  if (session.id !== "test-session-id") throw new Error();
  if (session.data.userId !== "test-user-id") throw new Error();
  if (session.exp.toISOString() !== "2023-10-01T05:00:00.000Z") throw new Error();
  if (session.tokenExp.toISOString() !== "2023-10-01T00:10:00.000Z") throw new Error();
  if (session.cookie.value !== "") throw new Error();
  if (session.cookie.options.maxAge !== 0) throw new Error();
}

{
  console.info("# consumeSession: state NotFound after Expired");
  const state = { date: new Date("2023-10-01T00:00:00Z") };
  const config = createConfig(state);

  const cookie = await login(config, {
    id: "test-session-id",
    data: { userId: "test-user-id" },
  });
  const token = cookie.value;

  state.date = new Date("2023-10-01T06:00:00Z");
  let session = await consumeSession(config, { token });
  if (session.state !== "Expired") throw new Error();

  session = await consumeSession(config, { token });
  if (session.state !== "NotFound") throw new Error();

  if (session.cookie.value !== "") throw new Error();
  if (session.cookie.options.maxAge !== 0) throw new Error();
}

{
  console.info("# consumeSession: state Active after TokenRotated twice");
  const state = { date: new Date("2023-10-01T00:00:00Z") };
  const config = createConfig(state);

  const cookie = await login(config, {
    id: "test-session-id",
    data: { userId: "test-user-id" },
  });
  let token = cookie.value;

  state.date = new Date("2023-10-01T00:11:00Z");
  let session = await consumeSession(config, { token });
  if (session.state !== "TokenRotated") throw new Error();
  token = session.cookie.value;

  state.date = new Date("2023-10-01T00:22:00Z");
  session = await consumeSession(config, { token });
  if (session.state !== "TokenRotated") throw new Error();
  token = session.cookie.value;

  session = await consumeSession(config, { token });
  if (session.state !== "Active") throw new Error();
}

{
  console.info("# consumeSession: state NotFound after logout");
  const state = { date: new Date("2023-10-01T00:00:00Z") };
  const config = createConfig(state);

  let cookie = await login(config, {
    id: "test-session-id",
    data: { userId: "test-user-id" },
  });
  let token = cookie.value;

  state.date = new Date("2023-10-01T00:11:00Z");
  cookie = await logout(config, { token });
  token = cookie.value;

  const session = await consumeSession(config, { token });
  if (session.state !== "NotFound") throw new Error();

  if (session.cookie.value !== "") throw new Error();
  if (session.cookie.options.maxAge !== 0) throw new Error();
}

{
  console.info("# consumeSession: state Active after re-login");
  const state = { date: new Date("2023-10-01T00:00:00Z") };
  const config = createConfig(state);

  let cookie = await login(config, {
    id: "test-session-id",
    data: { userId: "test-user-id" },
  });
  let token = cookie.value;

  state.date = new Date("2023-10-01T00:11:00Z");
  cookie = await logout(config, { token });
  token = cookie.value;

  state.date = new Date("2023-10-01T00:14:00Z");
  cookie = await login(config, {
    id: "test-session-id",
    data: { userId: "test-user-id" },
  });

  const session = await consumeSession(config, { token: cookie.value });
  if (session.state !== "Active") throw new Error();
}

{
  console.info("# consumeSession: state TokenStolen, user, user, attacker");
  const state = { date: new Date("2023-10-01T00:00:00Z") };
  const config = createConfig(state);

  const userCookie = await login(config, {
    id: "test-session-id",
    data: { userId: "test-user-id" },
  });
  let userToken = userCookie.value;

  const attackerToken = userToken;

  state.date = new Date("2023-10-01T00:11:00Z");
  let userSession = await consumeSession(config, { token: userToken });
  if (userSession.state !== "TokenRotated") throw new Error();
  userToken = userSession.cookie.value;

  state.date = new Date("2023-10-01T00:22:00Z");
  userSession = await consumeSession(config, { token: userToken });
  if (userSession.state !== "TokenRotated") throw new Error();
  userToken = userSession.cookie.value;

  const attackerSession = await consumeSession(config, { token: attackerToken });
  if (attackerSession.state !== "TokenStolen") throw new Error();
  if (attackerSession.id !== "test-session-id") throw new Error();
  if (attackerSession.data.userId !== "test-user-id") throw new Error();
  if (attackerSession.exp.toISOString() !== "2023-10-01T05:22:00.000Z") throw new Error();
  if (attackerSession.tokenExp.toISOString() !== "2023-10-01T00:32:00.000Z") throw new Error();
  if (attackerSession.cookie.value !== "") throw new Error();
  if (attackerSession.cookie.options.maxAge !== 0) throw new Error();

  userSession = await consumeSession(config, { token: userToken });
  if (userSession.state !== "NotFound") throw new Error();
  if (userSession.cookie.value !== "") throw new Error();
  if (userSession.cookie.options.maxAge !== 0) throw new Error();
}

{
  console.info("# consumeSession: state TokenStolen, attacker, attacker, user");
  const state = { date: new Date("2023-10-01T00:00:00Z") };
  const config = createConfig(state);

  const userCookie = await login(config, {
    id: "test-session-id",
    data: { userId: "test-user-id" },
  });
  const userToken = userCookie.value;

  let attackerToken = userToken;

  state.date = new Date("2023-10-01T00:11:00Z");
  let attackerSession = await consumeSession(config, { token: attackerToken });
  if (attackerSession.state !== "TokenRotated") throw new Error();
  attackerToken = attackerSession.cookie.value;

  state.date = new Date("2023-10-01T00:22:00Z");
  attackerSession = await consumeSession(config, { token: attackerToken });
  if (attackerSession.state !== "TokenRotated") throw new Error();
  attackerToken = attackerSession.cookie.value;

  const userSession = await consumeSession(config, { token: userToken });
  if (userSession.state !== "TokenStolen") throw new Error();
  if (userSession.id !== "test-session-id") throw new Error();
  if (userSession.data.userId !== "test-user-id") throw new Error();
  if (userSession.exp.toISOString() !== "2023-10-01T05:22:00.000Z") throw new Error();
  if (userSession.tokenExp.toISOString() !== "2023-10-01T00:32:00.000Z") throw new Error();
  if (userSession.cookie.value !== "") throw new Error();
  if (userSession.cookie.options.maxAge !== 0) throw new Error();

  attackerSession = await consumeSession(config, { token: userToken });
  if (attackerSession.state !== "NotFound") throw new Error();
  if (attackerSession.cookie.value !== "") throw new Error();
  if (attackerSession.cookie.options.maxAge !== 0) throw new Error();
}

{
  console.info("# consumeSession: state TokenStolen, attacker, user, attacker, user");
  const state = { date: new Date("2023-10-01T00:00:00Z") };
  const config = createConfig(state);

  const userCookie = await login(config, {
    id: "test-session-id",
    data: { userId: "test-user-id" },
  });
  const userToken = userCookie.value;
  let attackerToken = userToken;

  state.date = new Date("2023-10-01T00:11:00Z");
  let attackerSession = await consumeSession(config, { token: attackerToken });
  if (attackerSession.state !== "TokenRotated") throw new Error();
  attackerToken = attackerSession.cookie.value;

  state.date = new Date("2023-10-01T00:22:00Z");
  let userSession = await consumeSession(config, { token: userToken });
  if (userSession.state !== "Active") throw new Error();

  attackerSession = await consumeSession(config, { token: attackerToken });
  if (attackerSession.state !== "TokenRotated") throw new Error();
  attackerToken = attackerSession.cookie.value;

  userSession = await consumeSession(config, { token: userToken });
  if (userSession.state !== "TokenStolen") throw new Error();
}

{
  console.info("# consumeSession: state TokenStolen, user, attacker, user, attacker");
  const state = { date: new Date("2023-10-01T00:00:00Z") };
  const config = createConfig(state);

  const userCookie = await login(config, {
    id: "test-session-id",
    data: { userId: "test-user-id" },
  });
  let userToken = userCookie.value;
  const attackerToken = userToken;

  state.date = new Date("2023-10-01T00:11:00Z");
  let userSession = await consumeSession(config, { token: userToken });
  if (userSession.state !== "TokenRotated") throw new Error();
  userToken = userSession.cookie.value;

  state.date = new Date("2023-10-01T00:22:00Z");
  let attackerSession = await consumeSession(config, { token: attackerToken });
  if (attackerSession.state !== "Active") throw new Error();

  userSession = await consumeSession(config, { token: userToken });
  if (userSession.state !== "TokenRotated") throw new Error();
  userToken = userSession.cookie.value;

  attackerSession = await consumeSession(config, { token: attackerToken });
  if (attackerSession.state !== "TokenStolen") throw new Error();
}

{
  console.info("# consumeSession: state Active with second last token");

  const state = { date: new Date("2023-10-01T00:00:00Z") };
  const config = createConfig(state);

  const cookie = await login(config, {
    id: "test-session-id",
    data: { userId: "test-user-id" },
  });
  let token = cookie.value;
  const prevToken = token;

  state.date = new Date("2023-10-01T00:11:00Z");

  let session = await consumeSession(config, { token: prevToken });
  if (session.state !== "TokenRotated") throw new Error();
  token = session.cookie.value;

  session = await consumeSession(config, { token: prevToken });
  if (session.state !== "Active") throw new Error();
}

{
  console.info("# consumeSession: state Active on race condition");

  const state = { date: new Date("2023-10-01T00:00:00Z") };
  const config = createConfig(state);

  const cookie = await login(config, {
    id: "test-session-id",
    data: { userId: "test-user-id" },
  });
  let token = cookie.value;
  const prevToken = token;
  const tokenRotated = Promise.withResolvers();
  const secondRequestFinished = Promise.withResolvers();

  state.date = new Date("2023-10-01T00:11:00Z");

  await Promise.all([
    (async () => {
      const session = await consumeSession(config, { token });

      tokenRotated.resolve(undefined);
      await secondRequestFinished.promise;

      // emulate set-token
      if (session.state === "TokenRotated") {
        token = session.cookie.value;
      } else if (session.state !== "Active") {
        throw new Error();
      }
    })(),

    (async () => {
      await tokenRotated.promise;

      const session = await consumeSession(config, { token });

      // emulate set-token
      if (session.state === "TokenRotated") {
        token = session.cookie.value;
      } else if (session.state !== "Active") {
        throw new Error();
      }

      secondRequestFinished.resolve(undefined);
    })(),
  ]);

  if (prevToken === token) throw new Error();
}

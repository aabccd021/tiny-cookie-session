import { consumeSession, login, logout, testConfig } from "./session.js";

/**
 * Asserts that the actual value equals the expected value.
 * Throws an AssertionError if the values are not equal.
 *
 * @template {string | boolean | number | undefined | null} T
 * @param {T} actual - The actual value to compare
 * @param {T} expected - The expected value to compare against
 * @param {string} [message] - Optional error message to display if assertion fails
 * @throws {Error} Throws an AssertionError if actual does not equal expected
 */
function assertEq(actual, expected, message) {
  if (expected !== actual) {
    console.error("Expected", expected);
    console.error("Found", actual);
    const err = new Error(message);
    err.name = "AssertionError";
    if ("captureStackTrace" in Error && typeof Error.captureStackTrace === "function") {
      Error.captureStackTrace(err, assertEq);
    }
    throw err;
  }
}

/**
 * Represents a database session.
 *
 * @typedef {Object} DBSession
 * @property {string[]} tokenHashes - Array of token hashes associated with the session
 * @property {Date} tokenExp - Token expiration date
 * @property {Date} exp - Session expiration date
 * @property {string} userId - User identifier for the session
 */

/**
 * Creates a configuration object for session management.
 *
 * @param {Object} [state] - Initial state for the configuration
 * @param {Record<string, DBSession>} [state.sessions] - Map of session IDs to session data
 * @param {Date} [state.date] - Current date to use for time-based operations
 */
function createConfig(state) {
  const sessions = state?.sessions ?? {};
  return {
    dateNow: () => state?.date ?? new Date(),
    tokenExpiresIn: 10 * 60 * 1000,
    sessionExpiresIn: 5 * 60 * 60 * 1000,

    /**
     * Selects a session based on token hash.
     *
     * @async
     * @param {Object} argSession - Arguments for selecting a session
     * @param {string} argSession.tokenHash - Hash of the token to look up
     * @returns {Promise<{id: string, latestTokenHash: readonly [string, string|undefined], exp: Date, tokenExp: Date, data: {userId: string}} | undefined>}
     *   The session if found, undefined otherwise
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
     * Inserts a new session into the database.
     *
     * @async
     * @param {Object} argSession - Session information to insert
     * @param {string} argSession.id - Session identifier
     * @param {Date} argSession.exp - Session expiration date
     * @param {Date} argSession.tokenExp - Token expiration date
     * @param {string} argSession.tokenHash - Hash of the session token
     * @param {Object} argSession.data - Additional session data
     * @param {string} argSession.data.userId - User identifier for the session
     * @returns {Promise<void>}
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
     * Inserts a new token and updates the session data.
     *
     * @async
     * @param {Object} argSession - Session information to update
     * @param {string} argSession.id - Session identifier
     * @param {Date} argSession.exp - New session expiration date
     * @param {string} argSession.tokenHash - Hash of the new token
     * @param {Date} argSession.tokenExp - New token expiration date
     * @returns {Promise<void>}
     * @throws {Error} If the session with the given ID does not exist
     */
    insertTokenAndUpdateSession: async (argSession) => {
      const session = sessions[argSession.id];
      if (session === undefined) throw new Error(`Session not found with id: ${argSession.id}`);

      session.tokenHashes.push(argSession.tokenHash);
      session.tokenExp = argSession.tokenExp;
      session.exp = argSession.exp;
    },

    /**
     * Deletes a session based on token hash.
     *
     * @async
     * @param {Object} argSession - Arguments for deleting a session
     * @param {string} argSession.tokenHash - Hash of the token to look up
     * @returns {Promise<void>}
     * @throws {Error} If no session is found with the given token hash
     */
    deleteSession: async (argSession) => {
      const sessionEntry = Object.entries(sessions).find(([_, session]) =>
        session.tokenHashes.includes(argSession.tokenHash),
      );
      if (sessionEntry === undefined)
        throw new Error(`Session not found with token: ${argSession.tokenHash}`);

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
      data: { userId: "test-user" },
    },
    {
      id: crypto.randomUUID(),
      data: { userId: "test-user-2" },
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

  assertEq(cookie.options.expires?.toISOString(), "2023-10-01T05:00:00.000Z");
  assertEq(token.length, 64);
  assertEq(/^[a-zA-Z0-9]*$/.test(token), true, token);
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

  assertEq(cookie.value, "");
  assertEq(cookie.options.maxAge, 0);
}

{
  console.info("# consumeSession: state NotFound for unknown token");
  const config = createConfig();

  const session = await consumeSession(config, { token: "unknown-token" });
  if (session.state !== "NotFound") throw new Error(session.state);

  assertEq(session.cookie.value, "");
  assertEq(session.cookie.options.maxAge, 0);
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
  if (session.state !== "Active") throw new Error(session.state);

  assertEq(session.id, "test-session-id");
  assertEq(session.exp.toISOString(), "2023-10-01T05:00:00.000Z");
  assertEq(session.tokenExp.toISOString(), "2023-10-01T00:10:00.000Z");
  assertEq(session.data.userId, "test-user-id");
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
  if (session.state !== "Active") throw new Error(session.state);

  assertEq(session.id, "test-session-id");
  assertEq(session.exp.toISOString(), "2023-10-01T05:00:00.000Z");
  assertEq(session.tokenExp.toISOString(), "2023-10-01T00:10:00.000Z");
  assertEq(session.data.userId, "test-user-id");
}

{
  console.info("# consumeSession: state TokenRefreshed after 11 minutes");
  const state = { date: new Date("2023-10-01T00:00:00Z") };
  const config = createConfig(state);

  const cookie = await login(config, {
    id: "test-session-id",
    data: { userId: "test-user-id" },
  });
  let token = cookie.value;

  state.date = new Date("2023-10-01T00:11:00Z");
  const session = await consumeSession(config, { token });

  if (session.state !== "TokenRefreshed") throw new Error(session.state);

  token = session.cookie.value;

  assertEq(session.id, "test-session-id");
  assertEq(session.exp.toISOString(), "2023-10-01T05:11:00.000Z");
  assertEq(session.tokenExp.toISOString(), "2023-10-01T00:21:00.000Z");
  assertEq(session.data.userId, "test-user-id");
  assertEq(token.length, 64);
  assertEq(/^[a-zA-Z0-9]*$/.test(token), true, token);
  assertEq(session.cookie.options.expires?.toISOString(), "2023-10-01T05:11:00.000Z");
}

{
  console.info("# consumeSession: state Active after TokenRefreshed");
  const state = { date: new Date("2023-10-01T00:00:00Z") };
  const config = createConfig(state);

  const cookie = await login(config, {
    id: "test-session-id",
    data: { userId: "test-user-id" },
  });
  let token = cookie.value;

  state.date = new Date("2023-10-01T00:11:00Z");
  let session = await consumeSession(config, { token });
  if (session.state !== "TokenRefreshed") throw new Error(session.state);

  token = session.cookie.value;

  session = await consumeSession(config, { token });
  if (session.state !== "Active") throw new Error(session.state);

  assertEq(session.id, "test-session-id");
  assertEq(session.data.userId, "test-user-id");
  assertEq(session.exp.toISOString(), "2023-10-01T05:11:00.000Z");
  assertEq(session.tokenExp.toISOString(), "2023-10-01T00:21:00.000Z");
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
  if (session.state !== "Expired") throw new Error(session.state);

  assertEq(session.id, "test-session-id");
  assertEq(session.data.userId, "test-user-id");
  assertEq(session.exp.toISOString(), "2023-10-01T05:00:00.000Z");
  assertEq(session.tokenExp.toISOString(), "2023-10-01T00:10:00.000Z");
  assertEq(session.cookie.value, "");
  assertEq(session.cookie.options.maxAge, 0);
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
  if (session.state !== "Expired") throw new Error(session.state);

  session = await consumeSession(config, { token });
  if (session.state !== "NotFound") throw new Error(session.state);

  assertEq(session.cookie.value, "");
  assertEq(session.cookie.options.maxAge, 0);
}

{
  console.info("# consumeSession: state Active after TokenRefreshed twice");
  const state = { date: new Date("2023-10-01T00:00:00Z") };
  const config = createConfig(state);

  const cookie = await login(config, {
    id: "test-session-id",
    data: { userId: "test-user-id" },
  });
  let token = cookie.value;

  state.date = new Date("2023-10-01T00:11:00Z");
  let session = await consumeSession(config, { token });
  if (session.state !== "TokenRefreshed") throw new Error(session.state);
  token = session.cookie.value;

  state.date = new Date("2023-10-01T00:22:00Z");
  session = await consumeSession(config, { token });
  if (session.state !== "TokenRefreshed") throw new Error(session.state);
  token = session.cookie.value;

  session = await consumeSession(config, { token });
  if (session.state !== "Active") throw new Error(session.state);
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
  if (session.state !== "NotFound") throw new Error(session.state);

  assertEq(session.cookie.value, "");
  assertEq(session.cookie.options.maxAge, 0);
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
  if (session.state !== "Active") throw new Error(session.state);
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
  if (userSession.state !== "TokenRefreshed") throw new Error(userSession.state);
  userToken = userSession.cookie.value;

  state.date = new Date("2023-10-01T00:22:00Z");
  userSession = await consumeSession(config, { token: userToken });
  if (userSession.state !== "TokenRefreshed") throw new Error(userSession.state);
  userToken = userSession.cookie.value;

  const attackerSession = await consumeSession(config, { token: attackerToken });
  if (attackerSession.state !== "TokenStolen") throw new Error(attackerSession.state);
  assertEq(attackerSession.id, "test-session-id");
  assertEq(attackerSession.data.userId, "test-user-id");
  assertEq(attackerSession.exp.toISOString(), "2023-10-01T05:22:00.000Z");
  assertEq(attackerSession.tokenExp.toISOString(), "2023-10-01T00:32:00.000Z");
  assertEq(attackerSession.cookie.value, "");
  assertEq(attackerSession.cookie.options.maxAge, 0);

  userSession = await consumeSession(config, { token: userToken });
  if (userSession.state !== "NotFound") throw new Error(userSession.state);
  assertEq(userSession.cookie.value, "");
  assertEq(userSession.cookie.options.maxAge, 0);
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
  if (attackerSession.state !== "TokenRefreshed") throw new Error(attackerSession.state);
  attackerToken = attackerSession.cookie.value;

  state.date = new Date("2023-10-01T00:22:00Z");
  attackerSession = await consumeSession(config, { token: attackerToken });
  if (attackerSession.state !== "TokenRefreshed") throw new Error(attackerSession.state);
  attackerToken = attackerSession.cookie.value;

  const userSession = await consumeSession(config, { token: userToken });
  if (userSession.state !== "TokenStolen") throw new Error(userSession.state);
  assertEq(userSession.id, "test-session-id");
  assertEq(userSession.data.userId, "test-user-id");
  assertEq(userSession.exp.toISOString(), "2023-10-01T05:22:00.000Z");
  assertEq(userSession.tokenExp.toISOString(), "2023-10-01T00:32:00.000Z");
  assertEq(userSession.cookie.value, "");
  assertEq(userSession.cookie.options.maxAge, 0);

  attackerSession = await consumeSession(config, { token: userToken });
  if (attackerSession.state !== "NotFound") throw new Error(attackerSession.state);
  assertEq(attackerSession.cookie.value, "");
  assertEq(attackerSession.cookie.options.maxAge, 0);
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
  if (attackerSession.state !== "TokenRefreshed") throw new Error(attackerSession.state);
  attackerToken = attackerSession.cookie.value;

  state.date = new Date("2023-10-01T00:22:00Z");
  let userSession = await consumeSession(config, { token: userToken });
  if (userSession.state !== "Active") throw new Error(userSession.state);

  attackerSession = await consumeSession(config, { token: attackerToken });
  if (attackerSession.state !== "TokenRefreshed") throw new Error(attackerSession.state);
  attackerToken = attackerSession.cookie.value;

  userSession = await consumeSession(config, { token: userToken });
  if (userSession.state !== "TokenStolen") throw new Error(userSession.state);
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
  if (userSession.state !== "TokenRefreshed") throw new Error(userSession.state);
  userToken = userSession.cookie.value;

  state.date = new Date("2023-10-01T00:22:00Z");
  let attackerSession = await consumeSession(config, { token: attackerToken });
  if (attackerSession.state !== "Active") throw new Error(attackerSession.state);

  userSession = await consumeSession(config, { token: userToken });
  if (userSession.state !== "TokenRefreshed") throw new Error(userSession.state);
  userToken = userSession.cookie.value;

  attackerSession = await consumeSession(config, { token: attackerToken });
  if (attackerSession.state !== "TokenStolen") throw new Error(attackerSession.state);
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
  if (session.state !== "TokenRefreshed") throw new Error(session.state);
  token = session.cookie.value;

  session = await consumeSession(config, { token: prevToken });
  if (session.state !== "Active") throw new Error(session.state);
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
  const tokenRefreshed = Promise.withResolvers();
  const secondRequestFinished = Promise.withResolvers();

  state.date = new Date("2023-10-01T00:11:00Z");

  await Promise.all([
    (async () => {
      const session = await consumeSession(config, { token });

      tokenRefreshed.resolve(undefined);
      await secondRequestFinished.promise;

      // emulate set-token
      if (session.state === "TokenRefreshed") {
        token = session.cookie.value;
      } else if (session.state !== "Active") {
        throw new Error(session.state);
      }
    })(),

    (async () => {
      await tokenRefreshed.promise;

      const session = await consumeSession(config, { token });

      // emulate set-token
      if (session.state === "TokenRefreshed") {
        token = session.cookie.value;
      } else if (session.state !== "Active") {
        throw new Error(session.state);
      }

      secondRequestFinished.resolve(undefined);
    })(),
  ]);

  assertEq(prevToken !== token, true);
}

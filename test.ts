import { consumeSession, login, logout, testConfig } from "./session.js";

function assertEq<T extends string | boolean | number | undefined | null>(
  actual: T,
  expected: T,
  message?: string,
) {
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

type DBSession = {
  tokenHashes: string[];
  tokenExp: Date;
  exp: Date;
  userId: string;
};

function createConfig(state?: { sessions?: Record<string, DBSession>; date?: Date }) {
  const sessions = state?.sessions ?? {};
  return {
    dateNow: () => state?.date ?? new Date(),
    tokenExpiresIn: 10 * 60 * 1000,
    sessionExpiresIn: 5 * 60 * 60 * 1000,
    selectSession: async (argSession: { tokenHash: string }) => {
      for (const [id, session] of Object.entries(sessions)) {
        const [latestTokenHash1, latestTokenHash2] = session.tokenHashes.toReversed();
        if (latestTokenHash1 !== undefined && session.tokenHashes.includes(argSession.tokenHash)) {
          return {
            id,
            latestTokenHash: [latestTokenHash1, latestTokenHash2] as const,
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
    insertSession: async (argSession: {
      id: string;
      exp: Date;
      tokenExp: Date;
      tokenHash: string;
      data: { userId: string };
    }) => {
      sessions[argSession.id] = {
        exp: argSession.exp,
        tokenExp: argSession.tokenExp,
        tokenHashes: [argSession.tokenHash],
        userId: argSession.data.userId,
      };
    },
    insertTokenAndUpdateSession: async (argSession: {
      id: string;
      exp: Date;
      tokenHash: string;
      tokenExp: Date;
    }) => {
      const session = sessions[argSession.id];
      if (session === undefined) throw new Error(`Session not found with id: ${argSession.id}`);

      session.tokenHashes.push(argSession.tokenHash);
      session.tokenExp = argSession.tokenExp;
      session.exp = argSession.exp;
    },
    deleteSession: async (argSession: { tokenHash: string }) => {
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
  console.info("# consumeSession: state NotFound");
  const config = createConfig();

  const session = await consumeSession(config, { token: "unknown-token" });
  if (session.state !== "NotFound") throw new Error(session.state);

  assertEq(session.cookie.value, "");
  assertEq(session.cookie.options.maxAge, 0);
}

{
  console.info("# consumeSession: state Active");
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
  console.info("# consumeSession: state TokenStolen, user, user, attacker, user");
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
  console.info("# consumeSession: state TokenStolen, attacker, attacker, user, attacker");
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

// consume when attacker token is 2

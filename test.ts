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

  assertEq(cookie.options.httpOnly, true);
  assertEq(cookie.options.secure, true);
  assertEq(cookie.options.sameSite, "lax");
  assertEq(cookie.options.path, "/");
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
  assertEq(cookie.options.httpOnly, true);
  assertEq(cookie.options.secure, true);
  assertEq(cookie.options.sameSite, "lax");
  assertEq(cookie.options.path, "/");
  assertEq(cookie.options.expires?.toISOString(), undefined);
}

{
  console.info("# consumeSession: state NotFound");
  const config = createConfig();

  const session = await consumeSession(config, { token: "unknown-token" });
  if (session.state !== "NotFound") throw new Error(session.state);

  assertEq(session.cookie.value, "");
  assertEq(session.cookie.options.maxAge, 0);
  assertEq(session.cookie.options.httpOnly, true);
  assertEq(session.cookie.options.secure, true);
  assertEq(session.cookie.options.sameSite, "lax");
  assertEq(session.cookie.options.path, "/");
  assertEq(session.cookie.options.expires?.toISOString(), undefined);
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
  assertEq(session.cookie.options.httpOnly, true);
  assertEq(session.cookie.options.secure, true);
  assertEq(session.cookie.options.sameSite, "lax");
  assertEq(session.cookie.options.path, "/");
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
  assertEq(session.cookie.options.httpOnly, true);
  assertEq(session.cookie.options.secure, true);
  assertEq(session.cookie.options.sameSite, "lax");
  assertEq(session.cookie.options.path, "/");
  assertEq(session.cookie.options.expires?.toISOString(), undefined);
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
  assertEq(session.cookie.options.httpOnly, true);
  assertEq(session.cookie.options.secure, true);
  assertEq(session.cookie.options.sameSite, "lax");
  assertEq(session.cookie.options.path, "/");
  assertEq(session.cookie.options.expires?.toISOString(), undefined);
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

  assertEq(session.id, "test-session-id");
  assertEq(session.data.userId, "test-user-id");
  assertEq(session.exp.toISOString(), "2023-10-01T05:22:00.000Z");
  assertEq(session.tokenExp.toISOString(), "2023-10-01T00:32:00.000Z");
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
  assertEq(session.cookie.options.httpOnly, true);
  assertEq(session.cookie.options.secure, true);
  assertEq(session.cookie.options.sameSite, "lax");
  assertEq(session.cookie.options.path, "/");
  assertEq(session.cookie.options.expires?.toISOString(), undefined);
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
  assertEq(session.id, "test-session-id");
  assertEq(session.data.userId, "test-user-id");
  assertEq(session.exp.toISOString(), "2023-10-01T05:14:00.000Z");
  assertEq(session.tokenExp.toISOString(), "2023-10-01T00:24:00.000Z");
  assertEq(cookie.value.length, 64);
  assertEq(/^[a-zA-Z0-9]*$/.test(cookie.value), true, cookie.value);
  assertEq(cookie.options.httpOnly, true);
  assertEq(cookie.options.secure, true);
  assertEq(cookie.options.sameSite, "lax");
  assertEq(cookie.options.path, "/");
  assertEq(cookie.options.expires?.toISOString(), "2023-10-01T05:14:00.000Z");
}

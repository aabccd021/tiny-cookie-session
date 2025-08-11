import { consumeSession, login, testConfig } from "./session.js";

type Session = {
  tokenHashes: string[];
  tokenExp: Date;
  exp: Date;
  userId: string;
};

function assertionError(
  actual: unknown,
  expected: unknown,
  message: string | undefined,
  traceFrom?: unknown,
): Error {
  const err = new Error(message);
  if ("captureStackTrace" in Error && typeof Error.captureStackTrace === "function") {
    Error.captureStackTrace(err, traceFrom ?? assertionError);
  }
  err.name = "AssertionError";
  err.message = `Expected ${expected}, but found ${actual}. ${message ?? ""}`;
  return err;
}

function assertEq<T extends string | boolean | number | undefined | null>(
  actual: T,
  expected: T,
  message?: string,
) {
  if (actual !== expected) {
    throw assertionError(actual, expected, message, assertEq);
  }
}

function createConfig(state?: { sessions?: Record<string, Session>; date?: Date }) {
  const sessions = state?.sessions ?? {};
  return {
    dateNow: () => state?.date ?? new Date(),
    tokenExpiresIn: 10 * 60 * 1000,
    sessionExpiresIn: 5 * 60 * 60 * 1000,
    selectSession: async (session: { tokenHash: string }) => {
      for (const [id, dbSession] of Object.entries(sessions)) {
        const [token1Hash, token2Hash] = dbSession.tokenHashes.toReversed();
        if (token1Hash !== undefined && dbSession.tokenHashes.includes(session.tokenHash)) {
          return {
            id,
            token1Hash,
            token2Hash,
            exp: dbSession.exp,
            tokenExp: dbSession.tokenExp,
            extra: {
              userId: dbSession.userId,
            },
          };
        }
      }

      return undefined;
    },
    insertSession: async (session: {
      id: string;
      exp: Date;
      tokenExp: Date;
      tokenHash: string;
      extra: { userId: string };
    }) => {
      sessions[session.id] = {
        exp: session.exp,
        tokenExp: session.tokenExp,
        tokenHashes: [session.tokenHash],
        userId: session.extra.userId,
      };
    },
    insertTokenAndUpdateSession: async (session: {
      id: string;
      exp: Date;
      tokenHash: string;
      tokenExp: Date;
    }) => {
      const dbSession = sessions[session.id];
      if (dbSession === undefined) {
        throw new Error(`Session not found with id: ${session.id}`);
      }
      dbSession.tokenHashes.push(session.tokenHash);
      dbSession.tokenExp = session.tokenExp;
      dbSession.exp = session.exp;
    },
    deleteSession: async (session: { tokenHash: string }) => {
      const dbSessionEntry = Object.entries(sessions).find(([_, dbSession]) =>
        dbSession.tokenHashes.includes(session.tokenHash),
      );
      if (dbSessionEntry === undefined) {
        throw new Error(`Session not found with token: ${session.tokenHash}`);
      }
      const [id] = dbSessionEntry;
      delete sessions[id];
    },
  };
}

{
  console.info("# testConfig");
  const config = createConfig();
  testConfig(config, {
    id: crypto.randomUUID(),
    extra: { userId: "test-user" },
  });
}

{
  console.info("# login");
  const config = createConfig({ date: new Date("2023-10-01T00:00:00Z") });

  const loginCookie = await login(config, {
    id: "test-session-id",
    extra: { userId: "test-user-id" },
  });
  const token = loginCookie.value;

  assertEq(loginCookie.options.httpOnly, true);
  assertEq(loginCookie.options.secure, true);
  assertEq(loginCookie.options.sameSite, "lax");
  assertEq(loginCookie.options.path, "/");
  assertEq(loginCookie.options.expires?.toISOString(), "2023-10-01T05:00:00.000Z");
  assertEq(token.length, 64);
  assertEq(/^[a-zA-Z0-9]*$/.test(token), true, token);
}

{
  console.info("# consumeSession: state NotFound");
  const config = createConfig();

  const session = await consumeSession(config, { token: "unknown-token" });
  if (session.state !== "NotFound") {
    throw new Error(`session.state === ${session.state}`);
  }

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
  const config = createConfig({ date: new Date("2023-10-01T00:00:00Z") });

  const loginCookie = await login(config, {
    id: "test-session-id",
    extra: { userId: "test-user-id" },
  });
  const token = loginCookie.value;

  const session = await consumeSession(config, { token });
  if (session.state !== "Active") {
    throw new Error(`session.state === ${session.state}`);
  }

  assertEq(session.id, "test-session-id");
  assertEq(session.exp.toISOString(), "2023-10-01T05:00:00.000Z");
  assertEq(session.tokenExp.toISOString(), "2023-10-01T00:10:00.000Z");
  assertEq(session.extra.userId, "test-user-id");
}

{
  console.info("# consumeSession: state Active after 9 minutes");
  const state = { date: new Date("2023-10-01T00:00:00Z") };
  const config = createConfig(state);

  const loginCookie = await login(config, {
    id: "test-session-id",
    extra: { userId: "test-user-id" },
  });
  const token = loginCookie.value;

  state.date = new Date("2023-10-01T00:09:00Z");
  const session = await consumeSession(config, { token });
  if (session.state !== "Active") {
    throw new Error(`session.state === ${session.state}`);
  }

  assertEq(session.id, "test-session-id");
  assertEq(session.exp.toISOString(), "2023-10-01T05:00:00.000Z");
  assertEq(session.tokenExp.toISOString(), "2023-10-01T00:10:00.000Z");
  assertEq(session.extra.userId, "test-user-id");
}

{
  console.info("# consumeSession: state TokenRefreshed after 11 minutes");
  const state = { date: new Date("2023-10-01T00:00:00Z") };
  const config = createConfig(state);

  const loginCookie = await login(config, {
    id: "test-session-id",
    extra: { userId: "test-user-id" },
  });
  let token = loginCookie.value;

  state.date = new Date("2023-10-01T00:11:00Z");
  const session = await consumeSession(config, { token });

  if (session.state !== "TokenRefreshed") {
    throw new Error(`session.state === ${session.state}`);
  }
  token = session.cookie.value;

  assertEq(session.id, "test-session-id");
  assertEq(session.exp.toISOString(), "2023-10-01T05:11:00.000Z");
  assertEq(session.tokenExp.toISOString(), "2023-10-01T00:21:00.000Z");
  assertEq(session.extra.userId, "test-user-id");
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

  const loginCookie = await login(config, {
    id: "test-session-id",
    extra: { userId: "test-user-id" },
  });
  let token = loginCookie.value;

  state.date = new Date("2023-10-01T00:11:00Z");
  let session = await consumeSession(config, { token });
  if (session.state !== "TokenRefreshed") {
    throw new Error(`session.state === ${session.state}`);
  }
  token = session.cookie.value;

  session = await consumeSession(config, { token });
  if (session.state !== "Active") {
    throw new Error(`session.state === ${session.state}`);
  }

  assertEq(session.id, "test-session-id");
  assertEq(session.extra.userId, "test-user-id");
  assertEq(session.exp.toISOString(), "2023-10-01T05:11:00.000Z");
  assertEq(session.tokenExp.toISOString(), "2023-10-01T00:21:00.000Z");
}

{
  console.info("# consumeSession: state Expired after 6 hours");
  const state = { date: new Date("2023-10-01T00:00:00Z") };
  const config = createConfig(state);

  const loginCookie = await login(config, {
    id: "test-session-id",
    extra: { userId: "test-user-id" },
  });
  const token = loginCookie.value;

  await consumeSession(config, { token });

  state.date = new Date("2023-10-01T06:00:00Z");
  const session = await consumeSession(config, { token });
  if (session.state !== "Expired") {
    throw new Error(`session.state === ${session.state}`);
  }

  assertEq(session.id, "test-session-id");
  assertEq(session.extra.userId, "test-user-id");
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

  const loginCookie = await login(config, {
    id: "test-session-id",
    extra: { userId: "test-user-id" },
  });
  const token = loginCookie.value;

  await consumeSession(config, { token });

  state.date = new Date("2023-10-01T06:00:00Z");
  let session = await consumeSession(config, { token });
  if (session.state !== "Expired") {
    throw new Error(`session.state === ${session.state}`);
  }

  state.date = new Date("2023-10-01T06:01:00Z");
  session = await consumeSession(config, { token });
  if (session.state !== "NotFound") {
    throw new Error(`session.state === ${session.state}`);
  }

  assertEq(session.cookie.value, "");
  assertEq(session.cookie.options.maxAge, 0);
  assertEq(session.cookie.options.httpOnly, true);
  assertEq(session.cookie.options.secure, true);
  assertEq(session.cookie.options.sameSite, "lax");
  assertEq(session.cookie.options.path, "/");
  assertEq(session.cookie.options.expires?.toISOString(), undefined);
}

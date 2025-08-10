import { consumeSession, login, testConfig } from "./session.js";

type Session = {
  tokenHashes: string[];
  tokenExp: Date;
  exp: Date;
  userId: string;
};

function assertEq<T extends string | boolean | number | undefined | null>(
  actual: T,
  expected: T,
  message?: string,
) {
  if (expected !== actual) {
    console.error("Expected", expected, "found", actual);
    throw new Error(message ?? "Assertion failed");
  }
}

function createConfig(state?: { sessions?: Record<string, Session>; date?: Date }) {
  const sessions = state?.sessions ?? {};
  return {
    dateNow: () => state?.date ?? new Date(),
    tokenExpiresIn: 1 * 60 * 1000,
    sessionExpiresIn: 5 * 60 * 60 * 1000,
    selectSession: async (arg: { tokenHash: string }) => {
      for (const [id, session] of Object.entries(sessions)) {
        const [token1Hash, token2Hash] = session.tokenHashes.toReversed();
        if (token1Hash !== undefined && session.tokenHashes.includes(arg.tokenHash)) {
          return {
            id,
            token1Hash,
            token2Hash,
            exp: session.exp,
            tokenExp: session.tokenExp,
            extra: {
              userId: session.userId,
            },
          };
        }
      }

      return undefined;
    },
    insertSession: async (arg: {
      sessionId: string;
      sessionExp: Date;
      tokenExp: Date;
      tokenHash: string;
      extra: { userId: string };
    }) => {
      sessions[arg.sessionId] = {
        exp: arg.sessionExp,
        tokenExp: arg.tokenExp,
        tokenHashes: [arg.tokenHash],
        userId: arg.extra.userId,
      };
    },
    insertTokenAndUpdateSession: async (arg: {
      sessionId: string;
      tokenHash: string;
      tokenExp: Date;
      sessionExp: Date;
    }) => {
      const session = sessions[arg.sessionId];
      if (session === undefined) {
        throw new Error(`Session not found with id: ${arg.sessionId}`);
      }
      session.tokenHashes.push(arg.tokenHash);
      session.tokenExp = arg.tokenExp;
      session.exp = arg.sessionExp;
    },
    deleteSession: async (arg: { tokenHash: string }) => {
      const sessionEntry = Object.entries(sessions).find(([_, session]) =>
        session.tokenHashes.includes(arg.tokenHash),
      );
      if (sessionEntry === undefined) {
        throw new Error(`Session not found with token: ${arg.tokenHash}`);
      }
      const [sessionId] = sessionEntry;
      delete sessions[sessionId];
    },
  };
}

{
  console.info("# testConfig");
  const config = createConfig();
  testConfig(config, {
    sessionId: crypto.randomUUID(),
    insertExtra: {
      userId: "test-user",
    },
  });
}

{
  console.info("# login");
  const config = createConfig({ date: new Date("2023-10-01T00:00:00Z") });

  const cookie = await login(config, {
    sessionId: "test-session-id",
    extra: {
      userId: "test-user-id",
    },
  });

  assertEq(cookie.options.httpOnly, true);
  assertEq(cookie.options.secure, true);
  assertEq(cookie.options.sameSite, "lax");
  assertEq(cookie.options.path, "/");
  assertEq(cookie.options.expires?.toISOString(), "2023-10-01T05:00:00.000Z");
  assertEq(cookie.value.length, 64);
  assertEq(/^[a-zA-Z0-9]*$/.test(cookie.value), true, cookie.value);
}

{
  console.info("# consumeSession: unknown token");
  const config = createConfig();

  const session = await consumeSession(config, { token: "unknown-token" });

  if (session.state !== "NotFound") {
    throw new Error("Expected session state to be NotFound");
  }
  assertEq(
    session.requestTokenHash,
    "9206c2394794b8fc97fcd896f95e40028ab7a15c10279446c23fbdd4b4ae7a1e",
  );
  assertEq(session.cookie.value, "");
  assertEq(session.cookie.options.maxAge, 0);
}

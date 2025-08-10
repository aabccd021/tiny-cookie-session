import { testConfig } from "./session.js";

type Session = {
  tokenHashes: string[];
  tokenExp: Date;
  exp: Date;
  userId: string;
};

function createConfig(sessions: Record<string, Session>) {
  return {
    dateNow: () => new Date(),
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
  console.info("testConfig");
  const sessions: Record<string, Session> = {};
  const config = createConfig(sessions);
  testConfig(config, {
    sessionId: crypto.randomUUID(),
    insertExtra: {
      userId: "test-user",
    },
  });
}

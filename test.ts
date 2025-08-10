import { type Config, defaultConfig, testConfig } from "./index";

type Session = {
  tokenHashes: string[];
  tokenExp: Date;
  exp: Date;
  userId: string;
};

const sessions: Record<string, Session> = {};

const config: Config<{ userId: string }, { userId: string }> = {
  ...defaultConfig,
  dateNow: () => new Date(),
  sessionExpiresIn: 5 * 60 * 60 * 1000,
  selectSession: async (arg) => {
    const sessionEntry = Object.entries(sessions).find(([_, session]) =>
      session.tokenHashes.includes(arg.tokenHash),
    );
    if (sessionEntry === undefined) {
      return undefined;
    }
    const [id, session] = sessionEntry;

    const token1Hash = session.tokenHashes.at(-1);
    if (token1Hash === undefined) {
      return undefined;
    }

    const token2Hash = session.tokenHashes.at(-2);
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
  },
  insertSession: async (arg) => {
    sessions[arg.sessionId] = {
      exp: arg.sessionExp,
      tokenExp: arg.tokenExp,
      tokenHashes: [arg.tokenHash],
      userId: arg.extra.userId,
    };
  },
  insertTokenAndUpdateSession: async (arg) => {
    const session = sessions[arg.sessionId];
    if (session === undefined) {
      throw new Error(`Session not found with id: ${arg.sessionId}`);
    }
    session.tokenHashes.push(arg.tokenHash);
    session.tokenExp = arg.tokenExp;
    session.exp = arg.sessionExp;
  },
  deleteSession: async (arg) => {
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

testConfig(config, { insertExtra: { userId: "test-user" } });

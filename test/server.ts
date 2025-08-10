import * as fs from "node:fs";
import {
  type Config,
  consumeSession,
  defaultConfig,
  login,
  logout,
  testConfig,
} from "../index.ts";

const rootDir = "./received";

fs.mkdirSync(rootDir, { recursive: true });

type Session = {
  tokenHashes: string[];
  tokenExp: Date;
  exp: Date;
  userId: string;
};

type SessionSerialized = {
  tokenHashes: string[];
  tokenExp: number;
  exp: number;
  userId: string;
};

const rawSessions: Record<string, SessionSerialized> = JSON.parse(
  fs.readFileSync("./var/sessions.json", "utf-8"),
);
const sessions: Record<string, Session> = Object.fromEntries(
  Object.entries(rawSessions).map(([id, session]) => [
    id,
    {
      ...session,
      tokenExp: new Date(session.tokenExp),
      exp: new Date(session.exp),
    } as Session,
  ]),
);

type ExtraData = {
  readonly insert: {
    readonly userId: string;
  };
  readonly select: {
    readonly userId: string;
  };
};

const config: Config<ExtraData> = {
  ...defaultConfig,
  dateNow: (): Date => {
    const neteroDir = process.env["NETERO_STATE"];
    if (neteroDir === undefined) {
      throw new Error("NETERO_STATE is not set");
    }
    const epochNowStr = fs.readFileSync(`${neteroDir}/now.txt`, "utf8");
    return new Date(epochNowStr);
  },
  sessionExpiresIn: 5 * 60 * 60 * 1000,
  selectSession: ({ tokenHash }) => {
    const sessionEntry = Object.entries(sessions).find(([_, session]) =>
      session.tokenHashes.includes(tokenHash),
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
  insertSession: ({ sessionId, sessionExp, tokenHash, tokenExp, extra }) => {
    sessions[sessionId] = {
      exp: sessionExp,
      tokenExp: tokenExp,
      tokenHashes: [tokenHash],
      userId: extra.userId,
    };
  },
  insertTokenAndUpdateSession: ({
    sessionId,
    sessionExp,
    newTokenHash,
    tokenExp,
  }) => {
    const session = sessions[sessionId];
    if (session === undefined) {
      throw new Error(`Session not found with id: ${sessionId}`);
    }
    session.tokenHashes.push(newTokenHash);
    session.tokenExp = tokenExp;
    session.exp = sessionExp;
  },
  deleteSession: ({ tokenHash }) => {
    const sessionEntry = Object.entries(sessions).find(([_, session]) =>
      session.tokenHashes.includes(tokenHash),
    );
    if (sessionEntry === undefined) {
      throw new Error(`Session not found with token: ${tokenHash}`);
    }
    const [sessionId] = sessionEntry;
    delete sessions[sessionId];
  },
};

testConfig(config, { insertExtra: { userId: "testUserId" } });

const server = Bun.serve({
  port: 8080,
  routes: {
    "/": {
      GET: async (req): Promise<Response> => {
        const token = req.cookies.get("session_token");
        if (token === null) {
          return new Response("<p>Logged out</p>", {
            headers: { "Content-Type": "text/html" },
          });
        }

        const session = consumeSession(config, token);
        if (session.requireLogout) {
          return new Response(undefined, {
            status: 303,
            headers: {
              Location: "/",
              "Set-Cookie": new Bun.Cookie(
                "session_token",
                ...session.cookie,
              ).serialize(),
            },
          });
        }

        const sleepMs = new URL(req.url).searchParams.get("sleep");
        if (sleepMs !== null) {
          await new Promise((resolve) =>
            setTimeout(resolve, Number.parseInt(sleepMs)),
          );
        }

        const cookie =
          session.cookie !== undefined
            ? new Bun.Cookie("session_token", ...session.cookie).serialize()
            : "";

        return new Response(`<p>User: ${session.extra.userId}</p>`, {
          headers: {
            "Set-Cookie": cookie,
            "Content-Type": "text/html",
          },
        });
      },
    },
    "/login": {
      GET: (): Response => {
        return new Response(
          `<form method="POST">
            <input type="text" name="userId" placeholder="userId" />
            <button type="submit">Login</button>
          </form>`,
          {
            headers: { "Content-Type": "text/html" },
          },
        );
      },
      POST: async (req): Promise<Response> => {
        const formData = await req.formData();

        const userId = formData.get("userId");
        if (typeof userId !== "string") {
          throw new Error("Invalid userId");
        }

        const loginCookie = login(config, {
          sessionId: crypto.randomUUID(),
          extra: { userId },
        });
        return new Response(undefined, {
          status: 303,
          headers: {
            Location: "/",
            "Set-Cookie": new Bun.Cookie(
              "session_token",
              ...loginCookie,
            ).serialize(),
          },
        });
      },
    },
    "/logout": {
      GET: async (req): Promise<Response> => {
        req.cookies;
        const token = req.cookies.get("session_token");
        if (token === null) {
          throw new Error("Not logged in but trying to logout");
        }
        const logoutCookie = logout(config, { token });
        return new Response(undefined, {
          status: 303,
          headers: {
            Location: "/",
            "Set-Cookie": new Bun.Cookie(
              "session_token",
              ...logoutCookie,
            ).serialize(),
          },
        });
      },
    },
  },
});

fs.writeFileSync("./ready.fifo", "");

await fs.promises.readFile("./exit.fifo");

const serializedSessions: Record<string, SessionSerialized> =
  Object.fromEntries(
    Object.entries(sessions).map(([id, session]) => [
      id,
      {
        ...session,
        tokenExp: session.tokenExp.getTime(),
        exp: session.exp.getTime(),
      },
    ]),
  );

fs.writeFileSync("./var/sessions.json", JSON.stringify(serializedSessions));

await server.stop();
process.exit(0);

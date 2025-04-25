import * as fs from "node:fs";
import {
  type Config,
  consumeSession,
  defaultConfig,
  extendToken,
  hasSessionCookie,
  login,
  logout,
} from "../index.ts";

const rootDir = "./received";

fs.mkdirSync(rootDir, { recursive: true });

type Session = {
  tokens: Record<string, number>;
  exp: number;
  username: string;
  deviceName: string;
};

const sessions: Record<string, Session> = await Bun.file(
  "./var/sessions.json",
).json();

function getSessionByToken(token: string): [string, Session] {
  const entry = Object.entries(sessions).find(
    ([_, session]) => token in session.tokens,
  );
  if (entry === undefined) {
    throw new Error(`Session not found with token: ${token}`);
  }
  return entry;
}

function getSessionById(id: string): Session {
  const session = sessions[id];
  if (session === undefined) {
    throw new Error(`Session not found with id: ${id}`);
  }
  return session;
}

const config: Config<
  Session & {
    readonly id: string;
  },
  Pick<Session, "username" | "deviceName">
> = {
  ...defaultConfig,
  dateNow: (): number => {
    const epochNowStr = fs.readFileSync("./var/now.txt", "utf8");
    return new Date(epochNowStr).getTime();
  },
  sessionExpiresIn: 5 * 60 * 60 * 1000,
  getTokenDetails: (token) => {
    const sessionEntry = Object.entries(sessions).find(
      ([_, session]) => token in session.tokens,
    );
    if (sessionEntry === undefined) {
      return undefined;
    }
    const [sessionId, session] = sessionEntry;

    const tokenExp = session.tokens[token];
    if (tokenExp === undefined) {
      return undefined;
    }

    const latestTokenExp = Object.values(session.tokens).sort().at(-1);

    return {
      exp: tokenExp,
      isLastToken: tokenExp === latestTokenExp,
      session: {
        ...session,
        exp: session.exp,
        id: sessionId,
      },
    };
  },
  createSession: ({ sessionId, sessionExp, token, tokenExp, insertData }) => {
    sessions[sessionId] = {
      ...insertData,
      exp: sessionExp,
      tokens: {
        [token]: tokenExp,
      },
    };
  },
  insertOrReplaceToken: ({ sessionId, token, tokenExp }) => {
    const session = getSessionById(sessionId);

    const expNotLatest = Object.values(session.tokens).some(
      (t) => t > tokenExp,
    );
    if (expNotLatest) {
      throw new Error(`Token exp date not latest: ${tokenExp}`);
    }

    const sameExpTokens = Object.entries(session.tokens)
      .filter(([_, t]) => t === tokenExp)
      .map(([key]) => key);
    for (const key of sameExpTokens) {
      delete session.tokens[key];
    }

    session.tokens[token] = tokenExp;
  },
  deleteSessionByToken: (token) => {
    const [sessionId] = getSessionByToken(token);
    delete sessions[sessionId];
  },
  deleteSessionById: (sessionId) => {
    delete sessions[sessionId];
  },
  setSessionExp: ({ sessionId, sessionExp }) => {
    const session = getSessionById(sessionId);
    session.exp = sessionExp;
  },
};

const server = Bun.serve({
  port: 8080,
  routes: {
    "/": {
      GET: async (req: Request): Promise<Response> => {
        const cookieHeader = req.headers.get("cookie");
        const [logoutCookie, token] = consumeSession(config, cookieHeader);

        const message =
          token !== undefined
            ? `User: ${token.session.username}, Device: ${token.session.deviceName}`
            : "Logged out";

        if (logoutCookie !== undefined || token === undefined) {
          return new Response(`<p>${message}</p>`, {
            headers: {
              "Content-Type": "text/html",
              "Set-Cookie": logoutCookie ?? "",
            },
          });
        }

        const sleepMs = new URL(req.url).searchParams.get("sleep");
        if (sleepMs !== null) {
          await new Promise((resolve) =>
            setTimeout(resolve, Number.parseInt(sleepMs)),
          );
        }

        const [tokenCookie] = extendToken(config, token);
        return new Response(`<p>${message}</p>`, {
          headers: {
            "Content-Type": "text/html",
            "Set-Cookie": tokenCookie ?? "",
          },
        });
      },
    },
    "/redirect-home": {
      GET: (req): Response => {
        const cookieHeader = req.headers.get("cookie");
        const [logoutCookie, token] = consumeSession(config, cookieHeader);

        const message =
          token !== undefined
            ? `User: ${token.session.username}, Device: ${token.session.deviceName}`
            : "Logged out";

        if (logoutCookie !== undefined || token === undefined) {
          return new Response(`<p>${message}</p>`, {
            headers: {
              "Content-Type": "text/html",
              "Set-Cookie": logoutCookie ?? "",
            },
          });
        }

        const [tokenCookie] = extendToken(config, token);
        if (tokenCookie !== undefined) {
          return new Response(undefined, {
            status: 303,
            headers: {
              Location: req.url,
              "Set-Cookie": tokenCookie,
            },
          });
        }

        return new Response(`<p>${message}</p>`, {
          headers: { "Content-Type": "text/html" },
        });
      },
    },
    "/login": {
      GET: (): Response => {
        return new Response(
          `<form method="POST">
            <input type="text" name="username" placeholder="username" />
            <input type="text" name="deviceName" placeholder="deviceName" />
            <button type="submit">Login</button>
          </form>`,
          {
            headers: { "Content-Type": "text/html" },
          },
        );
      },
      POST: async (req): Promise<Response> => {
        const formData = await req.formData();

        const username = formData.get("username");
        if (typeof username !== "string") {
          return new Response("Invalid username", { status: 400 });
        }

        const deviceName = formData.get("deviceName");
        if (typeof deviceName !== "string") {
          return new Response("Invalid device name", { status: 400 });
        }

        const [loginCookie] = login(config, { username, deviceName });
        return new Response(undefined, {
          status: 303,
          headers: { Location: "/", "Set-Cookie": loginCookie },
        });
      },
    },
    "/logout": {
      GET: (req): Response => {
        const cookieHeader = req.headers.get("cookie");
        const [logoutCookie] = logout(config, cookieHeader);
        return new Response(undefined, {
          status: 303,
          headers: { Location: "/", "Set-Cookie": logoutCookie },
        });
      },
    },
    "/has-session-cookie": {
      GET: (req): Response => {
        const cookieHeader = req.headers.get("cookie");
        return new Response(
          `<p>${hasSessionCookie(config, cookieHeader)}</p>`,
          {
            headers: { "Content-Type": "text/html" },
          },
        );
      },
    },
  },
});

fs.writeFileSync("./run/netero/ready.fifo", "");

await fs.promises.readFile("./run/netero/exit.fifo");

fs.writeFileSync("./var/sessions.json", JSON.stringify(sessions));

await server.stop();
process.exit(0);

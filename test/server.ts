import * as fs from "node:fs";
import {
  type Config,
  consumeSession,
  defaultConfig,
  hasSessionCookie,
  login,
  logout,
} from "../index.ts";

const rootDir = "./received";

fs.mkdirSync(rootDir, { recursive: true });

type Session = {
  tokens: Record<string, number>;
  expirationDate: number;
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

function findToken(tokenValue: string):
  | {
      readonly sessionId: string;
      readonly session: Session;
      readonly tokenExpDate: number;
    }
  | undefined {
  for (const [sessionId, session] of Object.entries(sessions)) {
    const tokenExpDate = session.tokens[tokenValue];
    if (tokenExpDate !== undefined) {
      return { sessionId, session, tokenExpDate };
    }
  }
  return undefined;
}

const config: Config<
  Session & {
    readonly id: string;
    readonly latestToken: {
      readonly value: string;
      readonly expDate: number;
    };
  },
  Pick<Session, "username" | "deviceName">
> = {
  ...defaultConfig,
  dateNow: (): number => {
    const epochNowStr = fs.readFileSync("./var/now.txt", "utf8");
    return new Date(epochNowStr).getTime();
  },
  sessionExpiresIn: 5 * 60 * 60 * 1000,
  selectSession: (tokenValue) => {
    const foundToken = findToken(tokenValue);
    if (foundToken === undefined) {
      return undefined;
    }

    const { sessionId, session, tokenExpDate } = foundToken;

    const latestToken = Object.entries(session.tokens)
      .sort(([, a], [, b]) => b - a)
      .map(([key, value]) => ({ value: key, expDate: value }))
      .at(0);

    if (latestToken === undefined) {
      throw new Error("Absurd state: no latest token found");
    }

    const token = {
      expirationDate: tokenExpDate,
      session: {
        ...session,
        id: sessionId,
        latestToken,
      },
    };

    return token;
  },
  createSession: ({
    sessionId,
    sessionExpirationDate,
    token,
    tokenExpirationDate,
    insertData,
  }) => {
    sessions[sessionId] = {
      ...insertData,
      expirationDate: sessionExpirationDate,
      tokens: {
        [token]: tokenExpirationDate,
      },
    };
  },
  createToken: ({ sessionId, token, tokenExpirationDate }) => {
    const session = getSessionById(sessionId);

    const expDateNotLatest = Object.values(session.tokens).some(
      (t) => t >= tokenExpirationDate,
    );
    if (expDateNotLatest) {
      throw new Error(
        `Token expiration date not latest: ${tokenExpirationDate}`,
      );
    }

    session.tokens[token] = tokenExpirationDate;
  },
  deleteSessionByToken: (token) => {
    const [sessionId] = getSessionByToken(token);
    delete sessions[sessionId];
  },
  deleteSessionById: (sessionId) => {
    delete sessions[sessionId];
  },
  setSessionExpirationDate: ({ sessionId, sessionExpirationDate }) => {
    const session = getSessionById(sessionId);
    session.expirationDate = sessionExpirationDate;
  },
};

const server = Bun.serve({
  port: 8080,
  routes: {
    "/": {
      GET: async (req: Request): Promise<Response> => {
        const cookieHeader = req.headers.get("cookie");
        const [sessionCookie, session] = consumeSession(config, cookieHeader);
        const sleepMs = new URL(req.url).searchParams.get("sleep");
        if (sleepMs !== null) {
          await new Promise((resolve) =>
            setTimeout(resolve, Number.parseInt(sleepMs)),
          );
        }
        const message =
          session !== undefined
            ? `User: ${session.username}, Device: ${session.deviceName}`
            : "Logged out";
        return new Response(`<p>${message}</p>`, {
          headers: {
            "Set-Cookie": sessionCookie ?? "",
            "Content-Type": "text/html",
          },
        });
      },
    },
    "/redirect-home": {
      GET: (req): Response => {
        const cookieHeader = req.headers.get("cookie");
        const [sessionCookie, session] = consumeSession(config, cookieHeader);
        const message =
          session !== undefined
            ? `User: ${session.username}, Device: ${session.deviceName}`
            : "Logged out";
        if (sessionCookie !== undefined) {
          return new Response(undefined, {
            status: 303,
            headers: {
              Location: req.url,
              "Set-Cookie": sessionCookie,
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

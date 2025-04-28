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
  tokens: string[];
  tokenExpirationDate: number;
  expirationDate: number;
  username: string;
  deviceName: string;
};

const sessions: Record<string, Session> = await Bun.file(
  "./var/sessions.json",
).json();

function getSessionById(id: string): Session {
  const session = sessions[id];
  if (session === undefined) {
    throw new Error(`Session not found with id: ${id}`);
  }
  return session;
}

const config: Config<
  Pick<Session, "username" | "deviceName">,
  Pick<Session, "username" | "deviceName">
> = {
  ...defaultConfig,
  dateNow: (): number => {
    const epochNowStr = fs.readFileSync("./var/now.txt", "utf8");
    return new Date(epochNowStr).getTime();
  },
  sessionExpiresIn: 5 * 60 * 60 * 1000,
  selectSession: (token) => {
    const sessionEntry = Object.entries(sessions).find(([_, session]) =>
      session.tokens.includes(token),
    );
    if (sessionEntry === undefined) {
      return undefined;
    }
    const [id, session] = sessionEntry;

    const token1 = session.tokens.at(-1);
    if (token1 === undefined) {
      return undefined;
    }

    const token2 = session.tokens.at(-2);
    return {
      id,
      expirationDate: session.expirationDate,
      tokenExpirationDate: session.tokenExpirationDate,
      token1,
      token2,
      data: {
        username: session.username,
        deviceName: session.deviceName,
      },
    };
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
      tokenExpirationDate: tokenExpirationDate,
      tokens: [token],
    };
  },
  createToken: ({ sessionId, token, tokenExpirationDate }) => {
    const session = getSessionById(sessionId);
    session.tokens.push(token);
    session.tokenExpirationDate = tokenExpirationDate;
  },
  deleteSessionByToken: (token) => {
    const sessionEntry = Object.entries(sessions).find(([_, session]) =>
      session.tokens.includes(token),
    );
    if (sessionEntry === undefined) {
      throw new Error(`Session not found with token: ${token}`);
    }
    const [sessionId] = sessionEntry;
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
            ? `User: ${session.data.username}, Device: ${session.data.deviceName}`
            : "Logged out";
        return new Response(`<p>${message}</p>`, {
          headers: {
            "Set-Cookie": sessionCookie ?? "",
            "Content-Type": "text/html",
          },
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

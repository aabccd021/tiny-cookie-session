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
  tokens: string[];
  tokenExp: number;
  exp: number;
  userId: string;
};

const sessions: Record<string, Session> = JSON.parse(
  fs.readFileSync("./var/sessions.json", "utf-8"),
);

const config: Config = {
  ...defaultConfig,
  dateNow: (): number => {
    const neteroDir = process.env["NETERO_STATE"];
    if (neteroDir === undefined) {
      throw new Error("NETERO_STATE is not set");
    }
    const epochNowStr = fs.readFileSync(`${neteroDir}/now.txt`, "utf8");
    return new Date(epochNowStr).getTime();
  },
  sessionExpiresIn: 5 * 60 * 60 * 1000,
  selectSession: ({ token }) => {
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
      token1,
      token2,
      exp: session.exp,
      tokenExp: session.tokenExp,
      userId: session.userId,
    };
  },
  createSession: ({ sessionId, sessionExp, token, tokenExp, userId }) => {
    sessions[sessionId] = {
      exp: sessionExp,
      tokenExp: tokenExp,
      tokens: [token],
      userId,
    };
  },
  createToken: ({ sessionId, token, tokenExp }) => {
    const session = sessions[sessionId];
    if (session === undefined) {
      throw new Error(`Session not found with id: ${sessionId}`);
    }
    session.tokens.push(token);
    session.tokenExp = tokenExp;
  },
  deleteSession: ({ token }) => {
    const sessionEntry = Object.entries(sessions).find(([_, session]) =>
      session.tokens.includes(token),
    );
    if (sessionEntry === undefined) {
      throw new Error(`Session not found with token: ${token}`);
    }
    const [sessionId] = sessionEntry;
    delete sessions[sessionId];
  },
  updateSession: ({ sessionId, sessionExp }) => {
    const session = sessions[sessionId];
    if (session === undefined) {
      throw new Error(`Session not found with id: ${sessionId}`);
    }
    session.exp = sessionExp;
  },
};

testConfig(config);

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

        return new Response(`<p>User: ${session.userId}</p>`, {
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

        const loginCookie = login(config, userId);
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
      GET: (req): Response => {
        req.cookies;
        const token = req.cookies.get("session_token");
        if (token === null) {
          throw new Error("Not logged in but trying to logout");
        }
        const logoutCookie = logout(config, token);
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

fs.writeFileSync("./var/sessions.json", JSON.stringify(sessions));

await server.stop();
process.exit(0);

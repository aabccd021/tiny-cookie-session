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

export type Token = {
  readonly used: boolean;
  readonly expirationDate: number;
};

function tokenValue(
  entry: [value: string, token: Token] | undefined,
): (Token & { readonly value: string }) | undefined {
  if (entry === undefined) {
    return undefined;
  }
  const [value, token] = entry;
  return { ...token, value };
}

type Session = {
  readonly tokens: Record<string, Token>;
  readonly expirationDate: number;
  readonly username: string;
  readonly deviceName: string;
};

const sessionsJson = await Bun.file("./var/sessions.json").json();
const sessions = new Map<string, Session>(sessionsJson);

function getSessionByToken(token: string): [string, Session] | undefined {
  return sessions.entries().find(([_, session]) => token in session.tokens);
}

const config: Config<
  Pick<Session, "username" | "deviceName">,
  Session & { readonly id: string }
> = {
  ...defaultConfig,
  dateNow: (): number => {
    const epochNowStr = fs.readFileSync("./var/now.txt", "utf8");
    return new Date(epochNowStr).getTime();
  },
  sessionExpiresIn: 5 * 60 * 60 * 1000,
  selectSession: (token) => {
    const sessionEntry = getSessionByToken(token);
    if (sessionEntry === undefined) {
      return undefined;
    }
    const [id, session] = sessionEntry;
    const [newestToken, secondNewestToken] = Object.entries(
      session.tokens,
    ).sort(([, a], [, b]) => b.expirationDate - a.expirationDate);

    if (newestToken === undefined) {
      return undefined;
    }
    const [newestTokenValue, newestTokenData] = newestToken;
    return {
      session: { ...session, id },
      newestToken: { ...newestTokenData, value: newestTokenValue },
      secondNewestToken: tokenValue(secondNewestToken),
    };
  },
  createSession: ({
    sessionId,
    sessionExpirationDate,
    token,
    tokenExpirationDate,
    insertData: { username, deviceName },
  }) => {
    sessions.set(sessionId, {
      expirationDate: sessionExpirationDate,
      username,
      deviceName,
      tokens: {
        [token]: { used: false, expirationDate: tokenExpirationDate },
      },
    });
  },
  createToken: ({ sessionId, token, tokenExpirationDate }) => {
    const session = sessions.get(sessionId);
    if (session === undefined) {
      throw new Error("Session not found. Something went wrong.");
    }
    sessions.set(sessionId, {
      ...session,
      tokens: {
        ...session.tokens,
        [token]: { used: false, expirationDate: tokenExpirationDate },
      },
    });
  },
  setTokenUsed: (token) => {
    const sessionEntry = getSessionByToken(token);
    if (sessionEntry === undefined) {
      throw new Error("Session not found. Something went wrong.");
    }
    const [id, session] = sessionEntry;
    const tokenDate = session.tokens[token];
    if (tokenDate === undefined) {
      throw new Error("Token not found. Something went wrong.");
    }
    sessions.set(id, {
      ...session,
      tokens: {
        ...session.tokens,
        [token]: { ...tokenDate, used: true },
      },
    });
  },
  deleteSession: (token) => {
    const sessionEntry = getSessionByToken(token);
    if (sessionEntry === undefined) {
      throw new Error("Session not found. Something went wrong.");
    }
    const [id] = sessionEntry;
    sessions.delete(id);
  },
  updateSessionExpirationDate: ({ sessionId, sessionExpirationDate }) => {
    const session = sessions.get(sessionId);
    if (session === undefined) {
      throw new Error("Session not found. Something went wrong.");
    }
    sessions.set(sessionId, {
      ...session,
      expirationDate: sessionExpirationDate,
    });
  },
};

const server = Bun.serve({
  port: 8080,
  routes: {
    "/": {
      GET: (req): Response => {
        const [sessionCookie, session] = consumeSession(config, req);
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
        const [logoutCookie] = logout(config, req);
        return new Response(undefined, {
          status: 303,
          headers: { Location: "/", "Set-Cookie": logoutCookie },
        });
      },
    },
    "/has-session-cookie": {
      GET: (req): Response => {
        return new Response(`<p>${hasSessionCookie(config, req)}</p>`, {
          headers: { "Content-Type": "text/html" },
        });
      },
    },
  },
});

fs.writeFileSync("./run/netero/ready.fifo", "");

await fs.promises.readFile("./run/netero/exit.fifo");

fs.writeFileSync(
  "./var/sessions.json",
  JSON.stringify(Array.from(sessions.entries())),
);

await server.stop();
process.exit(0);

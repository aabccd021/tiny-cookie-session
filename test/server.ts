import * as fs from "node:fs";
import {
  type AccessToken,
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
  accessTokens: AccessToken[];
  expirationDate: number;
  username: string;
  deviceName: string;
};

const sessionsJson = await Bun.file("./var/sessions.json").json();
const sessions = new Map<string, Session>(sessionsJson);

function getSessionByAccessToken(
  accessToken: string,
): [string, Session] | undefined {
  return sessions
    .entries()
    .find(([_, session]) =>
      session.accessTokens.map((token) => token.value).includes(accessToken),
    );
}

const config: Config<Pick<Session, "username" | "deviceName">, Session> = {
  ...defaultConfig,
  dateNow: (): number => {
    const epochNowStr = fs.readFileSync("./var/now.txt", "utf8");
    return new Date(epochNowStr).getTime();
  },
  expiresIn: 5 * 60 * 60 * 1000,
  selectSession: (accessToken) => {
    const sessionEntry = sessions
      .entries()
      .find(([_, session]) =>
        session.accessTokens.map((token) => token.value).includes(accessToken),
      );
    if (sessionEntry === undefined) {
      return undefined;
    }
    const [_, session] = sessionEntry;
    return session;
  },
  insertSession: (
    id,
    expirationDate,
    accessToken,
    { username, deviceName },
  ) => {
    sessions.set(id, {
      expirationDate,
      username,
      deviceName,
      accessTokens: [accessToken],
    });
  },
  deleteSession: (accessToken) => {
    const sessionEntry = getSessionByAccessToken(accessToken);
    if (sessionEntry === undefined) {
      throw new Error("Session not found. Something went wrong.");
    }
    const [id] = sessionEntry;
    sessions.delete(id);
  },
  updateSessionExpirationDate: (accessToken, expirationDate) => {
    const sessionEntry = getSessionByAccessToken(accessToken);
    if (sessionEntry === undefined) {
      throw new Error("Session not found. Something went wrong.");
    }
    const [id, session] = sessionEntry;
    sessions.set(id, { ...session, expirationDate });
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

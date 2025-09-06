import { test } from "bun:test";
import * as tcs from ".";

type Session = {
  exp: Date;
  tokenExp: Date;
  oddTokenHash: string;
  evenTokenHash?: string;
  isLatestTokenOdd: boolean;
};

const testConfig = {
  tokenExpiresIn: 10 * 60 * 1000,
  sessionExpiresIn: 5 * 60 * 60 * 1000,
};

function dbSelect(db: Map<string, Session>, sessionIdHash: string): Session | undefined {
  return db.get(sessionIdHash);
}

function dbInsert(db: Map<string, Session>, arg: import("./index").InsertAction): void {
  db.set(arg.idHash, {
    oddTokenHash: arg.oddTokenHash,
    evenTokenHash: undefined,
    exp: arg.exp,
    tokenExp: arg.tokenExp,
    isLatestTokenOdd: true,
  });
}

function dbDelete(db: Map<string, Session>, arg: import("./index").DeleteAction): void {
  db.delete(arg.idHash);
}

function dbUpdate(db: Map<string, Session>, arg: import("./index").UpdateAction): void {
  const session = db.get(arg.idHash);
  if (!session) throw new Error("Session not found for update");

  if (arg.evenTokenHash !== undefined) {
    session.evenTokenHash = arg.evenTokenHash;
  }
  if (arg.oddTokenHash !== undefined) {
    session.oddTokenHash = arg.oddTokenHash;
  }
  session.isLatestTokenOdd = arg.isLatestTokenOdd;
  session.tokenExp = arg.tokenExp;
  session.exp = arg.exp;
}

async function login(db: Map<string, Session>, arg: import("./index").LoginArg) {
  const result = await tcs.login(arg);

  if (result.action.type === "insert") {
    dbInsert(db, result.action);
  } else {
    throw new Error("Unexpected action type");
  }

  return result;
}

async function logout(db: Map<string, Session>, cookie: string | undefined) {
  if (cookie === undefined) {
    return { cookie: undefined, action: undefined };
  }

  const credential = await tcs.credentialFromCookie({ cookie });
  if (credential === undefined) {
    return { cookie: tcs.logoutCookie, action: undefined };
  }

  const result = await tcs.logout({ credential });

  if (result.action.type === "delete") {
    dbDelete(db, result.action);
  } else {
    throw new Error("Unexpected action type");
  }

  return result;
}

async function consume(
  db: Map<string, Session>,
  cookie: string | undefined,
  config: import("./index").Config,
) {
  if (cookie === undefined) {
    return { state: "CookieMissing", cookie: undefined, data: undefined };
  }

  const credential = await tcs.credentialFromCookie({ cookie });
  if (credential === undefined) {
    return { state: "CookieMalformed", cookie: tcs.logoutCookie, data: undefined };
  }

  const session = dbSelect(db, credential.idHash);
  if (session === undefined) {
    return { state: "SessionNotFound", cookie: tcs.logoutCookie, data: undefined };
  }
  const result = await tcs.consume({ credential, config, session });

  if (result.action?.type === "delete") {
    dbDelete(db, result.action);
  } else if (result.action?.type === "update") {
    dbUpdate(db, result.action);
  } else if (result.action !== undefined) {
    throw new Error("Unexpected action type");
  }

  if (result.state === "SessionActive") {
    return { state: "SessionActive", cookie: result.cookie, data: session };
  }

  if (result.state === "TokenRotated") {
    return { state: "TokenRotated", cookie: result.cookie, data: session };
  }

  if (result.state === "SessionExpired") {
    return { state: "SessionExpired", cookie: result.cookie, data: undefined };
  }

  if (result.state === "SessionForked") {
    return { state: "SessionForked", cookie: result.cookie, data: undefined };
  }

  throw new Error("Unexpected state");
}

function setCookie(
  cookie: string | undefined,
  session: { cookie?: import("./index").Cookie },
): string | undefined {
  if (session.cookie === undefined) {
    return cookie;
  }

  if (session.cookie.value === "") {
    return undefined;
  }

  return session.cookie.value;
}

test("login", async () => {
  let cookie: string | undefined;
  let date: string;
  const db: Map<string, Session> = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    if (session.cookie.options.expires?.toISOString() !== "2023-10-01T05:00:00.000Z")
      throw new Error();
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, cookie, config);
    if (session?.state !== "SessionActive") throw new Error();
    if (session.data?.exp.toISOString() !== "2023-10-01T05:00:00.000Z") throw new Error();
    if (session.data?.tokenExp.toISOString() !== "2023-10-01T00:10:00.000Z") throw new Error();
  }
});

test("logout", async () => {
  let cookie: string | undefined;
  let date: string;
  const db: Map<string, Session> = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:01:00Z";
    const session = await logout(db, cookie);
    if (session.cookie?.value !== "") throw new Error();
    if (session.cookie.options.maxAge !== 0) throw new Error();
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, cookie, config);
    if (session?.state !== "CookieMissing") throw new Error();
  }
});

test("consume: state SessionActive after login", async () => {
  let cookie: string | undefined;
  let date: string;
  const db: Map<string, Session> = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, cookie, config);
    if (session?.state !== "SessionActive") throw new Error();
    if (session.data?.exp.toISOString() !== "2023-10-01T05:00:00.000Z") throw new Error();
    if (session.data?.tokenExp.toISOString() !== "2023-10-01T00:10:00.000Z") throw new Error();
  }
});

test("consume: state SessionActive after 9 minutes", async () => {
  let cookie: string | undefined;
  let date: string;
  const db: Map<string, Session> = new Map();

  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:09:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "SessionActive") throw new Error();
    if (session.data?.exp.toISOString() !== "2023-10-01T05:00:00.000Z") throw new Error();
    if (session.data?.tokenExp.toISOString() !== "2023-10-01T00:10:00.000Z") throw new Error();
  }
});

test("consume: state TokenRotated after 11 minutes", async () => {
  let cookie: string | undefined;
  let date: string;
  const db: Map<string, Session> = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "TokenRotated") throw new Error();
    if (session.cookie?.options.expires?.toISOString() !== "2023-10-01T05:11:00.000Z")
      throw new Error();
    if (session.data?.exp.toISOString() !== "2023-10-01T05:11:00.000Z") throw new Error();
    if (session.data?.tokenExp.toISOString() !== "2023-10-01T00:21:00.000Z") throw new Error();
  }
});

test("consume: state SessionActive after TokenRotated", async () => {
  let cookie: string | undefined;
  let date: string;
  const db: Map<string, Session> = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "TokenRotated") throw new Error();
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, cookie, config);
    if (session?.state !== "SessionActive") throw new Error();
    if (session.data?.exp.toISOString() !== "2023-10-01T05:11:00.000Z") throw new Error();
    if (session.data?.tokenExp.toISOString() !== "2023-10-01T00:21:00.000Z") throw new Error();
  }
});

test("consume: state Expired after 6 hours", async () => {
  let cookie: string | undefined;
  let date: string;
  const db: Map<string, Session> = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T06:00:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "SessionExpired") throw new Error();
    if (session.cookie?.value !== "") throw new Error();
    if (session.cookie?.options.maxAge !== 0) throw new Error();
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, cookie, config);
    if (session?.state !== "CookieMissing") throw new Error();
  }
});

test("consume: state SessionActive after TokenRotated twice", async () => {
  let cookie: string | undefined;
  let date: string;
  const db: Map<string, Session> = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "TokenRotated") throw new Error();
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "TokenRotated") throw new Error();
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, cookie, config);
    if (session?.state !== "SessionActive") throw new Error();
  }
});

test("consume: state SessionActive after re-login", async () => {
  let cookie: string | undefined;
  let date: string;
  const db: Map<string, Session> = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    const session = await logout(db, cookie);
    cookie = setCookie(cookie, session);
  }
  {
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, cookie, config);
    if (session?.state !== "SessionActive") throw new Error();
  }
});

test("consume: state SessionForked after used by user, user, attacker", async () => {
  let userCookie: string | undefined;
  let attackerCookie: string | undefined;
  let date: string;
  const db: Map<string, Session> = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const userSession = await login(db, { config });
    userCookie = setCookie(userCookie, userSession);
  }
  attackerCookie = userCookie;
  {
    date = "2023-10-01T00:11:00Z";
    const userSession = await consume(db, userCookie, config);
    if (userSession?.state !== "TokenRotated") throw new Error();
    userCookie = setCookie(userCookie, userSession);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const userSession = await consume(db, userCookie, config);
    if (userSession?.state !== "TokenRotated") throw new Error();
    userCookie = setCookie(userCookie, userSession);
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    if (attackerSession?.state !== "SessionForked") throw new Error();
    if (attackerSession.cookie?.value !== "") throw new Error();
    if (attackerSession.cookie?.options.maxAge !== 0) throw new Error();
    attackerCookie = setCookie(attackerCookie, attackerSession);
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    if (attackerSession?.state !== "CookieMissing") throw new Error();
  }
  {
    const userSession = await consume(db, userCookie, config);
    if (userSession?.state !== "SessionNotFound") throw new Error();
  }
});

test("consume: state SessionForked after used by attacker, attacker, user", async () => {
  let userCookie: string | undefined;
  let attackerCookie: string | undefined;
  let date: string;
  const db: Map<string, Session> = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const userSession = await login(db, { config });
    userCookie = setCookie(userCookie, userSession);
  }
  attackerCookie = userCookie;
  {
    date = "2023-10-01T00:11:00Z";
    const attackerSession = await consume(db, attackerCookie, config);
    if (attackerSession?.state !== "TokenRotated") throw new Error();
    attackerCookie = setCookie(attackerCookie, attackerSession);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const attackerSession = await consume(db, attackerCookie, config);
    if (attackerSession?.state !== "TokenRotated") throw new Error();
    attackerCookie = setCookie(attackerCookie, attackerSession);
  }
  {
    const userSession = await consume(db, userCookie, config);
    if (userSession?.state !== "SessionForked") throw new Error();
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    if (attackerSession?.state !== "SessionNotFound") throw new Error();
  }
});

test("consume: state SessionForked after used by attacker, user, attacker, user", async () => {
  let userCookie: string | undefined;
  let attackerCookie: string | undefined;
  let date: string;
  const db: Map<string, Session> = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const userSession = await login(db, { config });
    userCookie = setCookie(userCookie, userSession);
  }
  attackerCookie = userCookie;
  {
    date = "2023-10-01T00:11:00Z";
    const attackerSession = await consume(db, attackerCookie, config);
    if (attackerSession?.state !== "TokenRotated") throw new Error();
    attackerCookie = setCookie(attackerCookie, attackerSession);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const userSession = await consume(db, userCookie, config);
    if (userSession?.state !== "SessionActive") throw new Error();
    userCookie = setCookie(userCookie, userSession);
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    if (attackerSession?.state !== "TokenRotated") throw new Error();
    attackerCookie = setCookie(attackerCookie, attackerSession);
  }
  {
    const userSession = await consume(db, userCookie, config);
    if (userSession?.state !== "SessionForked") throw new Error();
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    if (attackerSession?.state !== "SessionNotFound") throw new Error();
  }
});

test("consume: state SessionForked after used by user, attacker, user, attacker", async () => {
  let userCookie: string | undefined;
  let attackerCookie: string | undefined;
  let date: string;
  const db: Map<string, Session> = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const userSession = await login(db, { config });
    userCookie = setCookie(userCookie, userSession);
  }
  attackerCookie = userCookie;
  {
    date = "2023-10-01T00:11:00Z";
    const userSession = await consume(db, userCookie, config);
    if (userSession?.state !== "TokenRotated") throw new Error();
    userCookie = setCookie(userCookie, userSession);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const attackerSession = await consume(db, attackerCookie, config);
    if (attackerSession?.state !== "SessionActive") throw new Error();
    attackerCookie = setCookie(attackerCookie, attackerSession);
  }
  {
    const userSession = await consume(db, userCookie, config);
    if (userSession?.state !== "TokenRotated") throw new Error();
    userCookie = setCookie(userCookie, userSession);
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    if (attackerSession?.state !== "SessionForked") throw new Error();
  }
  {
    const userSession = await consume(db, userCookie, config);
    if (userSession?.state !== "SessionNotFound") throw new Error();
  }
});

test("consume: state SessionActive with previous cookie (race condition)", async () => {
  let cookie: string | undefined;
  let prevCookie: string | undefined;
  let date: string;
  const db: Map<string, Session> = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, prevCookie, config);
    if (session?.state !== "SessionActive") throw new Error();
  }
  {
    const session = await consume(db, cookie, config);
    if (session?.state !== "SessionActive") throw new Error();
  }
});

test("consume: state SessionActive with previous cookie after 2 rotations", async () => {
  let cookie: string | undefined;
  let prevCookie: string | undefined;
  let date: string;
  const db: Map<string, Session> = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, prevCookie, config);
    if (session?.state !== "SessionActive") throw new Error();
  }
  {
    const session = await consume(db, cookie, config);
    if (session?.state !== "SessionActive") throw new Error();
  }
});

test("consume: state SessionActive with previous cookie after 3 rotations", async () => {
  let cookie: string | undefined;
  let prevCookie: string | undefined;
  let date: string;
  const db: Map<string, Session> = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:33:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, prevCookie, config);
    if (session?.state !== "SessionActive") throw new Error();
  }
  {
    const session = await consume(db, cookie, config);
    if (session?.state !== "SessionActive") throw new Error();
  }
});

test("consume: state SessionActive with previous cookie after 4 rotations", async () => {
  let cookie: string | undefined;
  let prevCookie: string | undefined;
  let date: string;
  const db: Map<string, Session> = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:33:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:44:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, prevCookie, config);
    if (session?.state !== "SessionActive") throw new Error();
  }
  {
    const session = await consume(db, cookie, config);
    if (session?.state !== "SessionActive") throw new Error();
  }
});

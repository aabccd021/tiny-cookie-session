import { expect, test } from "bun:test";
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
    expect(session.cookie.options.expires?.toISOString()).toEqual("2023-10-01T05:00:00.000Z");
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("SessionActive");
    expect(session.data?.exp.toISOString()).toEqual("2023-10-01T05:00:00.000Z");
    expect(session.data?.tokenExp.toISOString()).toEqual("2023-10-01T00:10:00.000Z");
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
    expect(session.cookie?.value).toEqual("");
    expect(session.cookie?.options.maxAge).toEqual(0);
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("CookieMissing");
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
    expect(session?.state).toEqual("SessionActive");
    expect(session.data?.exp.toISOString()).toEqual("2023-10-01T05:00:00.000Z");
    expect(session.data?.tokenExp.toISOString()).toEqual("2023-10-01T00:10:00.000Z");
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
    expect(session?.state).toEqual("SessionActive");
    expect(session.data?.exp.toISOString()).toEqual("2023-10-01T05:00:00.000Z");
    expect(session.data?.tokenExp.toISOString()).toEqual("2023-10-01T00:10:00.000Z");
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
    expect(session?.state).toEqual("TokenRotated");
    expect(session.cookie?.options.expires?.toISOString()).toEqual("2023-10-01T05:11:00.000Z");
    expect(session.data?.exp.toISOString()).toEqual("2023-10-01T05:11:00.000Z");
    expect(session.data?.tokenExp.toISOString()).toEqual("2023-10-01T00:21:00.000Z");
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
    expect(session?.state).toEqual("TokenRotated");
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("SessionActive");
    expect(session.data?.exp.toISOString()).toEqual("2023-10-01T05:11:00.000Z");
    expect(session.data?.tokenExp.toISOString()).toEqual("2023-10-01T00:21:00.000Z");
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
    expect(session?.state).toEqual("SessionExpired");
    expect(session.cookie?.value).toEqual("");
    expect(session.cookie?.options.maxAge).toEqual(0);
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("CookieMissing");
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
    expect(session?.state).toEqual("TokenRotated");
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("TokenRotated");
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("SessionActive");
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
    expect(session?.state).toEqual("SessionActive");
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
    expect(userSession?.state).toEqual("TokenRotated");
    userCookie = setCookie(userCookie, userSession);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const userSession = await consume(db, userCookie, config);
    expect(userSession?.state).toEqual("TokenRotated");
    userCookie = setCookie(userCookie, userSession);
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    expect(attackerSession?.state).toEqual("SessionForked");
    expect(attackerSession.cookie?.value).toEqual("");
    expect(attackerSession.cookie?.options.maxAge).toEqual(0);
    attackerCookie = setCookie(attackerCookie, attackerSession);
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    expect(attackerSession?.state).toEqual("CookieMissing");
  }
  {
    const userSession = await consume(db, userCookie, config);
    expect(userSession?.state).toEqual("SessionNotFound");
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
    expect(attackerSession?.state).toEqual("TokenRotated");
    attackerCookie = setCookie(attackerCookie, attackerSession);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const attackerSession = await consume(db, attackerCookie, config);
    expect(attackerSession?.state).toEqual("TokenRotated");
    attackerCookie = setCookie(attackerCookie, attackerSession);
  }
  {
    const userSession = await consume(db, userCookie, config);
    expect(userSession?.state).toEqual("SessionForked");
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    expect(attackerSession?.state).toEqual("SessionNotFound");
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
    expect(attackerSession?.state).toEqual("TokenRotated");
    attackerCookie = setCookie(attackerCookie, attackerSession);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const userSession = await consume(db, userCookie, config);
    expect(userSession?.state).toEqual("SessionActive");
    userCookie = setCookie(userCookie, userSession);
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    expect(attackerSession?.state).toEqual("TokenRotated");
    attackerCookie = setCookie(attackerCookie, attackerSession);
  }
  {
    const userSession = await consume(db, userCookie, config);
    expect(userSession?.state).toEqual("SessionForked");
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    expect(attackerSession?.state).toEqual("SessionNotFound");
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
    expect(userSession?.state).toEqual("TokenRotated");
    userCookie = setCookie(userCookie, userSession);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const attackerSession = await consume(db, attackerCookie, config);
    expect(attackerSession?.state).toEqual("SessionActive");
    attackerCookie = setCookie(attackerCookie, attackerSession);
  }
  {
    const userSession = await consume(db, userCookie, config);
    expect(userSession?.state).toEqual("TokenRotated");
    userCookie = setCookie(userCookie, userSession);
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    expect(attackerSession?.state).toEqual("SessionForked");
  }
  {
    const userSession = await consume(db, userCookie, config);
    expect(userSession?.state).toEqual("SessionNotFound");
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
    expect(session?.state).toEqual("TokenRotated");
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, prevCookie, config);
    expect(session?.state).toEqual("SessionActive");
  }
  {
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("SessionActive");
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
    expect(session?.state).toEqual("TokenRotated");
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("TokenRotated");
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, prevCookie, config);
    expect(session?.state).toEqual("SessionActive");
  }
  {
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("SessionActive");
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
    expect(session?.state).toEqual("TokenRotated");
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("TokenRotated");
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:33:00Z";
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("TokenRotated");
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, prevCookie, config);
    expect(session?.state).toEqual("SessionActive");
  }
  {
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("SessionActive");
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
    expect(session?.state).toEqual("TokenRotated");
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("TokenRotated");
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:33:00Z";
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("TokenRotated");
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:44:00Z";
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("TokenRotated");
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, prevCookie, config);
    expect(session?.state).toEqual("SessionActive");
  }
  {
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("SessionActive");
  }
});

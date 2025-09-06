import * as sqlite from "bun:sqlite";
import { expect, test } from "bun:test";
import * as tcs from ".";

const testConfig = {
  tokenExpiresIn: 10 * 60 * 1000,
  sessionExpiresIn: 5 * 60 * 60 * 1000,
};

function dbInit() {
  const db = new sqlite.Database(":memory:", { strict: true });

  db.run(`
    CREATE TABLE session (
      id_hash TEXT PRIMARY KEY,
      exp TEXT NOT NULL,
      odd_token_hash TEXT,
      even_token_hash TEXT,
      token_exp TEXT NOT NULL,
      is_latest_token_odd INTEGER NOT NULL,
      CHECK (is_latest_token_odd IN (0, 1))
    ) STRICT;
  `);

  return db;
}

function dbSelect(db: sqlite.Database, idHash: string) {
  const row = db
    .query<
      {
        exp: string;
        token_exp: string;
        odd_token_hash: string | null;
        even_token_hash: string | null;
        is_latest_token_odd: number;
      },
      sqlite.SQLQueryBindings
    >(`
      SELECT exp, token_exp, odd_token_hash, even_token_hash, is_latest_token_odd
      FROM session WHERE id_hash = :id_hash
    `)
    .get({ id_hash: idHash });

  if (row === null) {
    return undefined;
  }

  return {
    exp: new Date(row.exp),
    tokenExp: new Date(row.token_exp),
    oddTokenHash: row.odd_token_hash ?? undefined,
    evenTokenHash: row.even_token_hash ?? undefined,
    isLatestTokenOdd: row.is_latest_token_odd === 1,
  };
}

function dbInsertSession(db: sqlite.Database, action: tcs.InsertSessionAction) {
  db.query(`
    INSERT INTO session (id_hash, exp, odd_token_hash, token_exp, is_latest_token_odd)
    VALUES (:id_hash, :exp, :odd_token_hash, :token_exp, :is_latest_token_odd)
  `).run({
    id_hash: action.idHash,
    exp: action.exp.toISOString(),
    odd_token_hash: action.oddTokenHash,
    token_exp: action.tokenExp.toISOString(),
    is_latest_token_odd: action.isLatestTokenOdd ? 1 : 0,
  });
}

function dbUpdateSession(db: sqlite.Database, action: tcs.UpdateSessionAction) {
  db.query(`
    UPDATE session
    SET 
      exp = :exp,
      token_exp = :token_exp,
      odd_token_hash = COALESCE(:odd_token_hash, odd_token_hash),
      even_token_hash = COALESCE(:even_token_hash, even_token_hash),
      is_latest_token_odd = :is_latest_token_odd
    WHERE id_hash = :id_hash
  `).run({
    id_hash: action.idHash,
    exp: action.exp.toISOString(),
    token_exp: action.tokenExp.toISOString(),
    odd_token_hash: action.oddTokenHash ?? null,
    even_token_hash: action.evenTokenHash ?? null,
    is_latest_token_odd: action.isLatestTokenOdd ? 1 : 0,
  });
}

function dbDeleteToken(db: sqlite.Database, action: tcs.DeleteTokenAction) {
  if (action.tokenType === "odd") {
    db.query("UPDATE session SET odd_token_hash = NULL WHERE id_hash = :id_hash").run({
      id_hash: action.idHash,
    });
  } else if (action.tokenType === "even") {
    db.query("UPDATE session SET even_token_hash = NULL WHERE id_hash = :id_hash").run({
      id_hash: action.idHash,
    });
  } else {
    action.tokenType satisfies never;
  }
}

function dbDeleteSession(db: sqlite.Database, action: tcs.DeleteSessionAction) {
  db.query("DELETE FROM session WHERE id_hash = :id_hash").run({ id_hash: action.idHash });
}

async function login(db: sqlite.Database, arg: import("./index").LoginArg) {
  const session = await tcs.login(arg);

  if (session.action.type === "InsertSession") {
    dbInsertSession(db, session.action);
  } else {
    session.action.type satisfies never;
  }

  return session;
}

async function logout(db: sqlite.Database, cookie: string | undefined) {
  if (cookie === undefined) {
    return { cookie: undefined, action: undefined };
  }

  const credential = await tcs.credentialFromCookie({ cookie });
  if (credential === undefined) {
    return { cookie: tcs.logoutCookie, action: undefined };
  }

  const session = await tcs.logout({ credential });

  if (session.action.type === "DeleteSession") {
    dbDeleteSession(db, session.action);
  } else {
    session.action.type satisfies never;
    throw new Error("Unreachable");
  }

  return session;
}

async function consume(
  db: sqlite.Database,
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

  const sessionData = dbSelect(db, credential.idHash);
  if (sessionData === undefined) {
    return { state: "SessionNotFound", cookie: tcs.logoutCookie, data: undefined };
  }
  const session = await tcs.consume({ credential, config, sessionData });

  if (session.action?.type === "DeleteSession") {
    dbDeleteSession(db, session.action);
  } else if (session.action?.type === "UpdateSession") {
    dbUpdateSession(db, session.action);
  } else if (session.action?.type === "DeleteToken") {
    dbDeleteToken(db, session.action);
  } else if (session.action !== undefined) {
    session.action satisfies never;
    throw new Error("Unreachable");
  }

  if (session.state === "Active") {
    return { state: "Active", cookie: session.cookie, data: sessionData };
  }

  if (session.state === "Expired") {
    return { state: "Expired", cookie: session.cookie, data: undefined };
  }

  if (session.state === "Forked") {
    return { state: "Forked", cookie: session.cookie, data: undefined };
  }

  session satisfies never;
  throw new Error("Unreachable");
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
  const db = dbInit();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    expect(session.cookie.options.expires?.toISOString()).toEqual("2023-10-01T05:00:00.000Z");
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("Active");
  }
  {
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("Active");
    expect(session.data?.exp.toISOString()).toEqual("2023-10-01T05:00:00.000Z");
    expect(session.data?.tokenExp.toISOString()).toEqual("2023-10-01T00:10:00.000Z");
  }
});

test("logout", async () => {
  let cookie: string | undefined;
  let date: string;
  const db = dbInit();
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

test("consume: state Active after login", async () => {
  let cookie: string | undefined;
  let date: string;
  const db = dbInit();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("Active");
    expect(session.data?.exp.toISOString()).toEqual("2023-10-01T05:00:00.000Z");
    expect(session.data?.tokenExp.toISOString()).toEqual("2023-10-01T00:10:00.000Z");
  }
});

test("consume: state Active after 9 minutes", async () => {
  let cookie: string | undefined;
  let date: string;
  const db = dbInit();

  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:09:00Z";
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("Active");
    expect(session.data?.exp.toISOString()).toEqual("2023-10-01T05:00:00.000Z");
    expect(session.data?.tokenExp.toISOString()).toEqual("2023-10-01T00:10:00.000Z");
  }
});

test("consume: state Active after 11 minutes", async () => {
  let cookie: string | undefined;
  let date: string;
  const db = dbInit();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("Active");
    expect(session.cookie?.options.expires?.toISOString()).toEqual("2023-10-01T05:11:00.000Z");
  }
  {
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("Active");
    expect(session.data?.exp.toISOString()).toEqual("2023-10-01T05:11:00.000Z");
    expect(session.data?.tokenExp.toISOString()).toEqual("2023-10-01T00:21:00.000Z");
  }
});

test("consume: state Active after Active", async () => {
  let cookie: string | undefined;
  let date: string;
  const db = dbInit();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("Active");
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("Active");
    expect(session.data?.exp.toISOString()).toEqual("2023-10-01T05:11:00.000Z");
    expect(session.data?.tokenExp.toISOString()).toEqual("2023-10-01T00:21:00.000Z");
  }
});

test("consume: state Expired after 6 hours", async () => {
  let cookie: string | undefined;
  let date: string;
  const db = dbInit();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T06:00:00Z";
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("Expired");
    expect(session.cookie?.value).toEqual("");
    expect(session.cookie?.options.maxAge).toEqual(0);
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("CookieMissing");
  }
});

test("consume: state Active after Active twice", async () => {
  let cookie: string | undefined;
  let date: string;
  const db = dbInit();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("Active");
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("Active");
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("Active");
  }
});

test("consume: state Active after re-login", async () => {
  let cookie: string | undefined;
  let date: string;
  const db = dbInit();
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
    expect(session?.state).toEqual("Active");
  }
});

test("consume: state Forked after [10m, user, 10m, user, attacker]", async () => {
  let userCookie: string | undefined;
  let attackerCookie: string | undefined;
  let date: string;
  const db = dbInit();
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
    expect(userSession?.state).toEqual("Active");
    userCookie = setCookie(userCookie, userSession);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const userSession = await consume(db, userCookie, config);
    expect(userSession?.state).toEqual("Active");
    userCookie = setCookie(userCookie, userSession);
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    expect(attackerSession?.state).toEqual("Forked");
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

test("consume: state Forked after [10m, user, user, attacker]", async () => {
  let userCookie: string | undefined;
  let attackerCookie: string | undefined;
  let date: string;
  const db = dbInit();
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
    expect(userSession?.state).toEqual("Active");
    userCookie = setCookie(userCookie, userSession);
  }
  {
    const userSession = await consume(db, userCookie, config);
    expect(userSession?.state).toEqual("Active");
    userCookie = setCookie(userCookie, userSession);
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    expect(attackerSession?.state).toEqual("Forked");
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

test("consume: state Forked after [10m, attacker, 10m, attacker, user]", async () => {
  let userCookie: string | undefined;
  let attackerCookie: string | undefined;
  let date: string;
  const db = dbInit();
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
    expect(attackerSession?.state).toEqual("Active");
    attackerCookie = setCookie(attackerCookie, attackerSession);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const attackerSession = await consume(db, attackerCookie, config);
    expect(attackerSession?.state).toEqual("Active");
    attackerCookie = setCookie(attackerCookie, attackerSession);
  }
  {
    const userSession = await consume(db, userCookie, config);
    expect(userSession?.state).toEqual("Forked");
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    expect(attackerSession?.state).toEqual("SessionNotFound");
  }
});

test("consume: state Forked after [10m, attacker, attacker, user]", async () => {
  let userCookie: string | undefined;
  let attackerCookie: string | undefined;
  let date: string;
  const db = dbInit();
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
    expect(attackerSession?.state).toEqual("Active");
    attackerCookie = setCookie(attackerCookie, attackerSession);
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    expect(attackerSession?.state).toEqual("Active");
    attackerCookie = setCookie(attackerCookie, attackerSession);
  }
  {
    const userSession = await consume(db, userCookie, config);
    expect(userSession?.state).toEqual("Forked");
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    expect(attackerSession?.state).toEqual("SessionNotFound");
  }
});

test("consume: state Forked after [10m, attacker, 10m, user, attacker, user]", async () => {
  let userCookie: string | undefined;
  let attackerCookie: string | undefined;
  let date: string;
  const db = dbInit();
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
    expect(attackerSession?.state).toEqual("Active");
    attackerCookie = setCookie(attackerCookie, attackerSession);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const userSession = await consume(db, userCookie, config);
    expect(userSession?.state).toEqual("Active");
    userCookie = setCookie(userCookie, userSession);
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    expect(attackerSession?.state).toEqual("Active");
    attackerCookie = setCookie(attackerCookie, attackerSession);
  }
  {
    const userSession = await consume(db, userCookie, config);
    expect(userSession?.state).toEqual("Forked");
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    expect(attackerSession?.state).toEqual("SessionNotFound");
  }
});

test("consume: state Forked after [10m, attacker, user, attacker, user]", async () => {
  let userCookie: string | undefined;
  let attackerCookie: string | undefined;
  let date: string;
  const db = dbInit();
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
    expect(attackerSession?.state).toEqual("Active");
    attackerCookie = setCookie(attackerCookie, attackerSession);
  }
  {
    const userSession = await consume(db, userCookie, config);
    expect(userSession?.state).toEqual("Active");
    userCookie = setCookie(userCookie, userSession);
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    expect(attackerSession?.state).toEqual("Active");
    attackerCookie = setCookie(attackerCookie, attackerSession);
  }
  {
    const userSession = await consume(db, userCookie, config);
    expect(userSession?.state).toEqual("Forked");
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    expect(attackerSession?.state).toEqual("SessionNotFound");
  }
});

test("consume: state Forked after [10m, user, 10m, attacker, user, attacker]", async () => {
  let userCookie: string | undefined;
  let attackerCookie: string | undefined;
  let date: string;
  const db = dbInit();
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
    expect(userSession?.state).toEqual("Active");
    userCookie = setCookie(userCookie, userSession);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const attackerSession = await consume(db, attackerCookie, config);
    expect(attackerSession?.state).toEqual("Active");
    attackerCookie = setCookie(attackerCookie, attackerSession);
  }
  {
    const userSession = await consume(db, userCookie, config);
    expect(userSession?.state).toEqual("Active");
    userCookie = setCookie(userCookie, userSession);
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    expect(attackerSession?.state).toEqual("Forked");
  }
  {
    const userSession = await consume(db, userCookie, config);
    expect(userSession?.state).toEqual("SessionNotFound");
  }
});

test("consume: state Active with previous cookie (race condition)", async () => {
  let cookie: string | undefined;
  let prevCookie: string | undefined;
  let date: string;
  const db = dbInit();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("Active");
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, prevCookie, config);
    expect(session?.state).toEqual("Active");
  }
  {
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("Active");
  }
});

test("consume: state Active with previous cookie after 2 rotations", async () => {
  let cookie: string | undefined;
  let prevCookie: string | undefined;
  let date: string;
  const db = dbInit();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("Active");
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("Active");
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, prevCookie, config);
    expect(session?.state).toEqual("Active");
  }
  {
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("Active");
  }
});

test("consume: state Active with previous cookie after 3 rotations", async () => {
  let cookie: string | undefined;
  let prevCookie: string | undefined;
  let date: string;
  const db = dbInit();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("Active");
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("Active");
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:33:00Z";
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("Active");
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, prevCookie, config);
    expect(session?.state).toEqual("Active");
  }
  {
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("Active");
  }
});

test("consume: state Active with previous cookie after 4 rotations", async () => {
  let cookie: string | undefined;
  let prevCookie: string | undefined;
  let date: string;
  const db = dbInit();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("Active");
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("Active");
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:33:00Z";
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("Active");
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:44:00Z";
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("Active");
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, prevCookie, config);
    expect(session?.state).toEqual("Active");
  }
  {
    const session = await consume(db, cookie, config);
    expect(session?.state).toEqual("Active");
  }
});

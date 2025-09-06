import * as tcs from ".";

const testConfig = {
  tokenExpiresIn: 10 * 60 * 1000,
  sessionExpiresIn: 5 * 60 * 60 * 1000,
};

function dbSelect(db: Map<string, tcs.SessionData>, idHash: string) {
  return db.get(idHash);
}

function dbUpsertSession(db: Map<string, tcs.SessionData>, action: tcs.UpsertSessionAction) {
  db.set(action.idHash, action.sessionData);
}

function dbDeleteSession(db: Map<string, tcs.SessionData>, action: tcs.DeleteSessionAction) {
  db.delete(action.idHash);
}

async function login(db: Map<string, tcs.SessionData>, arg: import("./index").LoginArg) {
  const session = await tcs.login(arg);
  dbUpsertSession(db, session.action);
  return session;
}

async function logout(db: Map<string, tcs.SessionData>, cookie: string | undefined) {
  if (cookie === undefined) {
    return { cookie: undefined, action: undefined };
  }

  const credential = await tcs.credentialFromCookie({ cookie });
  if (credential === undefined) {
    return { cookie: tcs.logoutCookie, action: undefined };
  }

  const session = await tcs.logout({ credential });
  dbDeleteSession(db, session.action);
  return session;
}

async function consume(
  db: Map<string, tcs.SessionData>,
  cookie: string | undefined,
  config: import("./index").Config,
): Promise<{
  readonly state:
    | "CookieMissing"
    | "CookieMalformed"
    | "NotFound"
    | "Active"
    | "Expired"
    | "Forked";
  readonly action?: tcs.Action;
  readonly cookie?: tcs.Cookie;
  readonly data?: tcs.SessionData;
}> {
  if (cookie === undefined) {
    return { state: "CookieMissing" };
  }

  const credential = await tcs.credentialFromCookie({ cookie });
  if (credential === undefined) {
    return {
      state: "CookieMalformed",
      cookie: tcs.logoutCookie,
    };
  }

  const sessionData = dbSelect(db, credential.idHash);
  if (sessionData === undefined) {
    return {
      state: "NotFound",
      cookie: tcs.logoutCookie,
    };
  }
  const session = await tcs.consume({ credential, config, sessionData });

  if (session.action?.type === "DeleteSession") {
    dbDeleteSession(db, session.action);
  } else if (session.action?.type === "UpsertSession") {
    dbUpsertSession(db, session.action);
  } else if (session.action !== undefined) {
    session.action satisfies never;
    throw new Error("Unreachable");
  }

  return {
    state: session.state,
    cookie: session.cookie,
    action: session.action,

    // Only return session data if state is Active
    data: session.state === "Active" ? sessionData : undefined,
  };
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

{
  console.info("login");
  let cookie: string | undefined;
  let date: string;
  const db = new Map<string, tcs.SessionData>();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    console.log(session.cookie.options.expires?.toISOString());
    if (session.cookie.options.expires?.toISOString() !== "2023-10-01T05:00:00.000Z")
      throw new Error();
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, cookie, config);
    if (session?.state !== "Active") throw new Error();
  }
  {
    const session = await consume(db, cookie, config);
    if (session?.state !== "Active") throw new Error();
    if (session.data?.sessionExp.toISOString() !== "2023-10-01T05:00:00.000Z") throw new Error();
    if (session.data?.tokenExp.toISOString() !== "2023-10-01T00:10:00.000Z") throw new Error();
  }
}

{
  console.info("logout");
  let cookie: string | undefined;
  let date: string;
  const db = new Map<string, tcs.SessionData>();
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
    if (session.cookie?.options.maxAge !== 0) throw new Error();
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, cookie, config);
    if (session?.state !== "CookieMissing") throw new Error();
  }
}

{
  console.info("consume: state Active after login");
  let cookie: string | undefined;
  let date: string;
  const db = new Map<string, tcs.SessionData>();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, cookie, config);
    if (session?.state !== "Active") throw new Error();
    if (session.data?.sessionExp.toISOString() !== "2023-10-01T05:00:00.000Z") throw new Error();
    if (session.data?.tokenExp.toISOString() !== "2023-10-01T00:10:00.000Z") throw new Error();
  }
}

{
  console.info("consume: state Active after 9 minutes");
  let cookie: string | undefined;
  let date: string;
  const db = new Map<string, tcs.SessionData>();

  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:09:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "Active") throw new Error();
    if (session.data?.sessionExp.toISOString() !== "2023-10-01T05:00:00.000Z") throw new Error();
    if (session.data?.tokenExp.toISOString() !== "2023-10-01T00:10:00.000Z") throw new Error();
  }
}

{
  console.info("consume: state Active after 11 minutes");
  let cookie: string | undefined;
  let date: string;
  const db = new Map<string, tcs.SessionData>();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "Active") throw new Error();
    if (session.cookie?.options.expires?.toISOString() !== "2023-10-01T05:11:00.000Z")
      throw new Error();
  }
  {
    const session = await consume(db, cookie, config);
    if (session?.state !== "Active") throw new Error();
    if (session.data?.sessionExp.toISOString() !== "2023-10-01T05:11:00.000Z") throw new Error();
    if (session.data?.tokenExp.toISOString() !== "2023-10-01T00:21:00.000Z") throw new Error();
  }
}

{
  console.info("consume: state Active after Active");
  let cookie: string | undefined;
  let date: string;
  const db = new Map<string, tcs.SessionData>();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "Active") throw new Error();
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, cookie, config);
    if (session?.state !== "Active") throw new Error();
    if (session.data?.sessionExp.toISOString() !== "2023-10-01T05:11:00.000Z") throw new Error();
    if (session.data?.tokenExp.toISOString() !== "2023-10-01T00:21:00.000Z") throw new Error();
  }
}

{
  console.info("consume: state Expired after 6 hours");
  let cookie: string | undefined;
  let date: string;
  const db = new Map<string, tcs.SessionData>();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T06:00:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "Expired") throw new Error();
    if (session.cookie?.value !== "") throw new Error();
    if (session.cookie?.options.maxAge !== 0) throw new Error();
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, cookie, config);
    if (session?.state !== "CookieMissing") throw new Error();
  }
}

{
  console.info("consume: state Active after Active twice");
  let cookie: string | undefined;
  let date: string;
  const db = new Map<string, tcs.SessionData>();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "Active") throw new Error();
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "Active") throw new Error();
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, cookie, config);
    if (session?.state !== "Active") throw new Error();
  }
}

{
  console.info("consume: state Active after re-login");
  let cookie: string | undefined;
  let date: string;
  const db = new Map<string, tcs.SessionData>();
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
    if (session?.state !== "Active") throw new Error();
  }
}

{
  console.info("consume: state Forked after used by user, user, attacker");
  let userCookie: string | undefined;
  let attackerCookie: string | undefined;
  let date: string;
  const db = new Map<string, tcs.SessionData>();
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
    if (userSession?.state !== "Active") throw new Error();
    userCookie = setCookie(userCookie, userSession);
  }
  {
    const userSession = await consume(db, userCookie, config);
    if (userSession?.state !== "Active") throw new Error();
    userCookie = setCookie(userCookie, userSession);
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    if (attackerSession?.state !== "Forked") throw new Error();
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
    if (userSession?.state !== "NotFound") throw new Error();
  }
}

{
  console.info("consume: state Forked after used by attacker, attacker, user");
  let userCookie: string | undefined;
  let attackerCookie: string | undefined;
  let date: string;
  const db = new Map<string, tcs.SessionData>();
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
    if (attackerSession?.state !== "Active") throw new Error();
    attackerCookie = setCookie(attackerCookie, attackerSession);
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    if (attackerSession?.state !== "Active") throw new Error();
    attackerCookie = setCookie(attackerCookie, attackerSession);
  }
  {
    const userSession = await consume(db, userCookie, config);
    if (userSession?.state !== "Forked") throw new Error();
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    if (attackerSession?.state !== "NotFound") throw new Error();
  }
}

{
  console.info("consume: state Forked after used by attacker, user, attacker, user");
  let userCookie: string | undefined;
  let attackerCookie: string | undefined;
  let date: string;
  const db = new Map<string, tcs.SessionData>();
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
    if (attackerSession?.state !== "Active") throw new Error();
    attackerCookie = setCookie(attackerCookie, attackerSession);
  }
  {
    const userSession = await consume(db, userCookie, config);
    if (userSession?.state !== "Active") throw new Error();
    userCookie = setCookie(userCookie, userSession);
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    if (attackerSession?.state !== "Active") throw new Error();
    attackerCookie = setCookie(attackerCookie, attackerSession);
  }
  {
    const userSession = await consume(db, userCookie, config);
    if (userSession?.state !== "Forked") throw new Error();
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    if (attackerSession?.state !== "NotFound") throw new Error();
  }
}

{
  console.info("consume: state Forked after used by user, attacker, user, attacker");
  let userCookie: string | undefined;
  let attackerCookie: string | undefined;
  let date: string;
  const db = new Map<string, tcs.SessionData>();
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
    if (userSession?.state !== "Active") throw new Error();
    userCookie = setCookie(userCookie, userSession);
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    if (attackerSession?.state !== "Active") throw new Error();
    attackerCookie = setCookie(attackerCookie, attackerSession);
  }
  {
    const userSession = await consume(db, userCookie, config);
    if (userSession?.state !== "Active") throw new Error();
    userCookie = setCookie(userCookie, userSession);
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    if (attackerSession?.state !== "Forked") throw new Error();
  }
  {
    const userSession = await consume(db, userCookie, config);
    if (userSession?.state !== "NotFound") throw new Error();
  }
}

{
  console.info("consume: state Active with previous cookie (race condition)");
  let cookie: string | undefined;
  let prevCookie: string | undefined;
  let date: string;
  const db = new Map<string, tcs.SessionData>();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "Active") throw new Error();
    if (session?.action?.type !== "UpsertSession") throw new Error();
    if (session?.action?.reason !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, prevCookie, config);
    if (session?.state !== "Active") throw new Error();
  }
  {
    const session = await consume(db, cookie, config);
    if (session?.state !== "Active") throw new Error();
  }
}

{
  console.info("consume: state Active with previous cookie after 2 rotations");
  let cookie: string | undefined;
  let prevCookie: string | undefined;
  let date: string;
  const db = new Map<string, tcs.SessionData>();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "Active") throw new Error();
    if (session?.action?.type !== "UpsertSession") throw new Error();
    if (session?.action?.reason !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "Active") throw new Error();
    if (session?.action?.type !== "UpsertSession") throw new Error();
    if (session?.action?.reason !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, prevCookie, config);
    if (session?.state !== "Active") throw new Error();
  }
  {
    const session = await consume(db, cookie, config);
    if (session?.state !== "Active") throw new Error();
  }
}

{
  console.info("consume: state Active with previous cookie after 3 rotations");
  let cookie: string | undefined;
  let prevCookie: string | undefined;
  let date: string;
  const db = new Map<string, tcs.SessionData>();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "Active") throw new Error();
    if (session?.action?.type !== "UpsertSession") throw new Error();
    if (session?.action?.reason !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "Active") throw new Error();
    if (session?.action?.type !== "UpsertSession") throw new Error();
    if (session?.action?.reason !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:33:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "Active") throw new Error();
    if (session?.action?.type !== "UpsertSession") throw new Error();
    if (session?.action?.reason !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, prevCookie, config);
    if (session?.state !== "Active") throw new Error();
  }
  {
    const session = await consume(db, cookie, config);
    if (session?.state !== "Active") throw new Error();
  }
}

{
  console.info("consume: state Active with previous cookie after 4 rotations");
  let cookie: string | undefined;
  let prevCookie: string | undefined;
  let date: string;
  const db = new Map<string, tcs.SessionData>();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "Active") throw new Error();
    if (session?.action?.type !== "UpsertSession") throw new Error();
    if (session?.action?.reason !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:22:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "Active") throw new Error();
    if (session?.action?.type !== "UpsertSession") throw new Error();
    if (session?.action?.reason !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:33:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "Active") throw new Error();
    if (session?.action?.type !== "UpsertSession") throw new Error();
    if (session?.action?.reason !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    date = "2023-10-01T00:44:00Z";
    const session = await consume(db, cookie, config);
    if (session?.state !== "Active") throw new Error();
    prevCookie = cookie;
    cookie = setCookie(cookie, session);
  }
  {
    const session = await consume(db, prevCookie, config);
    if (session?.state !== "Active") throw new Error();
  }
  {
    const session = await consume(db, cookie, config);
    if (session?.state !== "Active") throw new Error();
  }
}

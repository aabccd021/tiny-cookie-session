import * as lib from ".";

/**
 * @typedef {Object} Session
 * @property {Date} exp
 * @property {Date} tokenExp
 * @property {string} oddTokenHash
 * @property {string} [evenTokenHash]
 * @property {boolean} isLatestTokenOdd
 */

const testConfig = {
  tokenExpiresIn: 10 * 60 * 1000,
  sessionExpiresIn: 5 * 60 * 60 * 1000,
};

/**
 * @param {Map<string, Session>} db
 * @param {string} sessionIdHash
 */
function dbSelect(db, sessionIdHash) {
  return db.get(sessionIdHash);
}

/**
 * @param {Map<string, Session>} db
 * @param {import("./index").InsertAction} arg
 */
function dbInsert(db, arg) {
  db.set(arg.idHash, {
    oddTokenHash: arg.oddTokenHash,
    evenTokenHash: undefined,
    exp: arg.exp,
    tokenExp: arg.tokenExp,
    isLatestTokenOdd: true,
  });
}

/**
 * @param {Map<string, Session>} db
 * @param {import("./index").DeleteAction} arg
 */
function dbDelete(db, arg) {
  db.delete(arg.idHash);
}

/**
 * @param {Map<string, Session>} db
 * @param {import("./index").UpdateAction} arg
 */
function dbUpdate(db, arg) {
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

/**
 * @param {Map<string, Session>} db
 * @param {import("./index").LoginArg} arg
 */
async function login(db, arg) {
  const result = await lib.login(arg);

  if (result.action.type === "insert") {
    dbInsert(db, result.action);
  } else {
    throw new Error("Unexpected action type");
  }

  return result;
}

/**
 * @param {Map<string, Session>} db
 * @param {string | undefined} cookie
 */
async function logout(db, cookie) {
  if (cookie === undefined) {
    return { cookie: undefined, action: undefined };
  }

  const credential = await lib.credentialFromCookie({ cookie });
  if (credential.data === undefined) {
    return { cookie: credential.cookie, action: undefined };
  }

  const result = await lib.logout({ credentialData: credential.data });

  if (result.action.type === "delete") {
    dbDelete(db, result.action);
  } else {
    throw new Error("Unexpected action type");
  }

  return result;
}

/**
 * @param {Map<string, Session>} db
 * @param {string | undefined} cookie
 * @param {import("./index").Config} config
 */
async function consume(db, cookie, config) {
  if (cookie === undefined) {
    return { state: "CookieMissing", cookie: undefined, data: undefined };
  }

  const credential = await lib.credentialFromCookie({ cookie });
  if (credential.data === undefined) {
    return { state: "CookieMalformed", cookie: credential.cookie, data: undefined };
  }

  const data = dbSelect(db, credential.data.idHash);

  /** @type {import("./index").Session} */
  const session = data !== undefined ? { found: true, data } : { found: false };

  const result = await lib.consume({ credentialData: credential.data, config, session });

  if (result.action?.type === "delete") {
    dbDelete(db, result.action);
  } else if (result.action?.type === "update") {
    dbUpdate(db, result.action);
  } else if (result.action !== undefined) {
    throw new Error("Unexpected action type");
  }

  if (result.state === "SessionActive") {
    return { state: "SessionActive", cookie: result.cookie, data };
  }

  if (result.state === "TokenRotated") {
    return { state: "TokenRotated", cookie: result.cookie, data };
  }

  if (result.state === "SessionNotFound") {
    return { state: "SessionNotFound", cookie: result.cookie, data: undefined };
  }

  if (result.state === "SessionExpired") {
    return { state: "SessionExpired", cookie: result.cookie, data: undefined };
  }

  if (result.state === "SessionForked") {
    return { state: "SessionForked", cookie: result.cookie, data: undefined };
  }

  throw new Error("Unexpected state");
}

/**
 * @param {string | undefined} cookie
 * @param {Object} session
 * @param {import("./index").Cookie | undefined} session.cookie
 */
function setCookie(cookie, session) {
  if (session.cookie === undefined) {
    return cookie;
  }

  if (session.cookie.value === "") {
    return undefined;
  }

  return session.cookie.value;
}

{
  console.info("# login");

  /** @type {string | undefined} */ let cookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
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
}

{
  console.info("# logout");

  /** @type {string | undefined} */ let cookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
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
  }
  {
    const session = await consume(db, cookie, config);
    if (session?.state !== "SessionNotFound") throw new Error();
  }
}

{
  console.info("# consume: state SessionActive after login");

  /** @type {string | undefined} */ let cookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
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
}

{
  console.info("# consume: state SessionActive after 9 minutes");

  /** @type {string | undefined} */ let cookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();

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
}

{
  console.info("# consume: state TokenRotated after 11 minutes");

  /** @type {string | undefined} */ let cookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
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
}

{
  console.info("# consume: state SessionActive after TokenRotated");

  /** @type {string | undefined} */ let cookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
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
}

{
  console.info("# consume: state Expired after 6 hours");

  /** @type {string | undefined} */ let cookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
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
  }
  {
    const session = await consume(db, cookie, config);
    if (session?.state !== "SessionNotFound") throw new Error();
  }
}

{
  console.info("# consume: state SessionActive after TokenRotated twice");

  /** @type {string | undefined} */ let cookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
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
}

{
  console.info("# consume: state SessionActive after re-login");

  /** @type {string | undefined} */ let cookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
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
}

{
  console.info("# consume: state SessionForked after used by user, user, attacker");
  /** @type {string | undefined} */ let userCookie;
  /** @type {string | undefined} */ let attackerCookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
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
  }
  {
    const attackerSession = await consume(db, attackerCookie, config);
    if (attackerSession?.state !== "SessionNotFound") throw new Error();
  }
  {
    const userSession = await consume(db, userCookie, config);
    if (userSession?.state !== "SessionNotFound") throw new Error();
  }
}

{
  console.info("# consume: state SessionForked after used by attacker, attacker, user");
  /** @type {string | undefined} */ let userCookie;
  /** @type {string | undefined} */ let attackerCookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
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
}

{
  console.info("# consume: state SessionForked after used by attacker, user, attacker, user");
  /** @type {string | undefined} */ let userCookie;
  /** @type {string | undefined} */ let attackerCookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
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
}

{
  console.info("# consume: state SessionForked after used by user, attacker, user, attacker");
  /** @type {string | undefined} */ let userCookie;
  /** @type {string | undefined} */ let attackerCookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
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
}

{
  console.info("# consume: state SessionActive with previous cookie (race condition)");

  /** @type {string | undefined} */ let cookie;
  /** @type {string | undefined} */ let prevCookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
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
}

{
  console.info("# consume: state SessionActive with previous cookie after 2 rotations");

  /** @type {string | undefined} */ let cookie;
  /** @type {string | undefined} */ let prevCookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
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
}

{
  console.info("# consume: state SessionActive with previous cookie after 3 rotations");

  /** @type {string | undefined} */ let cookie;
  /** @type {string | undefined} */ let prevCookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
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
}

{
  console.info("# consume: state SessionActive with previous cookie after 4 rotations");

  /** @type {string | undefined} */ let cookie;
  /** @type {string | undefined} */ let prevCookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
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
}

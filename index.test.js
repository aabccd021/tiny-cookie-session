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
 * @param {import("./index").Action} [action]
 */
function runAction(db, action) {
  if (action === undefined) {
    return;
  }

  if (action.type === "insert") {
    db.set(action.idHash, {
      oddTokenHash: action.oddTokenHash,
      evenTokenHash: undefined,
      exp: action.exp,
      tokenExp: action.tokenExp,
      isLatestTokenOdd: true,
    });
  }

  if (action.type === "delete") {
    db.delete(action.idHash);
  }

  if (action.type === "update") {
    const session = db.get(action.idHash);
    if (!session) throw new Error("Session not found for update");

    if (action.evenTokenHash !== undefined) {
      session.evenTokenHash = action.evenTokenHash;
    }
    if (action.oddTokenHash !== undefined) {
      session.oddTokenHash = action.oddTokenHash;
    }
    session.isLatestTokenOdd = action.isLatestTokenOdd;
    session.tokenExp = action.tokenExp;
    session.exp = action.exp;
  }
}

/**
 * @param {Map<string, Session>} db
 * @param {import("./index").LoginArg} arg
 * @returns {Promise<import("./index").LoginResult>}
 */
async function login(db, arg) {
  const result = await lib.login(arg);
  runAction(db, result.action);

  return result;
}

/**
 * @param {Map<string, Session>} db
 * @param {import("./index").CredentialsFromCookieArg} arg
 * @returns {Promise<import("./index").LogoutResult>}
 */
async function logout(db, arg) {
  const credentials = await lib.credentialsFromCookie(arg);
  if (credentials === undefined) throw new Error();

  const result = await lib.logout({ credentials });
  runAction(db, result.action);

  return result;
}

/**
 * @param {Map<string, Session>} db
 * @param {import("./index").Config} config
 * @param {import("./index").CredentialsFromCookieArg} arg
 */
async function consume(db, config, arg) {
  const credentials = await lib.credentialsFromCookie(arg);
  if (credentials === undefined) return undefined;

  const data = db.get(credentials.idHash);
  if (data === undefined) {
    return { state: "SessionExpired", data: undefined, cookie: lib.logoutCookie };
  }

  const result = await lib.consume({ credentials, config, session: data });
  runAction(db, result.action);

  if (result.state === "SessionActive") {
    return { state: result.state, data, cookie: result.cookie };
  }

  if (result.state === "TokenRotated") {
    return { state: result.state, data, cookie: result.cookie };
  }

  if (result.state === "SessionExpired") {
    return { state: result.state, data: undefined, cookie: result.cookie };
  }

  if (result.state === "SessionForked") {
    return { state: result.state, data: undefined, cookie: result.cookie };
  }

  throw new Error("Unexpected state");
}

{
  console.info("# login");

  /** @type {string} */ let cookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    if (session.cookie.options.expires?.toISOString() !== "2023-10-01T05:00:00.000Z")
      throw new Error();
    cookie = session.cookie.value;
  }
  {
    const session = await consume(db, config, { cookie });
    if (session?.state !== "SessionActive") throw new Error();
    if (session.data?.exp.toISOString() !== "2023-10-01T05:00:00.000Z") throw new Error();
    if (session.data?.tokenExp.toISOString() !== "2023-10-01T00:10:00.000Z") throw new Error();
  }
}

{
  console.info("# logout");

  /** @type {string} */ let cookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = session.cookie.value;
  }
  {
    date = "2023-10-01T00:01:00Z";
    const session = await logout(db, { cookie });
    if (session.cookie.value !== "") throw new Error();
    if (session.cookie.options.maxAge !== 0) throw new Error();
  }
  {
    const session = await consume(db, config, { cookie });
    if (session?.state !== "SessionExpired") throw new Error();
  }
}

{
  console.info("# consume: state SessionActive after login");

  /** @type {string} */ let cookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = session.cookie.value;
  }
  {
    const session = await consume(db, config, { cookie });
    if (session?.state !== "SessionActive") throw new Error();
    if (session.data?.exp.toISOString() !== "2023-10-01T05:00:00.000Z") throw new Error();
    if (session.data?.tokenExp.toISOString() !== "2023-10-01T00:10:00.000Z") throw new Error();
  }
}

{
  console.info("# consume: state SessionActive after 9 minutes");

  /** @type {string} */ let cookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();

  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = session.cookie.value;
  }
  {
    date = "2023-10-01T00:09:00Z";
    const session = await consume(db, config, { cookie });
    if (session?.state !== "SessionActive") throw new Error();
    if (session.data?.exp.toISOString() !== "2023-10-01T05:00:00.000Z") throw new Error();
    if (session.data?.tokenExp.toISOString() !== "2023-10-01T00:10:00.000Z") throw new Error();
  }
}

{
  console.info("# consume: state TokenRotated after 11 minutes");

  /** @type {string} */ let cookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = session.cookie.value;
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, config, { cookie });
    if (session?.state !== "TokenRotated") throw new Error();
    if (session.cookie.options.expires?.toISOString() !== "2023-10-01T05:11:00.000Z")
      throw new Error();
    if (session.data?.exp.toISOString() !== "2023-10-01T05:11:00.000Z") throw new Error();
    if (session.data?.tokenExp.toISOString() !== "2023-10-01T00:21:00.000Z") throw new Error();
  }
}

{
  console.info("# consume: state SessionActive after TokenRotated");

  /** @type {string} */ let cookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = session.cookie.value;
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, config, { cookie });
    if (session?.state !== "TokenRotated") throw new Error();
    cookie = session.cookie.value;
  }
  {
    const session = await consume(db, config, { cookie });
    if (session?.state !== "SessionActive") throw new Error();
    if (session.data?.exp.toISOString() !== "2023-10-01T05:11:00.000Z") throw new Error();
    if (session.data?.tokenExp.toISOString() !== "2023-10-01T00:21:00.000Z") throw new Error();
  }
}

{
  console.info("# consume: state Expired after 6 hours");

  /** @type {string} */ let cookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = session.cookie.value;
  }
  {
    date = "2023-10-01T06:00:00Z";
    const session = await consume(db, config, { cookie });
    if (session?.state !== "SessionExpired") throw new Error();
    if (session.cookie.value !== "") throw new Error();
    if (session.cookie.options.maxAge !== 0) throw new Error();
  }
  {
    const session = await consume(db, config, { cookie });
    if (session?.state !== "SessionExpired") throw new Error();
  }
}

{
  console.info("# consume: state SessionActive after TokenRotated twice");

  /** @type {string} */ let cookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = session.cookie.value;
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, config, { cookie });
    if (session?.state !== "TokenRotated") throw new Error();
    cookie = session.cookie.value;
  }
  {
    date = "2023-10-01T00:22:00Z";
    const session = await consume(db, config, { cookie });
    if (session?.state !== "TokenRotated") throw new Error();
    cookie = session.cookie.value;
  }
  {
    const session = await consume(db, config, { cookie });
    if (session?.state !== "SessionActive") throw new Error();
  }
}

{
  console.info("# consume: state SessionActive after re-login");

  /** @type {string} */ let cookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = session.cookie.value;
  }
  {
    const session = await logout(db, { cookie });
    cookie = session.cookie.value;
  }
  {
    const session = await login(db, { config });
    cookie = session.cookie.value;
  }
  {
    const session = await consume(db, config, { cookie });
    if (session?.state !== "SessionActive") throw new Error();
  }
}

{
  console.info("# consume: state SessionForked after used by user, user, attacker");
  /** @type {string} */ let userCookie;
  /** @type {string} */ let attackerCookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const userSession = await login(db, { config });
    userCookie = userSession.cookie.value;
  }
  attackerCookie = userCookie;
  {
    date = "2023-10-01T00:11:00Z";
    const userSession = await consume(db, config, { cookie: userCookie });
    if (userSession?.state !== "TokenRotated") throw new Error();
    userCookie = userSession.cookie.value;
  }
  {
    date = "2023-10-01T00:22:00Z";
    const userSession = await consume(db, config, { cookie: userCookie });
    if (userSession?.state !== "TokenRotated") throw new Error();
    userCookie = userSession.cookie.value;
  }
  {
    const attackerSession = await consume(db, config, { cookie: attackerCookie });
    if (attackerSession?.state !== "SessionForked") throw new Error();
    if (attackerSession.cookie.value !== "") throw new Error();
    if (attackerSession.cookie.options.maxAge !== 0) throw new Error();
  }
  {
    const userSession = await consume(db, config, { cookie: userCookie });
    if (userSession?.state !== "SessionExpired") throw new Error();
  }
}

{
  console.info("# consume: state SessionForked after used by attacker, attacker, user");
  /** @type {string} */ let userCookie;
  /** @type {string} */ let attackerCookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const userSession = await login(db, { config });
    userCookie = userSession.cookie.value;
  }
  attackerCookie = userCookie;
  {
    date = "2023-10-01T00:11:00Z";
    const attackerSession = await consume(db, config, { cookie: attackerCookie });
    if (attackerSession?.state !== "TokenRotated") throw new Error();
    attackerCookie = attackerSession.cookie.value;
  }
  {
    date = "2023-10-01T00:22:00Z";
    const attackerSession = await consume(db, config, { cookie: attackerCookie });
    if (attackerSession?.state !== "TokenRotated") throw new Error();
    attackerCookie = attackerSession.cookie.value;
  }
  {
    const userSession = await consume(db, config, { cookie: userCookie });
    if (userSession?.state !== "SessionForked") throw new Error();
    if (userSession.cookie.value !== "") throw new Error();
    if (userSession.cookie.options.maxAge !== 0) throw new Error();
  }
  {
    const attackerSession = await consume(db, config, { cookie: userCookie });
    if (attackerSession?.state !== "SessionExpired") throw new Error();
  }
}

{
  console.info("# consume: state SessionForked after used by attacker, user, attacker, user");
  /** @type {string} */ let userCookie;
  /** @type {string} */ let attackerCookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const userSession = await login(db, { config });
    userCookie = userSession.cookie.value;
  }
  attackerCookie = userCookie;
  {
    date = "2023-10-01T00:11:00Z";
    const attackerSession = await consume(db, config, { cookie: attackerCookie });
    if (attackerSession?.state !== "TokenRotated") throw new Error();
    attackerCookie = attackerSession.cookie.value;
  }
  {
    date = "2023-10-01T00:22:00Z";
    const userSession = await consume(db, config, { cookie: userCookie });
    if (userSession?.state !== "SessionActive") throw new Error();
  }
  {
    const attackerSession = await consume(db, config, { cookie: attackerCookie });
    if (attackerSession?.state !== "TokenRotated") throw new Error();
    attackerCookie = attackerSession.cookie.value;
  }
  {
    const userSession = await consume(db, config, { cookie: userCookie });
    if (userSession?.state !== "SessionForked") throw new Error();
  }
}

{
  console.info("# consume: state SessionForked after used by user, attacker, user, attacker");
  /** @type {string} */ let userCookie;
  /** @type {string} */ let attackerCookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const userSession = await login(db, { config });
    userCookie = userSession.cookie.value;
  }
  attackerCookie = userCookie;
  {
    date = "2023-10-01T00:11:00Z";
    const userSession = await consume(db, config, { cookie: userCookie });
    if (userSession?.state !== "TokenRotated") throw new Error();
    userCookie = userSession.cookie.value;
  }
  {
    date = "2023-10-01T00:22:00Z";
    const attackerSession = await consume(db, config, { cookie: attackerCookie });
    if (attackerSession?.state !== "SessionActive") throw new Error();
  }
  {
    const userSession = await consume(db, config, { cookie: userCookie });
    if (userSession?.state !== "TokenRotated") throw new Error();
    userCookie = userSession.cookie.value;
  }
  {
    const attackerSession = await consume(db, config, { cookie: attackerCookie });
    if (attackerSession?.state !== "SessionForked") throw new Error();
  }
}

{
  console.info("# consume: state SessionActive with previous cookie (race condition)");

  /** @type {string} */ let cookie;
  /** @type {string} */ let prevCookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = session.cookie.value;
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, config, { cookie });
    if (session?.state !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = session.cookie.value;
  }
  {
    const session = await consume(db, config, { cookie: prevCookie });
    if (session?.state !== "SessionActive") throw new Error();
  }
  {
    const session = await consume(db, config, { cookie: cookie });
    if (session?.state !== "SessionActive") throw new Error();
  }
}

{
  console.info("# consume: state SessionActive with previous cookie after 2 rotations");

  /** @type {string} */ let cookie;
  /** @type {string} */ let prevCookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = session.cookie.value;
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, config, { cookie });
    if (session?.state !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = session.cookie.value;
  }
  {
    date = "2023-10-01T00:22:00Z";
    const session = await consume(db, config, { cookie });
    if (session?.state !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = session.cookie.value;
  }
  {
    const session = await consume(db, config, { cookie: prevCookie });
    if (session?.state !== "SessionActive") throw new Error();
  }
  {
    const session = await consume(db, config, { cookie: cookie });
    if (session?.state !== "SessionActive") throw new Error();
  }
}

{
  console.info("# consume: state SessionActive with previous cookie after 3 rotations");

  /** @type {string} */ let cookie;
  /** @type {string} */ let prevCookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = session.cookie.value;
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, config, { cookie });
    if (session?.state !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = session.cookie.value;
  }
  {
    date = "2023-10-01T00:22:00Z";
    const session = await consume(db, config, { cookie });
    if (session?.state !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = session.cookie.value;
  }
  {
    date = "2023-10-01T00:33:00Z";
    const session = await consume(db, config, { cookie });
    if (session?.state !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = session.cookie.value;
  }
  {
    const session = await consume(db, config, { cookie: prevCookie });
    if (session?.state !== "SessionActive") throw new Error();
  }
  {
    const session = await consume(db, config, { cookie: cookie });
    if (session?.state !== "SessionActive") throw new Error();
  }
}

{
  console.info("# consume: state SessionActive with previous cookie after 4 rotations");

  /** @type {string} */ let cookie;
  /** @type {string} */ let prevCookie;
  /** @type {string} */ let date;
  /** @type {Map<string, Session>} */ const db = new Map();
  const config = { ...testConfig, dateNow: () => new Date(date) };

  {
    date = "2023-10-01T00:00:00Z";
    const session = await login(db, { config });
    cookie = session.cookie.value;
  }
  {
    date = "2023-10-01T00:11:00Z";
    const session = await consume(db, config, { cookie });
    if (session?.state !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = session.cookie.value;
  }
  {
    date = "2023-10-01T00:22:00Z";
    const session = await consume(db, config, { cookie });
    if (session?.state !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = session.cookie.value;
  }
  {
    date = "2023-10-01T00:33:00Z";
    const session = await consume(db, config, { cookie });
    if (session?.state !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = session.cookie.value;
  }
  {
    date = "2023-10-01T00:44:00Z";
    const session = await consume(db, config, { cookie });
    if (session?.state !== "TokenRotated") throw new Error();
    prevCookie = cookie;
    cookie = session.cookie.value;
  }
  {
    const session = await consume(db, config, { cookie: prevCookie });
    if (session?.state !== "SessionActive") throw new Error();
  }
  {
    const session = await consume(db, config, { cookie: cookie });
    if (session?.state !== "SessionActive") throw new Error();
  }
}

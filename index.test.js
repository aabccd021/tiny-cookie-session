import * as lib from ".";

/**
 * @typedef {Object} Session
 * @property {string} oddTokenHash
 * @property {string} [evenTokenHash]
 * @property {Date} exp
 * @property {Date} tokenExp
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
    return;
  }

  if (action.type === "delete") {
    db.delete(action.idHash);
    return;
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
    return;
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
  if (data === undefined) return undefined;

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
    if (session !== undefined) throw new Error();
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
    if (session.data.exp.toISOString() !== "2023-10-01T05:00:00.000Z") throw new Error();
    if (session.data.tokenExp.toISOString() !== "2023-10-01T00:10:00.000Z") throw new Error();
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
    if (session.data.exp.toISOString() !== "2023-10-01T05:00:00.000Z") throw new Error();
    if (session.data.tokenExp.toISOString() !== "2023-10-01T00:10:00.000Z") throw new Error();
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
    if (session.data.exp.toISOString() !== "2023-10-01T05:11:00.000Z") throw new Error();
    if (session.data.tokenExp.toISOString() !== "2023-10-01T00:21:00.000Z") throw new Error();
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
    if (session.data.exp.toISOString() !== "2023-10-01T05:11:00.000Z") throw new Error();
    if (session.data.tokenExp.toISOString() !== "2023-10-01T00:21:00.000Z") throw new Error();
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
    if (session !== undefined) throw new Error();
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

//
// {
//   console.info("# consume: state TokenStolen, user, user, attacker");
//   const config = { ...testConfig, dateNow: () => ("2023-10-01T00:00:00Z") };
//
//
//   const userCookie = await login(db, {config   });
//   let userToken = userCookie.value;
//
//   const attackerToken = userToken;
//
//   date = ("2023-10-01T00:11:00Z");
//   let userSession = await consume(db, config, { credentials: userToken });
//   if (userSession.state !== "TokenRotated") throw new Error();
//   userToken = userSession.cookie.value;
//
//   date = ("2023-10-01T00:22:00Z");
//   userSession = await consume(db, config, { credentials: userToken });
//   if (userSession.state !== "TokenRotated") throw new Error();
//   userToken = userSession.cookie.value;
//
//   const attackerSession = await consume(db, config, { credentials: attackerToken });
//   if (attackerSession.state !== "TokenStolen") throw new Error();
//   if (attackerSession.exp.toISOString() !== "2023-10-01T05:22:00.000Z") throw new Error();
//   if (attackerSession.tokenExp.toISOString() !== "2023-10-01T00:32:00.000Z") throw new Error();
//   if (attackerSession.cookie.value !== "") throw new Error();
//   if (attackerSession.cookie.options.maxAge !== 0) throw new Error();
//
//   userSession = await consume(db, config, { credentials: userToken });
//   if (userSession.state !== "NotFound") throw new Error();
//   if (userSession.cookie.value !== "") throw new Error();
//   if (userSession.cookie.options.maxAge !== 0) throw new Error();
// }
//
// {
//   console.info("# consume: state TokenStolen, attacker, attacker, user");
//   const config = { ...testConfig, dateNow: () => ("2023-10-01T00:00:00Z") };
//
//
//   const userCookie = await login(db, {config   });
//   const userToken = userCookie.value;
//
//   let attackerToken = userToken;
//
//   date = ("2023-10-01T00:11:00Z");
//   let attackerSession = await consume(db, config, { credentials: attackerToken });
//   if (attackerSession.state !== "TokenRotated") throw new Error();
//   attackerToken = attackerSession.cookie.value;
//
//   date = ("2023-10-01T00:22:00Z");
//   attackerSession = await consume(db, config, { credentials: attackerToken });
//   if (attackerSession.state !== "TokenRotated") throw new Error();
//   attackerToken = attackerSession.cookie.value;
//
//   const userSession = await consume(db, config, { credentials: userToken });
//   if (userSession.state !== "TokenStolen") throw new Error();
//   if (userSession.exp.toISOString() !== "2023-10-01T05:22:00.000Z") throw new Error();
//   if (userSession.tokenExp.toISOString() !== "2023-10-01T00:32:00.000Z") throw new Error();
//   if (userSession.cookie.value !== "") throw new Error();
//   if (userSession.cookie.options.maxAge !== 0) throw new Error();
//
//   attackerSession = await consume(db, config, { credentials: userToken });
//   if (attackerSession.state !== "NotFound") throw new Error();
//   if (attackerSession.cookie.value !== "") throw new Error();
//   if (attackerSession.cookie.options.maxAge !== 0) throw new Error();
// }
//
// {
//   console.info("# consume: state TokenStolen, attacker, user, attacker, user");
//   const config = { ...testConfig, dateNow: () => ("2023-10-01T00:00:00Z") };
//
//
//   const userCookie = await login(db, {config   });
//   const userToken = userCookie.value;
//   let attackerToken = userToken;
//
//   date = ("2023-10-01T00:11:00Z");
//   let attackerSession = await consume(db, config, { credentials: attackerToken });
//   if (attackerSession.state !== "TokenRotated") throw new Error();
//   attackerToken = attackerSession.cookie.value;
//
//   date = ("2023-10-01T00:22:00Z");
//   let userSession = await consume(db, config, { credentials: userToken });
//   if (userSession.state !== "SessionActive") throw new Error();
//
//   attackerSession = await consume(db, config, { credentials: attackerToken });
//   if (attackerSession.state !== "TokenRotated") throw new Error();
//   attackerToken = attackerSession.cookie.value;
//
//   userSession = await consume(db, config, { credentials: userToken });
//   if (userSession.state !== "TokenStolen") throw new Error();
// }
//
// {
//   console.info("# consume: state TokenStolen, user, attacker, user, attacker");
//   const config = { ...testConfig, dateNow: () => ("2023-10-01T00:00:00Z") };
//
//
//   const userCookie = await login(db, {config   });
//   let userToken = userCookie.value;
//   const attackerToken = userToken;
//
//   date = ("2023-10-01T00:11:00Z");
//   let userSession = await consume(db, config, { credentials: userToken });
//   if (userSession.state !== "TokenRotated") throw new Error();
//   userToken = userSession.cookie.value;
//
//   date = ("2023-10-01T00:22:00Z");
//   let attackerSession = await consume(db, config, { credentials: attackerToken });
//   if (attackerSession.state !== "SessionActive") throw new Error();
//
//   userSession = await consume(db, config, { credentials: userToken });
//   if (userSession.state !== "TokenRotated") throw new Error();
//   userToken = userSession.cookie.value;
//
//   attackerSession = await consume(db, config, { credentials: attackerToken });
//   if (attackerSession.state !== "TokenStolen") throw new Error();
// }
//
// {
//   console.info("# consume: state SessionActive with second last credentials");
//
//   const config = { ...testConfig, dateNow: () => ("2023-10-01T00:00:00Z") };
//
//
//   let result = await login(db, {config   });
//   const prevToken = credentials;
// let session = db.get(credentials.idHash);
//
//
//   date = ("2023-10-01T00:11:00Z");
//
//   let session = await consume(db, config, { credentials: prevToken });
//   if (session?.state !== "TokenRotated") throw new Error();
//   credentials = session.cookie.value;
//
//   session = await consume(db, config, { credentials: prevToken });
//   if (session?.state !== "SessionActive") throw new Error();
// }
//
// {
//   console.info("# consume: state SessionActive on race condition");
//
//   const config = { ...testConfig, dateNow: () => ("2023-10-01T00:00:00Z") };
//
//
//   let result = await login(db, {config   });
//   const credentials = await lib.credentialsFromCookie({ cookie.value });
//  if (credentials === undefined) throw new Error();
//   const prevToken = credentials;
// let session = db.get(credentials.idHash);
//
//   const credentialsRotated = Promise.withResolvers();
//   const secondRequestFinished = Promise.withResolvers();
//
// let session = db.get(credentials.idHash);
//
//   date = ("2023-10-01T00:11:00Z");
//
//   await Promise.all([
//     (async () => {
//       const session = await consume(db, config, { cookie });
//
//       credentialsRotated.resolve(undefined);
//       await secondRequestFinished.promise;
//
//       // emulate set-credentials
//       if (result.state === "TokenRotated") {
//         credentials = session.cookie.value;
//       } else if (session?.state !== "SessionActive") {
//         throw new Error();
//       }
//     })(),
//
//     (async () => {
//       await lib.credentialsRotated.promise;
//
//       const session = await consume(db, config, { cookie });
//
//       // emulate set-credentials
//       if (result.state === "TokenRotated") {
//         credentials = session.cookie.value;
//       } else if (session?.state !== "SessionActive") {
//         throw new Error();
//       }
//
//       secondRequestFinished.resolve(undefined);
//     })(),
//   ]);
//
//   if (prevToken === credentials) throw new Error();
// }

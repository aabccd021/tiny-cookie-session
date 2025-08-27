import * as lib from ".";

/**
 * @typedef {Object} Session
 * @property {string} oddTokenHash
 * @property {string} [evenTokenHash]
 * @property {Date} exp
 * @property {Date} tokenExp
 * @property {boolean} isLatestTokenOdd
 */

/**
 * @returns {Map<string, Session>}
 */
function createDb() {
  return new Map();
}

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
 * @param {import("./index").LogoutArg} arg
 * @returns {Promise<import("./index").LogoutResult>}
 */
async function logout(db, arg) {
  const result = await lib.logout(arg);
  runAction(db, result.action);
  return result;
}

/**
 * @param {Map<string, Session>} db
 * @param {import("./index").ConsumeArg} arg
 * @returns {Promise<import("./index").ConsumeResult>}
 */
async function consume(db, arg) {
  const result = await lib.consume(arg);
  runAction(db, result.action);
  return result;
}

{
  console.info("# login");
  const config = { ...testConfig, dateNow: () => new Date("2023-10-01T00:00:00Z") };
  const db = createDb();

  // request 1
  const { cookie } = await login(db, { config });
  if (cookie.options.expires?.toISOString() !== "2023-10-01T05:00:00.000Z") throw new Error();

  // request 2
  const credentials = await lib.credentialsFromCookie({ cookie: cookie.value });
  if (credentials === undefined) throw new Error();
  const session = db.get(credentials.idHash);
  if (session?.exp.toISOString() !== "2023-10-01T05:00:00.000Z") throw new Error();
  if (session?.tokenExp.toISOString() !== "2023-10-01T00:10:00.000Z") throw new Error();
}

{
  console.info("# logout");
  let date = new Date("2023-10-01T00:00:00Z");
  const config = { ...testConfig, dateNow: () => date };
  const db = createDb();

  // request 1
  const { cookie } = await login(db, { config });
  const credentials = await lib.credentialsFromCookie({ cookie: cookie.value });
  if (credentials === undefined) throw new Error();

  // request 2
  date = new Date("2023-10-01T00:01:00Z");
  const logoutResult = await logout(db, { credentials });
  if (logoutResult.cookie.value !== "") throw new Error();
  if (logoutResult.cookie.options.maxAge !== 0) throw new Error();
  const session = db.get(credentials.idHash);
  if (session !== undefined) throw new Error();
}

{
  console.info("# consume: state SessionActive after login");
  const config = { ...testConfig, dateNow: () => new Date("2023-10-01T00:00:00Z") };
  const db = createDb();

  // request 1
  const { cookie } = await login(db, { config });

  // request 2
  const credentials = await lib.credentialsFromCookie({ cookie: cookie.value });
  if (credentials === undefined) throw new Error();
  const session = db.get(credentials.idHash);
  if (session === undefined) throw new Error();
  const result = await consume(db, { credentials, config, session });
  if (result.state !== "SessionActive") throw new Error();
  if (session.exp.toISOString() !== "2023-10-01T05:00:00.000Z") throw new Error();
  if (session.tokenExp.toISOString() !== "2023-10-01T00:10:00.000Z") throw new Error();
}

{
  console.info("# consume: state SessionActive after 9 minutes");
  let date = new Date("2023-10-01T00:00:00Z");
  const config = { ...testConfig, dateNow: () => date };
  const db = createDb();

  // request 1
  const { cookie } = await login(db, { config });

  // request 2
  date = new Date("2023-10-01T00:09:00Z");
  const credentials = await lib.credentialsFromCookie({ cookie: cookie.value });
  if (credentials === undefined) throw new Error();
  const session = db.get(credentials.idHash);
  if (session === undefined) throw new Error();
  const result = await consume(db, { credentials, config, session });
  if (result.state !== "SessionActive") throw new Error();
  if (session.exp.toISOString() !== "2023-10-01T05:00:00.000Z") throw new Error();
  if (session.tokenExp.toISOString() !== "2023-10-01T00:10:00.000Z") throw new Error();
}

{
  console.info("# consume: state TokenRotated after 11 minutes");
  let date = new Date("2023-10-01T00:00:00Z");
  const config = { ...testConfig, dateNow: () => date };
  const db = createDb();

  // request 1
  const { cookie } = await login(db, { config });

  // request 2
  date = new Date("2023-10-01T00:11:00Z");
  const credentials = await lib.credentialsFromCookie({ cookie: cookie.value });
  if (credentials === undefined) throw new Error();
  const session = db.get(credentials.idHash);
  if (session === undefined) throw new Error();
  const result = await consume(db, { credentials, config, session });
  if (result.state !== "TokenRotated") throw new Error();
  if (result.cookie.options.expires?.toISOString() !== "2023-10-01T05:11:00.000Z")
    throw new Error();
  if (session === undefined) throw new Error();
  if (session.exp.toISOString() !== "2023-10-01T05:11:00.000Z") throw new Error();
  if (session.tokenExp.toISOString() !== "2023-10-01T00:21:00.000Z") throw new Error();
}

{
  console.info("# consume: state SessionActive after TokenRotated");
  let date = new Date("2023-10-01T00:00:00Z");
  const config = { ...testConfig, dateNow: () => date };
  const db = createDb();

  // request 1
  let { cookie } = await login(db, { config });

  // request 2
  date = new Date("2023-10-01T00:11:00Z");
  let credentials = await lib.credentialsFromCookie({ cookie: cookie.value });
  if (credentials === undefined) throw new Error();
  const session = db.get(credentials.idHash);
  if (session === undefined) throw new Error();
  let result = await consume(db, { credentials, config, session });
  if (result.state !== "TokenRotated") throw new Error();
  cookie = result.cookie;

  // request 3
  credentials = await lib.credentialsFromCookie({ cookie: cookie.value });
  if (credentials === undefined) throw new Error();
  result = await consume(db, { credentials, config, session });
  if (result.state !== "SessionActive") throw new Error();
  if (session.exp.toISOString() !== "2023-10-01T05:11:00.000Z") throw new Error();
  if (session.tokenExp.toISOString() !== "2023-10-01T00:21:00.000Z") throw new Error();
}

{
  console.info("# consume: state Expired after 6 hours");
  let date = new Date("2023-10-01T00:00:00Z");
  const config = { ...testConfig, dateNow: () => date };
  const db = createDb();
  let cookie;

  {
    const result = await login(db, { config });
    cookie = result.cookie;
  }

  {
    date = new Date("2023-10-01T06:00:00Z");

    const credentials = await lib.credentialsFromCookie({ cookie: cookie.value });
    if (credentials === undefined) throw new Error();
    const session = db.get(credentials.idHash);

    if (session === undefined) throw new Error();
    const result = await consume(db, { credentials, config, session });

    if (result.state !== "SessionExpired") throw new Error();
    if (result.cookie.value !== "") throw new Error();
    if (result.cookie.options.maxAge !== 0) throw new Error();
  }

  {
    const credentials = await lib.credentialsFromCookie({ cookie: cookie.value });
    if (credentials === undefined) throw new Error();
    const session = db.get(credentials.idHash);
    if (session !== undefined) throw new Error();
  }
}

{
  console.info("# consume: state SessionActive after TokenRotated twice");
  let date = new Date("2023-10-01T00:00:00Z");
  const config = { ...testConfig, dateNow: () => date };
  const db = createDb();
  let cookie;

  {
    const result = await login(db, { config });
    cookie = result.cookie;
  }

  {
    date = new Date("2023-10-01T00:11:00Z");

    const credentials = await lib.credentialsFromCookie({ cookie: cookie.value });
    if (credentials === undefined) throw new Error();

    const session = db.get(credentials.idHash);
    if (session === undefined) throw new Error();

    const result = await consume(db, { credentials, config, session });
    if (result.state !== "TokenRotated") throw new Error();

    cookie = result.cookie;
  }

  {
    date = new Date("2023-10-01T00:22:00Z");

    const credentials = await lib.credentialsFromCookie({ cookie: cookie.value });
    if (credentials === undefined) throw new Error();

    const session = db.get(credentials.idHash);
    if (session === undefined) throw new Error();

    const result = await consume(db, { credentials, config, session });
    if (result.state !== "TokenRotated") throw new Error();

    cookie = result.cookie;
  }

  {
    const credentials = await lib.credentialsFromCookie({ cookie: cookie.value });
    if (credentials === undefined) throw new Error();

    const session = db.get(credentials.idHash);
    if (session === undefined) throw new Error();

    const result = await consume(db, { credentials, config, session });
    if (result.state !== "SessionActive") throw new Error();
  }
}

//
// {
//   console.info("# consume: state SessionActive after re-login");
//   const config = { ...testConfig, dateNow: () => new Date("2023-10-01T00:00:00Z") };
//   const db = createDb();
//
//   let loginResult = await login(db, {config   });
//   const credentials = await lib.credentialsFromCookie({ cookie: cookie.value });
//  if (credentials === undefined) throw new Error();
//
// let session = db.get(credentials.idHash);
// if (session === undefined) throw new Error();
//   date = new Date("2023-10-01T00:11:00Z");
//   cookie = await logout(db, config, { credentials });
//   credentials = cookie.value;
//
//   date = new Date("2023-10-01T00:14:00Z");
//   loginResult = await login(db, {config   });
//
//   const result = await consume(db, config, { credentials: cookie.value });
//   if (result.state !== "SessionActive") throw new Error();
// }
//
// {
//   console.info("# consume: state TokenStolen, user, user, attacker");
//   const config = { ...testConfig, dateNow: () => new Date("2023-10-01T00:00:00Z") };
//   const db = createDb();
//
//   const userCookie = await login(db, {config   });
//   let userToken = userCookie.value;
//
//   const attackerToken = userToken;
//
//   date = new Date("2023-10-01T00:11:00Z");
//   let userSession = await consume(db, config, { credentials: userToken });
//   if (userSession.state !== "TokenRotated") throw new Error();
//   userToken = userSession.cookie.value;
//
//   date = new Date("2023-10-01T00:22:00Z");
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
//   const config = { ...testConfig, dateNow: () => new Date("2023-10-01T00:00:00Z") };
//   const db = createDb();
//
//   const userCookie = await login(db, {config   });
//   const userToken = userCookie.value;
//
//   let attackerToken = userToken;
//
//   date = new Date("2023-10-01T00:11:00Z");
//   let attackerSession = await consume(db, config, { credentials: attackerToken });
//   if (attackerSession.state !== "TokenRotated") throw new Error();
//   attackerToken = attackerSession.cookie.value;
//
//   date = new Date("2023-10-01T00:22:00Z");
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
//   const config = { ...testConfig, dateNow: () => new Date("2023-10-01T00:00:00Z") };
//   const db = createDb();
//
//   const userCookie = await login(db, {config   });
//   const userToken = userCookie.value;
//   let attackerToken = userToken;
//
//   date = new Date("2023-10-01T00:11:00Z");
//   let attackerSession = await consume(db, config, { credentials: attackerToken });
//   if (attackerSession.state !== "TokenRotated") throw new Error();
//   attackerToken = attackerSession.cookie.value;
//
//   date = new Date("2023-10-01T00:22:00Z");
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
//   const config = { ...testConfig, dateNow: () => new Date("2023-10-01T00:00:00Z") };
//   const db = createDb();
//
//   const userCookie = await login(db, {config   });
//   let userToken = userCookie.value;
//   const attackerToken = userToken;
//
//   date = new Date("2023-10-01T00:11:00Z");
//   let userSession = await consume(db, config, { credentials: userToken });
//   if (userSession.state !== "TokenRotated") throw new Error();
//   userToken = userSession.cookie.value;
//
//   date = new Date("2023-10-01T00:22:00Z");
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
//   const config = { ...testConfig, dateNow: () => new Date("2023-10-01T00:00:00Z") };
//   const db = createDb();
//
//   let { cookie } = await login(db, {config   });
//   const credentials = await lib.credentialsFromCookie({ cookie: cookie.value });
//  if (credentials === undefined) throw new Error();
//   const prevToken = credentials;
// let session = db.get(credentials.idHash);
// if (session === undefined) throw new Error();
//
//   date = new Date("2023-10-01T00:11:00Z");
//
//   let result = await consume(db, config, { credentials: prevToken });
//   if (result.state !== "TokenRotated") throw new Error();
//   credentials = session.cookie.value;
//
//   result = await consume(db, config, { credentials: prevToken });
//   if (result.state !== "SessionActive") throw new Error();
// }
//
// {
//   console.info("# consume: state SessionActive on race condition");
//
//   const config = { ...testConfig, dateNow: () => new Date("2023-10-01T00:00:00Z") };
//   const db = createDb();
//
//   let { cookie } = await login(db, {config   });
//   const credentials = await lib.credentialsFromCookie({ cookie: cookie.value });
//  if (credentials === undefined) throw new Error();
//   const prevToken = credentials;
// let session = db.get(credentials.idHash);
// if (session === undefined) throw new Error();
//   const credentialsRotated = Promise.withResolvers();
//   const secondRequestFinished = Promise.withResolvers();
//
// let session = db.get(credentials.idHash);
// if (session === undefined) throw new Error();
//   date = new Date("2023-10-01T00:11:00Z");
//
//   await Promise.all([
//     (async () => {
//       const result = await consume(db, { credentials, config, session });
//
//       credentialsRotated.resolve(undefined);
//       await secondRequestFinished.promise;
//
//       // emulate set-credentials
//       if (result.state === "TokenRotated") {
//         credentials = session.cookie.value;
//       } else if (result.state !== "SessionActive") {
//         throw new Error();
//       }
//     })(),
//
//     (async () => {
//       await lib.credentialsRotated.promise;
//
//       const result = await consume(db, { credentials, config, session });
//
//       // emulate set-credentials
//       if (result.state === "TokenRotated") {
//         credentials = session.cookie.value;
//       } else if (result.state !== "SessionActive") {
//         throw new Error();
//       }
//
//       secondRequestFinished.resolve(undefined);
//     })(),
//   ]);
//
//   if (prevToken === credentials) throw new Error();
// }

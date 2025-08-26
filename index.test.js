import { consume, credentialsFromCookie, login, logout } from ".";

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
 * @param {Map<string, Session>} sessions
 * @param {import("./index").Action} [action]
 */
function runAction(sessions, action) {
  if (action === undefined) {
    return;
  }

  if (action.type === "insert") {
    sessions.set(action.idHash, {
      oddTokenHash: action.oddTokenHash,
      evenTokenHash: undefined,
      exp: action.exp,
      tokenExp: action.tokenExp,
      isLatestTokenOdd: true,
    });
    return;
  }

  if (action.type === "delete") {
    sessions.delete(action.idHash);
    return;
  }

  if (action.type === "update") {
    const session = sessions.get(action.idHash);
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

{
  console.info("# login");
  const config = { ...testConfig, dateNow: () => new Date("2023-10-01T00:00:00Z") };
  const sessions = createDb();

  const loginResult = await login({ config });
  if (loginResult.cookie.options.expires?.toISOString() !== "2023-10-01T05:00:00.000Z")
    throw new Error();
  runAction(sessions, loginResult.action);

  const credentials = await credentialsFromCookie({ cookie: loginResult.cookie.value });
  if (credentials === undefined) throw new Error();

  const session = sessions.get(credentials.idHash);
  if (session?.exp.toISOString() !== "2023-10-01T05:00:00.000Z") throw new Error();
  if (session?.tokenExp.toISOString() !== "2023-10-01T00:10:00.000Z") throw new Error();
}

{
  console.info("# logout");
  let date = new Date("2023-10-01T00:00:00Z");
  const config = { ...testConfig, dateNow: () => date };
  const sessions = createDb();

  const loginResult = await login({ config });
  runAction(sessions, loginResult.action);

  const credentials = await credentialsFromCookie({ cookie: loginResult.cookie.value });
  if (credentials === undefined) throw new Error();

  date = new Date("2023-10-01T00:01:00Z");
  const logoutResult = await logout({ credentials });
  runAction(sessions, logoutResult.action);

  if (logoutResult.cookie.value !== "") throw new Error();
  if (logoutResult.cookie.options.maxAge !== 0) throw new Error();
}

{
  console.info("# consume: state SessionActive after login");
  const config = { ...testConfig, dateNow: () => new Date("2023-10-01T00:00:00Z") };
  const sessions = createDb();

  const loginResult = await login({ config });
  runAction(sessions, loginResult.action);

  const credentials = await credentialsFromCookie({ cookie: loginResult.cookie.value });
  if (credentials === undefined) throw new Error();

  const session = sessions.get(credentials.idHash);
  if (session === undefined) throw new Error();

  const consumeResult = await consume({ credentials, config, session });
  runAction(sessions, consumeResult.action);
  if (consumeResult.state !== "SessionActive") throw new Error();

  if (session.exp.toISOString() !== "2023-10-01T05:00:00.000Z") throw new Error();
  if (session.tokenExp.toISOString() !== "2023-10-01T00:10:00.000Z") throw new Error();
}

{
  console.info("# consume: state SessionActive after 9 minutes");
  let date = new Date("2023-10-01T00:00:00Z");
  const config = { ...testConfig, dateNow: () => date };
  const sessions = createDb();

  const loginResult = await login({ config });
  runAction(sessions, loginResult.action);

  const credentials = await credentialsFromCookie({ cookie: loginResult.cookie.value });
  if (credentials === undefined) throw new Error();

  const session = sessions.get(credentials.idHash);
  if (session === undefined) throw new Error();

  date = new Date("2023-10-01T00:09:00Z");
  const consumeResult = await consume({ credentials, config, session });
  runAction(sessions, consumeResult.action);

  if (consumeResult.state !== "SessionActive") throw new Error();

  if (session.exp.toISOString() !== "2023-10-01T05:00:00.000Z") throw new Error();
  if (session.tokenExp.toISOString() !== "2023-10-01T00:10:00.000Z") throw new Error();
}

{
  console.info("# consume: state TokenRotated after 11 minutes");
  let date = new Date("2023-10-01T00:00:00Z");
  const config = { ...testConfig, dateNow: () => date };
  const sessions = createDb();

  const loginResult = await login({ config });
  runAction(sessions, loginResult.action);

  const credentials = await credentialsFromCookie({ cookie: loginResult.cookie.value });
  if (credentials === undefined) throw new Error();

  const session = sessions.get(credentials.idHash);
  if (session === undefined) throw new Error();

  date = new Date("2023-10-01T00:11:00Z");
  const consumeResult = await consume({ credentials, config, session });
  if (consumeResult.state !== "TokenRotated") throw new Error();
  if (consumeResult.cookie.options.expires?.toISOString() !== "2023-10-01T05:11:00.000Z")
    throw new Error();

  runAction(sessions, consumeResult.action);
  if (session === undefined) throw new Error();
  if (session.exp.toISOString() !== "2023-10-01T05:11:00.000Z") throw new Error();
  if (session.tokenExp.toISOString() !== "2023-10-01T00:21:00.000Z") throw new Error();
}

{
  console.info("# consume: state SessionActive after TokenRotated");
  let date = new Date("2023-10-01T00:00:00Z");
  const config = { ...testConfig, dateNow: () => date };
  const sessions = createDb();

  const loginResult = await login({ config });
  runAction(sessions, loginResult.action);

  let credentials = await credentialsFromCookie({ cookie: loginResult.cookie.value });
  if (credentials === undefined) throw new Error();

  const session = sessions.get(credentials.idHash);
  if (session === undefined) throw new Error();

  date = new Date("2023-10-01T00:11:00Z");
  let consumeResult = await consume({ credentials, config, session });
  runAction(sessions, consumeResult.action);

  if (consumeResult.state !== "TokenRotated") throw new Error();

  credentials = await credentialsFromCookie({ cookie: consumeResult.cookie.value });
  if (credentials === undefined) throw new Error();

  consumeResult = await consume({ credentials, config, session });
  if (consumeResult.state !== "SessionActive") throw new Error();

  runAction(sessions, consumeResult.action);
  if (session.exp.toISOString() !== "2023-10-01T05:11:00.000Z") throw new Error();
  if (session.tokenExp.toISOString() !== "2023-10-01T00:21:00.000Z") throw new Error();
}
//
// {
//   console.info("# consume: state Expired after 6 hours");
//   const config = { ...testConfig, dateNow: () => new Date("2023-10-01T00:00:00Z") };
//   const sessions = createDb();
//
//   const loginResult = login({ config   });
//   const credentials = cookie.value;
//
//   date = new Date("2023-10-01T06:00:00Z");
//   const consumeResult = await consume({ credentials, config, session });
//   if (consumeResult.state !== "Expired") throw new Error();
//
//   if (session.exp.toISOString() !== "2023-10-01T05:00:00.000Z") throw new Error();
//   if (session.tokenExp.toISOString() !== "2023-10-01T00:10:00.000Z") throw new Error();
//   if (session.cookie.value !== "") throw new Error();
//   if (session.cookie.options.maxAge !== 0) throw new Error();
// }
//
// {
//   console.info("# consume: state NotFound after Expired");
//   const config = { ...testConfig, dateNow: () => new Date("2023-10-01T00:00:00Z") };
//   const sessions = createDb();
//
//   const loginResult = login({ config   });
//   const credentials = cookie.value;
//
//   date = new Date("2023-10-01T06:00:00Z");
//   let consumeResult = await consume({ credentials, config, session });
//   if (consumeResult.state !== "Expired") throw new Error();
//
//   session = await consume({ credentials, config, session });
//   if (consumeResult.state !== "NotFound") throw new Error();
//
//   if (session.cookie.value !== "") throw new Error();
//   if (session.cookie.options.maxAge !== 0) throw new Error();
// }
//
// {
//   console.info("# consume: state SessionActive after TokenRotated twice");
//   const config = { ...testConfig, dateNow: () => new Date("2023-10-01T00:00:00Z") };
//   const sessions = createDb();
//
//   const loginResult = login({ config   });
//   let credentials = cookie.value;
//
//   date = new Date("2023-10-01T00:11:00Z");
//   let consumeResult = await consume({ credentials, config, session });
//   if (consumeResult.state !== "TokenRotated") throw new Error();
//   credentials = session.cookie.value;
//
//   date = new Date("2023-10-01T00:22:00Z");
//   session = await consume({ credentials, config, session });
//   if (consumeResult.state !== "TokenRotated") throw new Error();
//   credentials = session.cookie.value;
//
//   session = await consume({ credentials, config, session });
//   if (consumeResult.state !== "SessionActive") throw new Error();
// }
//
// {
//   console.info("# consume: state NotFound after logout");
//   const config = { ...testConfig, dateNow: () => new Date("2023-10-01T00:00:00Z") };
//   const sessions = createDb();
//
//   let loginResult = login({ config   });
//   let credentials = cookie.value;
//
//   date = new Date("2023-10-01T00:11:00Z");
//   cookie = await logout(config, { credentials });
//   credentials = cookie.value;
//
//   const consumeResult = await consume({ credentials, config, session });
//   if (consumeResult.state !== "NotFound") throw new Error();
//
//   if (session.cookie.value !== "") throw new Error();
//   if (session.cookie.options.maxAge !== 0) throw new Error();
// }
//
// {
//   console.info("# consume: state SessionActive after re-login");
//   const config = { ...testConfig, dateNow: () => new Date("2023-10-01T00:00:00Z") };
//   const sessions = createDb();
//
//   let loginResult = login({ config   });
//   let credentials = cookie.value;
//
//   date = new Date("2023-10-01T00:11:00Z");
//   cookie = await logout(config, { credentials });
//   credentials = cookie.value;
//
//   date = new Date("2023-10-01T00:14:00Z");
//   loginResult = login({ config   });
//
//   const consumeResult = await consume(config, { credentials: cookie.value });
//   if (consumeResult.state !== "SessionActive") throw new Error();
// }
//
// {
//   console.info("# consume: state TokenStolen, user, user, attacker");
//   const config = { ...testConfig, dateNow: () => new Date("2023-10-01T00:00:00Z") };
//   const sessions = createDb();
//
//   const userCookie = login({ config   });
//   let userToken = userCookie.value;
//
//   const attackerToken = userToken;
//
//   date = new Date("2023-10-01T00:11:00Z");
//   let userSession = await consume(config, { credentials: userToken });
//   if (userSession.state !== "TokenRotated") throw new Error();
//   userToken = userSession.cookie.value;
//
//   date = new Date("2023-10-01T00:22:00Z");
//   userSession = await consume(config, { credentials: userToken });
//   if (userSession.state !== "TokenRotated") throw new Error();
//   userToken = userSession.cookie.value;
//
//   const attackerSession = await consume(config, { credentials: attackerToken });
//   if (attackerSession.state !== "TokenStolen") throw new Error();
//   if (attackerSession.exp.toISOString() !== "2023-10-01T05:22:00.000Z") throw new Error();
//   if (attackerSession.tokenExp.toISOString() !== "2023-10-01T00:32:00.000Z") throw new Error();
//   if (attackerSession.cookie.value !== "") throw new Error();
//   if (attackerSession.cookie.options.maxAge !== 0) throw new Error();
//
//   userSession = await consume(config, { credentials: userToken });
//   if (userSession.state !== "NotFound") throw new Error();
//   if (userSession.cookie.value !== "") throw new Error();
//   if (userSession.cookie.options.maxAge !== 0) throw new Error();
// }
//
// {
//   console.info("# consume: state TokenStolen, attacker, attacker, user");
//   const config = { ...testConfig, dateNow: () => new Date("2023-10-01T00:00:00Z") };
//   const sessions = createDb();
//
//   const userCookie = login({ config   });
//   const userToken = userCookie.value;
//
//   let attackerToken = userToken;
//
//   date = new Date("2023-10-01T00:11:00Z");
//   let attackerSession = await consume(config, { credentials: attackerToken });
//   if (attackerSession.state !== "TokenRotated") throw new Error();
//   attackerToken = attackerSession.cookie.value;
//
//   date = new Date("2023-10-01T00:22:00Z");
//   attackerSession = await consume(config, { credentials: attackerToken });
//   if (attackerSession.state !== "TokenRotated") throw new Error();
//   attackerToken = attackerSession.cookie.value;
//
//   const userSession = await consume(config, { credentials: userToken });
//   if (userSession.state !== "TokenStolen") throw new Error();
//   if (userSession.exp.toISOString() !== "2023-10-01T05:22:00.000Z") throw new Error();
//   if (userSession.tokenExp.toISOString() !== "2023-10-01T00:32:00.000Z") throw new Error();
//   if (userSession.cookie.value !== "") throw new Error();
//   if (userSession.cookie.options.maxAge !== 0) throw new Error();
//
//   attackerSession = await consume(config, { credentials: userToken });
//   if (attackerSession.state !== "NotFound") throw new Error();
//   if (attackerSession.cookie.value !== "") throw new Error();
//   if (attackerSession.cookie.options.maxAge !== 0) throw new Error();
// }
//
// {
//   console.info("# consume: state TokenStolen, attacker, user, attacker, user");
//   const config = { ...testConfig, dateNow: () => new Date("2023-10-01T00:00:00Z") };
//   const sessions = createDb();
//
//   const userCookie = login({ config   });
//   const userToken = userCookie.value;
//   let attackerToken = userToken;
//
//   date = new Date("2023-10-01T00:11:00Z");
//   let attackerSession = await consume(config, { credentials: attackerToken });
//   if (attackerSession.state !== "TokenRotated") throw new Error();
//   attackerToken = attackerSession.cookie.value;
//
//   date = new Date("2023-10-01T00:22:00Z");
//   let userSession = await consume(config, { credentials: userToken });
//   if (userSession.state !== "SessionActive") throw new Error();
//
//   attackerSession = await consume(config, { credentials: attackerToken });
//   if (attackerSession.state !== "TokenRotated") throw new Error();
//   attackerToken = attackerSession.cookie.value;
//
//   userSession = await consume(config, { credentials: userToken });
//   if (userSession.state !== "TokenStolen") throw new Error();
// }
//
// {
//   console.info("# consume: state TokenStolen, user, attacker, user, attacker");
//   const config = { ...testConfig, dateNow: () => new Date("2023-10-01T00:00:00Z") };
//   const sessions = createDb();
//
//   const userCookie = login({ config   });
//   let userToken = userCookie.value;
//   const attackerToken = userToken;
//
//   date = new Date("2023-10-01T00:11:00Z");
//   let userSession = await consume(config, { credentials: userToken });
//   if (userSession.state !== "TokenRotated") throw new Error();
//   userToken = userSession.cookie.value;
//
//   date = new Date("2023-10-01T00:22:00Z");
//   let attackerSession = await consume(config, { credentials: attackerToken });
//   if (attackerSession.state !== "SessionActive") throw new Error();
//
//   userSession = await consume(config, { credentials: userToken });
//   if (userSession.state !== "TokenRotated") throw new Error();
//   userToken = userSession.cookie.value;
//
//   attackerSession = await consume(config, { credentials: attackerToken });
//   if (attackerSession.state !== "TokenStolen") throw new Error();
// }
//
// {
//   console.info("# consume: state SessionActive with second last credentials");
//
//   const config = { ...testConfig, dateNow: () => new Date("2023-10-01T00:00:00Z") };
//   const sessions = createDb();
//
//   const loginResult = login({ config   });
//   let credentials = cookie.value;
//   const prevToken = credentials;
//
//   date = new Date("2023-10-01T00:11:00Z");
//
//   let consumeResult = await consume(config, { credentials: prevToken });
//   if (consumeResult.state !== "TokenRotated") throw new Error();
//   credentials = session.cookie.value;
//
//   session = await consume(config, { credentials: prevToken });
//   if (consumeResult.state !== "SessionActive") throw new Error();
// }
//
// {
//   console.info("# consume: state SessionActive on race condition");
//
//   const config = { ...testConfig, dateNow: () => new Date("2023-10-01T00:00:00Z") };
//   const sessions = createDb();
//
//   const loginResult = login({ config   });
//   let credentials = cookie.value;
//   const prevToken = credentials;
//   const credentialsRotated = Promise.withResolvers();
//   const secondRequestFinished = Promise.withResolvers();
//
//   date = new Date("2023-10-01T00:11:00Z");
//
//   await Promise.all([
//     (async () => {
//       const consumeResult = await consume({ credentials, config, session });
//
//       credentialsRotated.resolve(undefined);
//       await secondRequestFinished.promise;
//
//       // emulate set-credentials
//       if (consumeResult.state === "TokenRotated") {
//         credentials = session.cookie.value;
//       } else if (consumeResult.state !== "SessionActive") {
//         throw new Error();
//       }
//     })(),
//
//     (async () => {
//       await credentialsRotated.promise;
//
//       const consumeResult = await consume({ credentials, config, session });
//
//       // emulate set-credentials
//       if (consumeResult.state === "TokenRotated") {
//         credentials = session.cookie.value;
//       } else if (consumeResult.state !== "SessionActive") {
//         throw new Error();
//       }
//
//       secondRequestFinished.resolve(undefined);
//     })(),
//   ]);
//
//   if (prevToken === credentials) throw new Error();
// }

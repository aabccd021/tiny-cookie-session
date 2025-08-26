import { credentialsFromCookie, login, logout } from ".";

/**
 * @typedef {Object} Session
 * @property {string} oddTokenHash
 * @property {string} [evenTokenHash]
 * @property {Date} exp
 * @property {Date} tokenExp
 * @property {boolean} isLatestTokenOdd
 */

/** @type {Map<string, Session>} */
const sessionMap = new Map();

const testConfig = {
  tokenExpiresIn: 10 * 60 * 1000,
  sessionExpiresIn: 5 * 60 * 60 * 1000,
};

/**
 * @param {import("./index").Action} action
 * @param {Map<string, Session>} sessions
 */
function handleAction(action, sessions) {
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

  const loginResult = await login({ config });
  handleAction(loginResult.action, sessionMap);

  if (loginResult.cookie.options.expires?.toISOString() !== "2023-10-01T05:00:00.000Z")
    throw new Error();
  if (loginResult.cookie.value.length !== 129) throw new Error();
  if (loginResult.cookie.value.at(64) !== ":") throw new Error();
  if (!/^[a-zA-Z0-9:]*$/.test(loginResult.cookie.value)) throw new Error();
}

{
  console.info("# logout");
  let date = new Date("2023-10-01T00:00:00Z");
  const config = { ...testConfig, dateNow: () => date };

  const loginResult = await login({ config });
  handleAction(loginResult.action, sessionMap);

  const credentials = await credentialsFromCookie({ cookie: loginResult.cookie.value });
  if (credentials === undefined) throw new Error();

  date = new Date("2023-10-01T00:01:00Z");
  const logoutResult = await logout({ credentials });
  handleAction(logoutResult.action, sessionMap);

  if (logoutResult.cookie.value !== "") throw new Error();
  if (logoutResult.cookie.options.maxAge !== 0) throw new Error();
}

//
// {
//   console.info("# consume: state NotFound for unknown credentials");
//   const config = createConfig();
//
//   const session = await consume(config, { credentials: "unknown-credentials" });
//   if (session.state !== "NotFound") throw new Error();
//
//   if (session.cookie.value !== "") throw new Error();
//   if (session.cookie.options.maxAge !== 0) throw new Error();
// }
//
// {
//   console.info("# consume: state Active after login");
//   const state = { date: new Date("2023-10-01T00:00:00Z") };
//   const config = createConfig(state);
//
//   const cookie = await login(config, {
//     id: "test-session-id",
//     data: { userId: "test-user-id" },
//   });
//   const credentials = cookie.value;
//
//   const session = await consume(config, { credentials });
//   if (session.state !== "Active") throw new Error();
//
//   if (session.id !== "test-session-id") throw new Error();
//   if (session.exp.toISOString() !== "2023-10-01T05:00:00.000Z") throw new Error();
//   if (session.tokenExp.toISOString() !== "2023-10-01T00:10:00.000Z") throw new Error();
//   if (session.data.userId !== "test-user-id") throw new Error();
// }
//
// {
//   console.info("# consume: state Active after 9 minutes");
//   const state = { date: new Date("2023-10-01T00:00:00Z") };
//   const config = createConfig(state);
//
//   const cookie = await login(config, {
//     id: "test-session-id",
//     data: { userId: "test-user-id" },
//   });
//   const credentials = cookie.value;
//
//   state.date = new Date("2023-10-01T00:09:00Z");
//   const session = await consume(config, { credentials });
//   if (session.state !== "Active") throw new Error();
//
//   if (session.id !== "test-session-id") throw new Error();
//   if (session.exp.toISOString() !== "2023-10-01T05:00:00.000Z") throw new Error();
//   if (session.tokenExp.toISOString() !== "2023-10-01T00:10:00.000Z") throw new Error();
//   if (session.data.userId !== "test-user-id") throw new Error();
// }
//
// {
//   console.info("# consume: state TokenRotated after 11 minutes");
//   const state = { date: new Date("2023-10-01T00:00:00Z") };
//   const config = createConfig(state);
//
//   const cookie = await login(config, {
//     id: "test-session-id",
//     data: { userId: "test-user-id" },
//   });
//   let credentials = cookie.value;
//
//   state.date = new Date("2023-10-01T00:11:00Z");
//   const session = await consume(config, { credentials });
//
//   if (session.state !== "TokenRotated") throw new Error();
//
//   credentials = session.cookie.value;
//
//   if (session.id !== "test-session-id") throw new Error();
//   if (session.exp.toISOString() !== "2023-10-01T05:11:00.000Z") throw new Error();
//   if (session.tokenExp.toISOString() !== "2023-10-01T00:21:00.000Z") throw new Error();
//   if (session.data.userId !== "test-user-id") throw new Error();
//   if (credentials.length !== 64) throw new Error();
//   if (/^[a-zA-Z0-9]*$/.test(credentials) !== true) throw new Error();
//   if (session.cookie.options.expires?.toISOString() !== "2023-10-01T05:11:00.000Z")
//     throw new Error();
// }
//
// {
//   console.info("# consume: state Active after TokenRotated");
//   const state = { date: new Date("2023-10-01T00:00:00Z") };
//   const config = createConfig(state);
//
//   const cookie = await login(config, {
//     id: "test-session-id",
//     data: { userId: "test-user-id" },
//   });
//   let credentials = cookie.value;
//
//   state.date = new Date("2023-10-01T00:11:00Z");
//   let session = await consume(config, { credentials });
//   if (session.state !== "TokenRotated") throw new Error();
//
//   credentials = session.cookie.value;
//
//   session = await consume(config, { credentials });
//   if (session.state !== "Active") throw new Error();
//
//   if (session.id !== "test-session-id") throw new Error();
//   if (session.data.userId !== "test-user-id") throw new Error();
//   if (session.exp.toISOString() !== "2023-10-01T05:11:00.000Z") throw new Error();
//   if (session.tokenExp.toISOString() !== "2023-10-01T00:21:00.000Z") throw new Error();
// }
//
// {
//   console.info("# consume: state Expired after 6 hours");
//   const state = { date: new Date("2023-10-01T00:00:00Z") };
//   const config = createConfig(state);
//
//   const cookie = await login(config, {
//     id: "test-session-id",
//     data: { userId: "test-user-id" },
//   });
//   const credentials = cookie.value;
//
//   state.date = new Date("2023-10-01T06:00:00Z");
//   const session = await consume(config, { credentials });
//   if (session.state !== "Expired") throw new Error();
//
//   if (session.id !== "test-session-id") throw new Error();
//   if (session.data.userId !== "test-user-id") throw new Error();
//   if (session.exp.toISOString() !== "2023-10-01T05:00:00.000Z") throw new Error();
//   if (session.tokenExp.toISOString() !== "2023-10-01T00:10:00.000Z") throw new Error();
//   if (session.cookie.value !== "") throw new Error();
//   if (session.cookie.options.maxAge !== 0) throw new Error();
// }
//
// {
//   console.info("# consume: state NotFound after Expired");
//   const state = { date: new Date("2023-10-01T00:00:00Z") };
//   const config = createConfig(state);
//
//   const cookie = await login(config, {
//     id: "test-session-id",
//     data: { userId: "test-user-id" },
//   });
//   const credentials = cookie.value;
//
//   state.date = new Date("2023-10-01T06:00:00Z");
//   let session = await consume(config, { credentials });
//   if (session.state !== "Expired") throw new Error();
//
//   session = await consume(config, { credentials });
//   if (session.state !== "NotFound") throw new Error();
//
//   if (session.cookie.value !== "") throw new Error();
//   if (session.cookie.options.maxAge !== 0) throw new Error();
// }
//
// {
//   console.info("# consume: state Active after TokenRotated twice");
//   const state = { date: new Date("2023-10-01T00:00:00Z") };
//   const config = createConfig(state);
//
//   const cookie = await login(config, {
//     id: "test-session-id",
//     data: { userId: "test-user-id" },
//   });
//   let credentials = cookie.value;
//
//   state.date = new Date("2023-10-01T00:11:00Z");
//   let session = await consume(config, { credentials });
//   if (session.state !== "TokenRotated") throw new Error();
//   credentials = session.cookie.value;
//
//   state.date = new Date("2023-10-01T00:22:00Z");
//   session = await consume(config, { credentials });
//   if (session.state !== "TokenRotated") throw new Error();
//   credentials = session.cookie.value;
//
//   session = await consume(config, { credentials });
//   if (session.state !== "Active") throw new Error();
// }
//
// {
//   console.info("# consume: state NotFound after logout");
//   const state = { date: new Date("2023-10-01T00:00:00Z") };
//   const config = createConfig(state);
//
//   let cookie = await login(config, {
//     id: "test-session-id",
//     data: { userId: "test-user-id" },
//   });
//   let credentials = cookie.value;
//
//   state.date = new Date("2023-10-01T00:11:00Z");
//   cookie = await logout(config, { credentials });
//   credentials = cookie.value;
//
//   const session = await consume(config, { credentials });
//   if (session.state !== "NotFound") throw new Error();
//
//   if (session.cookie.value !== "") throw new Error();
//   if (session.cookie.options.maxAge !== 0) throw new Error();
// }
//
// {
//   console.info("# consume: state Active after re-login");
//   const state = { date: new Date("2023-10-01T00:00:00Z") };
//   const config = createConfig(state);
//
//   let cookie = await login(config, {
//     id: "test-session-id",
//     data: { userId: "test-user-id" },
//   });
//   let credentials = cookie.value;
//
//   state.date = new Date("2023-10-01T00:11:00Z");
//   cookie = await logout(config, { credentials });
//   credentials = cookie.value;
//
//   state.date = new Date("2023-10-01T00:14:00Z");
//   cookie = await login(config, {
//     id: "test-session-id",
//     data: { userId: "test-user-id" },
//   });
//
//   const session = await consume(config, { credentials: cookie.value });
//   if (session.state !== "Active") throw new Error();
// }
//
// {
//   console.info("# consume: state TokenStolen, user, user, attacker");
//   const state = { date: new Date("2023-10-01T00:00:00Z") };
//   const config = createConfig(state);
//
//   const userCookie = await login(config, {
//     id: "test-session-id",
//     data: { userId: "test-user-id" },
//   });
//   let userToken = userCookie.value;
//
//   const attackerToken = userToken;
//
//   state.date = new Date("2023-10-01T00:11:00Z");
//   let userSession = await consume(config, { credentials: userToken });
//   if (userSession.state !== "TokenRotated") throw new Error();
//   userToken = userSession.cookie.value;
//
//   state.date = new Date("2023-10-01T00:22:00Z");
//   userSession = await consume(config, { credentials: userToken });
//   if (userSession.state !== "TokenRotated") throw new Error();
//   userToken = userSession.cookie.value;
//
//   const attackerSession = await consume(config, { credentials: attackerToken });
//   if (attackerSession.state !== "TokenStolen") throw new Error();
//   if (attackerSession.id !== "test-session-id") throw new Error();
//   if (attackerSession.data.userId !== "test-user-id") throw new Error();
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
//   const state = { date: new Date("2023-10-01T00:00:00Z") };
//   const config = createConfig(state);
//
//   const userCookie = await login(config, {
//     id: "test-session-id",
//     data: { userId: "test-user-id" },
//   });
//   const userToken = userCookie.value;
//
//   let attackerToken = userToken;
//
//   state.date = new Date("2023-10-01T00:11:00Z");
//   let attackerSession = await consume(config, { credentials: attackerToken });
//   if (attackerSession.state !== "TokenRotated") throw new Error();
//   attackerToken = attackerSession.cookie.value;
//
//   state.date = new Date("2023-10-01T00:22:00Z");
//   attackerSession = await consume(config, { credentials: attackerToken });
//   if (attackerSession.state !== "TokenRotated") throw new Error();
//   attackerToken = attackerSession.cookie.value;
//
//   const userSession = await consume(config, { credentials: userToken });
//   if (userSession.state !== "TokenStolen") throw new Error();
//   if (userSession.id !== "test-session-id") throw new Error();
//   if (userSession.data.userId !== "test-user-id") throw new Error();
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
//   const state = { date: new Date("2023-10-01T00:00:00Z") };
//   const config = createConfig(state);
//
//   const userCookie = await login(config, {
//     id: "test-session-id",
//     data: { userId: "test-user-id" },
//   });
//   const userToken = userCookie.value;
//   let attackerToken = userToken;
//
//   state.date = new Date("2023-10-01T00:11:00Z");
//   let attackerSession = await consume(config, { credentials: attackerToken });
//   if (attackerSession.state !== "TokenRotated") throw new Error();
//   attackerToken = attackerSession.cookie.value;
//
//   state.date = new Date("2023-10-01T00:22:00Z");
//   let userSession = await consume(config, { credentials: userToken });
//   if (userSession.state !== "Active") throw new Error();
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
//   const state = { date: new Date("2023-10-01T00:00:00Z") };
//   const config = createConfig(state);
//
//   const userCookie = await login(config, {
//     id: "test-session-id",
//     data: { userId: "test-user-id" },
//   });
//   let userToken = userCookie.value;
//   const attackerToken = userToken;
//
//   state.date = new Date("2023-10-01T00:11:00Z");
//   let userSession = await consume(config, { credentials: userToken });
//   if (userSession.state !== "TokenRotated") throw new Error();
//   userToken = userSession.cookie.value;
//
//   state.date = new Date("2023-10-01T00:22:00Z");
//   let attackerSession = await consume(config, { credentials: attackerToken });
//   if (attackerSession.state !== "Active") throw new Error();
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
//   console.info("# consume: state Active with second last credentials");
//
//   const state = { date: new Date("2023-10-01T00:00:00Z") };
//   const config = createConfig(state);
//
//   const cookie = await login(config, {
//     id: "test-session-id",
//     data: { userId: "test-user-id" },
//   });
//   let credentials = cookie.value;
//   const prevToken = credentials;
//
//   state.date = new Date("2023-10-01T00:11:00Z");
//
//   let session = await consume(config, { credentials: prevToken });
//   if (session.state !== "TokenRotated") throw new Error();
//   credentials = session.cookie.value;
//
//   session = await consume(config, { credentials: prevToken });
//   if (session.state !== "Active") throw new Error();
// }
//
// {
//   console.info("# consume: state Active on race condition");
//
//   const state = { date: new Date("2023-10-01T00:00:00Z") };
//   const config = createConfig(state);
//
//   const cookie = await login(config, {
//     id: "test-session-id",
//     data: { userId: "test-user-id" },
//   });
//   let credentials = cookie.value;
//   const prevToken = credentials;
//   const credentialsRotated = Promise.withResolvers();
//   const secondRequestFinished = Promise.withResolvers();
//
//   state.date = new Date("2023-10-01T00:11:00Z");
//
//   await Promise.all([
//     (async () => {
//       const session = await consume(config, { credentials });
//
//       credentialsRotated.resolve(undefined);
//       await secondRequestFinished.promise;
//
//       // emulate set-credentials
//       if (session.state === "TokenRotated") {
//         credentials = session.cookie.value;
//       } else if (session.state !== "Active") {
//         throw new Error();
//       }
//     })(),
//
//     (async () => {
//       await credentialsRotated.promise;
//
//       const session = await consume(config, { credentials });
//
//       // emulate set-credentials
//       if (session.state === "TokenRotated") {
//         credentials = session.cookie.value;
//       } else if (session.state !== "Active") {
//         throw new Error();
//       }
//
//       secondRequestFinished.resolve(undefined);
//     })(),
//   ]);
//
//   if (prevToken === credentials) throw new Error();
// }

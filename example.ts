import * as lib from "./index.js";

type DBRow = {
  oddTokenHash: string;
  evenTokenHash: string | undefined;
  exp: Date;
  tokenExp: Date;
  isLatestTokenOdd: boolean;
};

function runAction(db: Map<string, DBRow>, action: lib.Action | undefined) {
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

async function login(db: Map<string, DBRow>, arg?: lib.LoginArg) {
  const result = await lib.login(arg);
  runAction(db, result.action);

  return result;
}

async function logout(db: Map<string, DBRow>, arg: lib.CredentialFromCookieArg) {
  const credential = await lib.credentialFromCookie(arg);
  if (credential.data === undefined) {
    return { cookie: credential.cookie, action: undefined };
  }

  const result = await lib.logout({ credentialData: credential.data });
  runAction(db, result.action);

  return result;
}

async function consume(
  db: Map<string, DBRow>,
  arg: lib.CredentialFromCookieArg,
  config?: lib.Config,
) {
  const credential = await lib.credentialFromCookie(arg);
  if (credential.data === undefined) {
    return { state: "MalformedCookie", data: undefined, cookie: credential.cookie };
  }

  const data = db.get(credential.data.idHash);

  const session = data !== undefined ? { found: true as const, data } : { found: false as const };

  const result = await lib.consume({ credentialData: credential.data, config, session });
  runAction(db, result.action);

  if (result.state === "SessionActive") {
    return { state: result.state, data, cookie: result.cookie };
  }

  if (result.state === "TokenRotated") {
    return { state: result.state, data, cookie: result.cookie };
  }

  if (result.state === "SessionNotFound") {
    return { state: result.state, data: undefined, cookie: result.cookie };
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
  // Example usage

  const db = new Map<string, DBRow>();
  let cookie: string | undefined;

  {
    const session = await login(db);
    cookie = session.cookie.value;
  }
  {
    const session = await consume(db, { cookie });
    console.assert(session?.state === "SessionActive", "Expected SessionActive");
    if (session.cookie !== undefined) {
      cookie = session.cookie.value;
    }
  }
  {
    const session = await logout(db, { cookie });
    console.assert(session.cookie.value === "", "Expected empty cookie after logout");
    console.assert(session.cookie.options.maxAge === 0, "Expected maxAge 0 after logout");
    cookie = session.cookie.value;
  }
  {
    const session = await consume(db, { cookie });
    console.log({ session, cookie });
    console.assert(session?.state === "SessionNotFound", "Expected SessionNotFound after logout");
  }
}

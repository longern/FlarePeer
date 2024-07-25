const cachedValues = {};

async function getFromCache(key, fetcher) {
  if (cachedValues[key]) return cachedValues[key];
  const value = await fetcher();
  cachedValues[key] = value;
  return value;
}

async function generateToken(secretKey, peerId) {
  const encodedKey = new TextEncoder().encode(secretKey);
  const key = await crypto.subtle.importKey(
    "raw",
    encodedKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const encodedPeerId = new TextEncoder().encode(peerId);
  const signature = await crypto.subtle.sign("HMAC", key, encodedPeerId);
  const signatureBase64 = btoa(
    String.fromCharCode(...new Uint8Array(signature))
  );
  return signatureBase64;
}

async function verifyToken(secretKey, peerId, token) {
  const encodedKey = new TextEncoder().encode(secretKey);
  const key = await crypto.subtle.importKey(
    "raw",
    encodedKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const encodedPeerId = new TextEncoder().encode(peerId);
  const encodedToken = new Uint8Array(
    atob(token)
      .split("")
      .map((c) => c.charCodeAt(0))
  );
  return crypto.subtle.verify("HMAC", key, encodedToken, encodedPeerId);
}

async function peerIdNotExists(db, peerId) {
  const checkPeerStmt = await getFromCache("check-peer", () =>
    db.prepare("SELECT id FROM flare_peer_peers WHERE id = ?1 LIMIT 1")
  );
  const checkResult = await checkPeerStmt.bind(peerId).first("id");
  return checkResult === null;
}

async function createPeerId(db) {
  let peerId = null;
  for (let retries = 0; retries < 5; retries++) {
    peerId = crypto.randomUUID();
    if (await peerIdNotExists(db, peerId)) break;
  }
  const insertPeerStmt = await getFromCache("insert-peer", () =>
    db.prepare("INSERT INTO flare_peer_peers (id, created_at) VALUES (?1, ?2)")
  );
  await insertPeerStmt.bind(peerId, Date.now()).run();
  return peerId;
}

const PEER_METHODS = {
  async open(params, context) {
    const { env, server, data } = context;
    if (data.peerId) throw new Error("Precondition Failed");
    if (env.PEER_API_KEY && params?.key !== env.PEER_API_KEY) server.close();
    const newPeerId = await createPeerId(env.DB);
    data.peerId = newPeerId;
    const token = await generateToken(env.SECRET_KEY, newPeerId);
    return { id: newPeerId, token };
  },

  async reconnect(params, context) {
    const { env, data } = context;
    if (data.peerId) throw new Error("Precondition Failed");
    if (typeof params.id !== "string") throw new Error("Bad Request");
    const verifyResult =
      typeof params.token === "string"
        ? await verifyToken(env.SECRET_KEY, params.id, params.token)
        : false;
    if (!verifyResult) throw new Error("Unauthorized");
    if (await peerIdNotExists(env.DB, params.id)) throw new Error("Not Found");
    data.peerId = params.id;
  },

  async destroy(_, context) {
    const { env, data } = context;
    if (!data.peerId) throw new Error("Precondition Failed");
    const deleteTopicStmt = env.DB.prepare(
      "DELETE FROM flare_peer_peers WHERE id = ?1"
    );
    const deleteMessagesStmt = env.DB.prepare(
      "DELETE FROM flare_peer_messages WHERE source = ?1 OR destination = ?1"
    );
    await deleteTopicStmt.bind(data.peerId).run();
    await deleteMessagesStmt.bind(data.peerId).run();
    data.peerId = null;
  },

  async send(params, context) {
    const { env, data } = context;

    if (!data.peerId) throw new Error("Precondition Failed");
    if (typeof params.id !== "string" || typeof params.content !== "string")
      throw new Error("Bad Request");
    if (data.peerId === params.id) throw new Error("Forbidden");
    if (await peerIdNotExists(env.DB, params.id)) throw new Error("Not Found");
    if (params.content.length > 32767) throw new Error("Content Too Large");

    const insertMessageStmt = await getFromCache("insert-message", () =>
      env.DB.prepare(
        "INSERT INTO flare_peer_messages (source, destination, type, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)"
      )
    );
    await insertMessageStmt
      .bind(data.peerId, params.id, params.type, params.content, Date.now())
      .run();
  },

  async poll(_, context) {
    const { env, data } = context;

    if (!data.peerId) throw new Error("Precondition Failed");

    const pollInterval = env.PEER_POLL_INTERVAL ?? 4500;
    if (data.lastPoll + pollInterval > Date.now())
      throw new Error("Too Many Requests");
    data.lastPoll = Date.now();

    const consumeMessageStmt = await getFromCache("consume-message", () =>
      env.DB.prepare(
        "DELETE FROM flare_peer_messages WHERE destination = ?1 RETURNING source, type, content"
      )
    );
    const queryResult = await consumeMessageStmt.bind(data.peerId).all();
    return queryResult.results;
  },
};

async function onSocketOpen({ server, env }) {
  const localData = { peerId: null, lastPoll: 0 };

  setTimeout(() => {
    if (!localData.peerId) server.close();
  }, 10000);

  server.addEventListener("message", async (event) => {
    try {
      if (typeof event.data !== "string") throw new Error("Bad Request");
      const data = JSON.parse(event.data);
      if (!(data.method in PEER_METHODS)) throw new Error("Bad Request");
      const context = { env, server, data: localData };
      PEER_METHODS[data.method](data.params, context)
        .then((result) => {
          if (!data.id) return;
          server.send(JSON.stringify({ result: result ?? null, id: data.id }));
        })
        .catch((e) => {
          server.send(
            JSON.stringify({ error: { message: e.message }, id: data.id })
          );
        });
    } catch (e) {
      server.send(JSON.stringify({ error: { message: e.message } }));
    }
  });
}

export default {
  async fetch(request, env) {
    if (!env.SECRET_KEY)
      return new Response("SECRET_KEY not set", { status: 500 });

    if (!env.DB) return new Response("DB not set", { status: 500 });

    const upgradeHeader = request.headers.get("Upgrade");

    if (!upgradeHeader || upgradeHeader !== "websocket")
      return new Response("Upgrade Required", { status: 426 });

    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    onSocketOpen({ server, env });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  },
};

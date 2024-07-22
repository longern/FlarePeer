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

async function onSocketOpen(server, env) {
  let peerId = null;
  let lastPoll = new Date(0);

  if (!env.DB) {
    server.send(JSON.stringify({ type: "error", message: "DB not set" }));
    server.close();
  }

  async function peerIdNotExists(peerId) {
    const checkPeerStmt = await getFromCache("check-peer", () =>
      env.DB.prepare("SELECT id FROM flare_peer_peers WHERE id = ?1 LIMIT 1")
    );
    const checkResult = await checkPeerStmt.bind(peerId).first("id");
    return checkResult === null;
  }

  async function createPeerId() {
    let peerId = null;
    for (let retries = 0; retries < 5; retries++) {
      peerId = crypto.randomUUID();
      if (await peerIdNotExists(peerId)) break;
    }
    const insertPeerStmt = await getFromCache("insert-peer", () =>
      env.DB.prepare(
        "INSERT INTO flare_peer_peers (id, created_at) VALUES (?1, ?2)"
      )
    );
    await insertPeerStmt.bind(peerId, Date.now()).run();
    return peerId;
  }

  const secretKey = env.SECRET_KEY;
  server.addEventListener("message", async (event) => {
    try {
      if (typeof event.data !== "string") return;
      const data = JSON.parse(event.data);
      switch (data.type) {
        case "open": {
          if (peerId) throw new Error("Bad Request");
          if (env.PEER_API_KEY && data.key !== env.PEER_API_KEY) server.close();
          peerId = await createPeerId();
          const token = await generateToken(secretKey, peerId);
          server.send(JSON.stringify({ type: "open", id: peerId, token }));
          break;
        }
        case "reconnect": {
          if (peerId || typeof data.id !== "string")
            throw new Error("Bad Request");
          const verifyResult =
            typeof data.token === "string"
              ? await verifyToken(secretKey, data.id, data.token)
              : false;
          if (!verifyResult) throw new Error("Unauthorized");
          if (await peerIdNotExists(data.id)) throw new Error("Not Found");
          peerId = data.id;
          server.send(JSON.stringify({ type: "reconnect" }));
          break;
        }
        case "destroy": {
          if (!peerId) throw new Error("Bad Request");
          const deleteTopicStmt = env.DB.prepare(
            "DELETE FROM flare_peer_peers WHERE id = ?1"
          );
          const deleteMessagesStmt = env.DB.prepare(
            "DELETE FROM flare_peer_messages WHERE source = ?1 OR destination = ?1"
          );
          await deleteTopicStmt.bind(peerId).run();
          await deleteMessagesStmt.bind(peerId).run();
          server.send(JSON.stringify({ type: "destroy" }));
          break;
        }
        case "offer":
        case "answer":
        case "ice-candidate": {
          if (!peerId || typeof data.id !== "string" || peerId === data.id)
            throw new Error("Bad Request");
          if (await peerIdNotExists(data.id)) throw new Error("Not Found");
          const insertMessageStmt = await getFromCache("insert-message", () =>
            env.DB.prepare(
              "INSERT INTO flare_peer_messages (source, destination, type, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)"
            )
          );
          await insertMessageStmt
            .bind(peerId, data.id, data.type, data.content, Date.now())
            .run();
          break;
        }
        case "poll": {
          if (!peerId) throw new Error("Bad Request");
          const pollInterval = env.PEER_POLL_INTERVAL ?? 4500;
          if (lastPoll.getTime() + pollInterval > Date.now())
            throw new Error("Too Many Requests");
          const consumeMessageStmt = await getFromCache("consume-message", () =>
            env.DB.prepare(
              "DELETE FROM flare_peer_messages WHERE destination = ?1 RETURNING source, type, content"
            )
          );
          const queryResult = await consumeMessageStmt.bind(peerId).all();
          for (const row of queryResult.results) {
            const { type, source, content } = row;
            server.send(JSON.stringify({ type, source, content }));
          }
          break;
        }
      }
    } catch (e) {
      server.send(JSON.stringify({ type: "error", message: e.message }));
    }
  });
}

export default {
  async fetch(request, env) {
    const secretKey = env.SECRET_KEY;
    if (!secretKey) return new Response("SECRET_KEY not set", { status: 500 });

    const upgradeHeader = request.headers.get("Upgrade");

    if (!upgradeHeader || upgradeHeader !== "websocket")
      return new Response("Upgrade Required", { status: 426 });

    const { 0: client, 1: server } = new WebSocketPair();

    server.accept();
    onSocketOpen(server, env);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  },
};

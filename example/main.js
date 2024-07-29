/**
 * @typedef { import("./client").FlarePeerClient } FlarePeerClient
 */

/** @param {RTCPeerConnection} peerConnection
 * @returns {Promise<RTCSessionDescriptionInit>}
 */
function waitICEGathering(peerConnection) {
  return new Promise((resolve) => {
    /** Wait at most 200ms for ICE gathering. */
    setTimeout(function () {
      resolve(peerConnection.localDescription);
    }, 200);
    peerConnection.onicegatheringstatechange = (_ev) =>
      peerConnection.iceGatheringState === "complete" &&
      resolve(peerConnection.localDescription);
  });
}

/** @param {WebSocket} ws
 * @returns {FlarePeerClient}
 */
function jsonRpcClient(ws) {
  const remoteCalls = {};

  ws.addEventListener("open", () => {
    ws.addEventListener("message", async function (event) {
      const data = JSON.parse(event.data);
      if (data.jsonrpc !== "2.0") return console.error("Invalid response");
      if (data.id) {
        if (remoteCalls[data.id]) {
          if (data.error) remoteCalls[data.id].reject(data.error.message);
          else remoteCalls[data.id].resolve(data.result);
          delete remoteCalls[data.id];
        }
        return;
      }
      if (data.error) console.error(data.error.message);
    });
  });

  const client = new Proxy(
    {},
    {
      get: (_, method) => (params) => {
        return new Promise((resolve, reject) => {
          const id = Math.random().toString(36).slice(2);
          remoteCalls[id] = { resolve, reject };
          ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
        });
      },
    }
  );

  return client;
}

(function () {
  const endpoint = "wss://peer.longern.com";
  const ws = new WebSocket(endpoint);
  const connections = {};

  const client = jsonRpcClient(ws);

  ws.onopen = async function () {
    const { id, token } = await client.open();
    document.getElementById("my-peer-id").textContent = id;
    console.log("Token for reconnection is", token);
    const interval = setInterval(async () => {
      const messages = await client.poll();
      for (const message of messages) {
        const { type, source, content } = message;
        switch (type) {
          case "offer": {
            const connection = new RTCPeerConnection();
            connection.addEventListener("connectionstatechange", (event) => {
              document.getElementById("connection-state").textContent =
                event.target.connectionState;
            });
            await connection.setRemoteDescription({
              type: "offer",
              sdp: content,
            });
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            const { sdp } = await waitICEGathering(connection);
            connections[source] = connection;
            client.send({ type: "answer", id: source, content: sdp });
            break;
          }
          case "answer": {
            const connection = connections[source];
            if (!connection) return;
            await connection.setRemoteDescription({
              type: "answer",
              sdp: content,
            });
            break;
          }
        }
      }
    }, 5000);
    ws.onclose = () => clearInterval(interval);

    /** @param {string} peerId */
    async function guest(peerId) {
      connections[peerId] = new RTCPeerConnection();
      connections[peerId].addEventListener("connectionstatechange", (event) => {
        document.getElementById("connection-state").textContent =
          event.target.connectionState;
      });
      connections[peerId].createDataChannel("channel");
      const offer = await connections[peerId].createOffer();
      await connections[peerId].setLocalDescription(offer);
      const { sdp } = await waitICEGathering(connections[peerId]);
      client.send({ type: "offer", id: peerId, content: sdp });
    }

    window.guest = guest;
  };
})();

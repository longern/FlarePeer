# FlarePeer

Free serverless signalling for WebRTC using Cloudflare Workers and D1.

## Usage & Example

### Protocol

Use [JSON-RPC 2.0](https://www.jsonrpc.org/specification) without `jsonrpc` field over WebSocket.

Example request:

```json
{
  "method": "open",
  "params": { "key": "PEER_API_KEY" },
  "id": 1
}
```

Example response:

```json
{
  "result": { "id": "xxxx-xxxx", "token": "TOKEN" },
  "id": 1
}
```

### Methods

```typescript
interface FlarePeerApi {
  open(params?: { key?: string }): Promise<{ id: string; token: string }>;

  reconnect(params: { id: string; token: string }): Promise<void>;

  destroy(): Promise<void>;

  send(params: {
    type: "offer" | "answer" | "ice-candidate";
    id: string;
    content: string;
  }): Promise<void>;

  poll(): Promise<{
    type: "offer" | "answer" | "ice-candidate";
    source: string;
    content: string;
  }>;
}
```

See `index.html` for a complete example.

### Demo server

A demo server is available at `wss://peer.longern.com`.
However, it is recommended to host your own server to ensure privacy and reliability.

### Host your own server

Create a new D1 database and run SQL queries in `src/db.sql`.

Create a new Workers project and copy `src/worker.js` to the editor.
Set the following environment variables and deploy.

- `DB`: (Required) D1 database binding.
- `SECRET_KEY`: (Required) A random secret key.
- `PEER_API_KEY`: If set, clients must provide this key to connect.
- `PEER_POLL_INTERVAL`: The minimum interval (ms) between polling. Default is 4500.

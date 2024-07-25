## Introduction

A simple signaling server for WebRTC using Cloudflare Workers and D1.

## Usage

### Protocol

Use [JSON-RPC 2.0](https://www.jsonrpc.org/specification) without `jsonrpc` field over WebSockets to communicate with the server.

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
  "result": { "id": "xxxx-xxx", "token": "TOKEN" },
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

### Example

See `index.html`.

### Environment Variables

- `DB`: (Required) D1 database binding.
- `SECRET_KEY`: (Required) A random secret key.
- `PEER_API_KEY`: If set, clients must provide this key to connect.
- `PEER_POLL_INTERVAL`: The minimum interval (ms) between polling. Default is 4500.

### Demo server

A demo server is available at `wss://peer.longern.com`.

### Host your own server

Create a new Workers project and copy `src/worker.js` to the editor.
Set the environment variables and deploy.

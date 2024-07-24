## Introduction

A simple signaling server for WebRTC using Cloudflare Workers and D1.

## Usage

See `src/message.d.ts` for the message format.

### Environment Variables

- `DB`: (Required) D1 database binding.
- `SECRET_KEY`: (Required) A random secret key.
- `PEER_API_KEY`: If set, clients must provide this key to connect.
- `PEER_POLL_INTERVAL`: The minimum interval (ms) between polling. Default is 4500.

## Example

See `index.html`.

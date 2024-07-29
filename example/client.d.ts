export interface FlarePeerClient {
  open(params?: { key?: string }): Promise<{ id: string; token: string }>;

  reconnect(params: { id: string; token: string }): Promise<void>;

  destroy(): Promise<void>;

  send(params: {
    type: "offer" | "answer" | "ice-candidate";
    id: string;
    content: string;
  }): Promise<void>;

  poll(): Promise<
    Array<{
      type: "offer" | "answer" | "ice-candidate";
      source: string;
      content: string;
    }>
  >;
}

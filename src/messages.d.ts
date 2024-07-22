type RequestOpen = {
  type: "open";
  key?: string; // `PEER_API_KEY`
};
type ResponseOpen = {
  type: "open";
  id: string;
  token: string;
};

type RequestReconnect = {
  type: "reconnect";
  id: string;
  token: string;
};
type ResponseReconnect = {
  type: "reconnect";
};

type RequestMessage = {
  type: "offer" | "answer" | "ice-candidate";
  id: string;
  content: string;
};
type RequestPoll = {
  type: "poll";
};
type ServerSendMessage = {
  type: "offer" | "answer" | "ice-candidate";
  source: string;
  content: string;
};

type ResponseError = {
  type: "error";
  message: string;
};

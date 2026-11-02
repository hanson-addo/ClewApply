// A stand-in for the Anthropic Messages API, used only by the end-to-end tests. The worker's
// SDK is pointed here with ANTHROPIC_BASE_URL, so no test sends anything to the real API.
//
// It always answers with a save_profile tool call: basics.name is the first line of the
// resume text (which proves the server extracted the text and sent it), plus fixed made-up
// fields. A resume containing SLOW-STUB is answered after FAKE_ANTHROPIC_DELAY_MS, so tests
// can catch a parse while it is running. Nothing is logged.
import { createServer } from "node:http";

const port = Number(new URL(process.env.FAKE_ANTHROPIC_URL ?? "http://127.0.0.1:8787").port);
const slowMs = Number(process.env.FAKE_ANTHROPIC_DELAY_MS ?? 15000);

function resumeText(body) {
  const content = body.messages?.[0]?.content;
  const text = typeof content === "string" ? content : "";
  return text.replace(/<\/?resume>/g, "").trim();
}

createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200).end("ok");
    return;
  }
  if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) {
    res.writeHead(404, { "content-type": "application/json" }).end('{"type":"error"}');
    return;
  }
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const text = resumeText(body);
    const name = text.split("\n")[0]?.trim() || "Unknown";
    const answer = {
      id: "msg_fake",
      type: "message",
      role: "assistant",
      model: body.model,
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [
        {
          type: "tool_use",
          id: "toolu_fake",
          name: "save_profile",
          input: {
            profile: {
              basics: { name, label: "Thread engineer" },
              work: [{ name: "Labyrinth Logistics", position: "Thread Engineer", startDate: "2021-03" }],
            },
            confidence: [
              { path: "basics.name", score: 0.97 },
              { path: "basics.label", score: 0.4 },
              { path: "work[0].name", score: 0.9 },
            ],
          },
        },
      ],
    };
    const send = () =>
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(answer));
    if (text.includes("SLOW-STUB")) setTimeout(send, slowMs);
    else send();
  });
}).listen(port, "127.0.0.1", () => console.log(`fake Anthropic API on ${port}`));

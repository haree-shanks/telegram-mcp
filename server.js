import express from "express";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN env var is required");

const app = express();
app.use(express.json());

// CORS — required for Cowork / browser MCP clients
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, Accept");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Health check
app.get("/", (_req, res) =>
  res.json({ status: "ok", service: "telegram-mcp", version: "1.0.0" })
);

// ── Minimal hand-crafted MCP JSON-RPC 2.0 server ──────────────────────────────
app.post("/mcp", async (req, res) => {
  const body = req.body;
  const id = body.id ?? null;
  const method = body.method ?? "";

  console.log("→ MCP request:", method, JSON.stringify(body.params ?? {}));

  try {
    // 1. initialize
    if (method === "initialize") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "telegram-mcp", version: "1.0.0" },
          capabilities: { tools: {} },
        },
      });
    }

    // 2. initialized notification (no response needed)
    if (method === "notifications/initialized") {
      return res.status(204).end();
    }

    // 3. tools/list
    if (method === "tools/list") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "send_message",
              description: "Send a message to a Telegram chat via the bot",
              inputSchema: {
                type: "object",
                properties: {
                  chat_id: {
                    type: "string",
                    description: "Telegram chat ID (numeric, as a string)",
                  },
                  text: {
                    type: "string",
                    description:
                      "Message text. Supports HTML: <b>bold</b>, <i>italic</i>, <a href='...'>link</a>",
                  },
                  parse_mode: {
                    type: "string",
                    enum: ["HTML", "Markdown", "MarkdownV2"],
                    description: "Formatting mode (default: HTML)",
                  },
                },
                required: ["chat_id", "text"],
              },
            },
          ],
        },
      });
    }

    // 4. tools/call
    if (method === "tools/call") {
      const { name, arguments: args = {} } = body.params ?? {};

      if (name === "send_message") {
        const { chat_id, text, parse_mode = "HTML" } = args;

        if (!chat_id || !text) {
          return res.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: "❌ chat_id and text are required" }],
              isError: true,
            },
          });
        }

        const resp = await fetch(
          `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id, text, parse_mode }),
          }
        );
        const result = await resp.json();
        console.log("← Telegram response:", JSON.stringify(result));

        if (!result.ok) {
          return res.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: `❌ Telegram error: ${result.description}`,
                },
              ],
              isError: true,
            },
          });
        }

        return res.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: `✅ Message delivered to chat ${chat_id} (message_id: ${result.result.message_id})`,
              },
            ],
          },
        });
      }

      // Unknown tool
      return res.json({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown tool: ${name}` },
      });
    }

    // Unknown method
    return res.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  } catch (err) {
    console.error("MCP handler error:", err);
    return res.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: String(err) },
    });
  }
});

// SSE / DELETE stubs
app.get("/mcp", (_req, res) =>
  res.status(405).json({ error: "Use POST /mcp for MCP requests" })
);
app.delete("/mcp", (_req, res) => res.sendStatus(200));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Telegram MCP server listening on port ${PORT}`)
);

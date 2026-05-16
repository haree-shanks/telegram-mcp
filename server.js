import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN env var is required");

const app = express();
app.use(express.json());

// Health check
app.get("/", (req, res) => res.json({ status: "ok", service: "telegram-mcp" }));

app.all("/mcp", async (req, res) => {
  const server = new McpServer({
    name: "telegram-mcp",
    version: "1.0.0",
  });

  // Tool: send a Telegram message
  server.tool(
    "send_message",
    "Send a message to a Telegram chat via the bot",
    {
      chat_id: z.string().describe("Telegram chat ID (numeric, as a string)"),
      text: z.string().describe("Message text. Supports HTML: <b>bold</b>, <i>italic</i>, <a href='...'>link</a>"),
      parse_mode: z.enum(["HTML", "Markdown", "MarkdownV2"]).optional().describe("Formatting mode (default: HTML)"),
    },
    async ({ chat_id, text, parse_mode = "HTML" }) => {
      const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id, text, parse_mode }),
      });
      const result = await resp.json();
      if (!result.ok) {
        throw new Error(`Telegram API error: ${result.description}`);
      }
      return {
        content: [{ type: "text", text: `✅ Message delivered to chat ${chat_id} (message_id: ${result.result.message_id})` }],
      };
    }
  );

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Telegram MCP server listening on port ${PORT}`));

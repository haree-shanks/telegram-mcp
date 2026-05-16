// Zero-dependency Telegram MCP server — uses only Node.js built-ins
import http from "http";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const PORT = parseInt(process.env.PORT || "3000", 10);

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, mcp-session-id, Accept",
  });
  res.end(data);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

async function handleMcp(body) {
  const id = body.id ?? null;
  const method = body.method ?? "";

  console.log("MCP:", method);

  if (method === "initialize") {
    return {
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "telegram-mcp", version: "1.0.0" },
        capabilities: { tools: {} },
      },
    };
  }

  if (method === "notifications/initialized") {
    return null; // 204
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0", id,
      result: {
        tools: [{
          name: "send_message",
          description: "Send a message to a Telegram chat via the bot",
          inputSchema: {
            type: "object",
            properties: {
              chat_id: { type: "string", description: "Telegram chat ID" },
              text: { type: "string", description: "Message text (HTML supported)" },
              parse_mode: { type: "string", enum: ["HTML", "Markdown", "MarkdownV2"] },
            },
            required: ["chat_id", "text"],
          },
        }],
      },
    };
  }

  if (method === "tools/call") {
    const { name, arguments: args = {} } = body.params ?? {};
    if (name === "send_message") {
      const { chat_id, text, parse_mode = "HTML" } = args;
      if (!chat_id || !text) {
        return {
          jsonrpc: "2.0", id,
          result: { isError: true, content: [{ type: "text", text: "chat_id and text are required" }] },
        };
      }
      if (!BOT_TOKEN) {
        return {
          jsonrpc: "2.0", id,
          result: { isError: true, content: [{ type: "text", text: "TELEGRAM_BOT_TOKEN not set on server" }] },
        };
      }
      try {
        const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id, text, parse_mode }),
        });
        const result = await resp.json();
        if (!result.ok) {
          return {
            jsonrpc: "2.0", id,
            result: { isError: true, content: [{ type: "text", text: `Telegram error: ${result.description}` }] },
          };
        }
        return {
          jsonrpc: "2.0", id,
          result: { content: [{ type: "text", text: `✅ Delivered to chat ${chat_id} (msg ${result.result.message_id})` }] },
        };
      } catch (err) {
        return {
          jsonrpc: "2.0", id,
          result: { isError: true, content: [{ type: "text", text: `Fetch error: ${err.message}` }] },
        };
      }
    }
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } };
  }

  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${method}` } };
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, mcp-session-id, Accept",
    });
    res.end();
    return;
  }

  // Health check
  if (req.method === "GET" && req.url === "/") {
    json(res, 200, { status: "ok", service: "telegram-mcp", token_set: !!BOT_TOKEN });
    return;
  }

  // MCP endpoint — POST only
  if (req.method === "POST" && req.url === "/mcp") {
    const body = await readBody(req);
    const response = await handleMcp(body);
    if (response === null) {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*" });
      res.end();
    } else {
      json(res, 200, response);
    }
    return;
  }

  if (req.method === "GET" && req.url === "/mcp") {
    json(res, 405, { error: "Use POST /mcp" });
    return;
  }

  if (req.method === "DELETE" && req.url === "/mcp") {
    res.writeHead(200, { "Access-Control-Allow-Origin": "*" });
    res.end();
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`telegram-mcp listening on port ${PORT}`);
  console.log(`BOT_TOKEN set: ${!!BOT_TOKEN}`);
});

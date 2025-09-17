import 'dotenv/config';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { request, FormData, File } from "undici";

const LOG_LEVEL = (process.env.LOG_LEVEL ?? "warn").toLowerCase();
const toErr = (s: string) => process.stderr.write(s + "\n");
const log = {
  info: (...a: any[]) => (["info","debug"].includes(LOG_LEVEL) ? toErr("[INFO] " + a.join(" ")) : undefined),
  warn:  (...a: any[]) => (["warn","info","debug"].includes(LOG_LEVEL) ? toErr("[WARN] " + a.join(" ")) : undefined),
  error: (...a: any[]) => toErr("[ERR ] " + a.join(" ")),
  debug: (...a: any[]) => (LOG_LEVEL === "debug" ? toErr("[DBG ] " + a.join(" ")) : undefined),
};

const TOKEN = (process.env.SLACK_TOKEN ?? "").trim();
if (!TOKEN) { log.error("SLACK_TOKEN missing. Put your xoxp-… user token in .env"); process.exit(1); }

const MCP_SERVER_NAME = process.env.MCP_SERVER_NAME || "mcp-slack-oauth";
const MCP_SERVER_VERSION = process.env.MCP_SERVER_VERSION || "0.5.0";

function mask(t: string) { return t.length > 12 ? `${t.slice(0,6)}…${t.slice(-6)}` : t; }
log.info(`Using Slack user token ${mask(TOKEN)}`);

async function slackGet(method: string, params: Record<string, any>) {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const res = await request(url, { method: "GET", headers: { authorization: `Bearer ${TOKEN}` } });
  const text = await res.body.text();
  let json: any; try { json = JSON.parse(text); } catch { throw new Error(text); }
  if (res.statusCode >= 400) throw new Error(`HTTP ${res.statusCode}: ${text}`);
  if (json?.ok === false) throw new Error(`Slack ${method} error: ${json.error ?? "unknown_error"}`);
  return json;
}

async function slackPostJson(method: string, body: Record<string, any>) {
  const url = `https://slack.com/api/${method}`;
  const res = await request(url, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const text = await res.body.text();
  let json: any; try { json = JSON.parse(text); } catch { throw new Error(text); }
  if (res.statusCode >= 400) throw new Error(`HTTP ${res.statusCode}: ${text}`);
  if (json?.ok === false) throw new Error(`Slack ${method} error: ${json.error ?? "unknown_error"}`);
  return json;
}

async function slackPostForm(method: string, form: FormData) {
  const url = `https://slack.com/api/${method}`;
  const res = await request(url, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: form });
  const text = await res.body.text();
  let json: any; try { json = JSON.parse(text); } catch { throw new Error(text); }
  if (res.statusCode >= 400) throw new Error(`HTTP ${res.statusCode}: ${text}`);
  if (json?.ok === false) throw new Error(`Slack ${method} error: ${json.error ?? "unknown_error"}`);
  return json;
}

async function fetchBinary(uri: string) {
  const res = await request(uri, { method: "GET", headers: { authorization: `Bearer ${TOKEN}` }, maxRedirections: 5 });
  const ab = await res.body.arrayBuffer();
  const buf = Buffer.from(ab);
  const ct = res.headers["content-type"] as string | string[] | undefined;
  const mime = Array.isArray(ct) ? (ct[0] ?? "application/octet-stream") : (ct ?? "application/octet-stream");
  return { base64: buf.toString("base64"), mimeType: mime };
}

const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION });

/* ---- List/Search/History (existing) ---- */
server.registerTool("slack_list_conversations",
  { title: "List Slack conversations",
    description: "List channels/DMs visible to the user token.",
    inputSchema: { types: z.array(z.enum(["public_channel","private_channel","im","mpim"])).optional(),
                   limit: z.number().int().min(1).max(1000).optional(),
                   cursor: z.string().optional() } },
  async ({ types, limit, cursor }) => {
    const data = await slackGet("conversations.list", {
      types: (types ?? ["public_channel","private_channel","im","mpim"]).join(","),
      limit: limit ?? 200, cursor
    });
    const items = (data.channels ?? []).map((c: any) => ({ id: c.id, name: c.name, is_private: !!c.is_private, is_im: !!c.is_im, is_mpim: !!c.is_mpim }));
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, items, response_metadata: data.response_metadata }) }] };
  }
);

server.registerTool("slack_fetch_history",
  { title: "Fetch conversation history",
    description: "conversations.history for public/private/DM/MPIM.",
    inputSchema: { channel: z.string().min(1), oldest: z.string().optional(), latest: z.string().optional(),
                   inclusive: z.boolean().optional(), limit: z.number().int().min(1).max(1000).optional(), cursor: z.string().optional() } },
  async ({ channel, oldest, latest, inclusive, limit, cursor }) => {
    const data = await slackGet("conversations.history", { channel, oldest, latest, inclusive, limit: limit ?? 200, cursor });
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  }
);

server.registerTool("slack_search_messages",
  { title: "Search Slack messages",
    description: "search.messages respecting your user visibility.",
    inputSchema: { query: z.string().min(1), count: z.number().int().min(1).max(100).optional(),
                   sort: z.enum(["score","timestamp"]).optional(), sort_dir: z.enum(["asc","desc"]).optional() } },
  async ({ query, count, sort, sort_dir }) => {
    const data = await slackGet("search.messages", { query, count: count ?? 20, sort, sort_dir });
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  }
);

// Search messages constrained to a single channel
server.registerTool("slack_search_in_channel",
  { title: "Search messages in a specific channel",
    description: "Search Slack messages limited to one channel (public or private) by channel name (e.g. #general) or ID (C…/G…).",
    inputSchema: { channel: z.string().min(1), query: z.string().min(1), count: z.number().int().min(1).max(100).optional(),
                   sort: z.enum(["score","timestamp"]).optional(), sort_dir: z.enum(["asc","desc"]).optional() } },
  async ({ channel, query, count, sort, sort_dir }) => {
    async function resolveChannelName(ch: string): Promise<string> {
      const raw = ch.trim();
      if (raw.startsWith("#")) return raw.slice(1);
      if (/^[CG][A-Z0-9]+$/.test(raw)) {
        const info = await slackGet("conversations.info", { channel: raw });
        const c = (info as any)?.channel;
        if (!c?.name) throw new Error("Channel not found or not accessible.");
        return c.name as string;
      }
      return raw;
    }

    const channelName = await resolveChannelName(channel);
    const searchQuery = `${query} in:#${channelName}`;
    const data = await slackGet("search.messages", { query: searchQuery, count: count ?? 20, sort, sort_dir });
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  }
);

/* ---- Files (read) ---- */
server.registerTool("slack_list_files",
  { title: "List files",
    description: "List Slack-hosted files you can access; filter by channel/user/time/type.",
    inputSchema: { channel: z.string().optional(), user: z.string().optional(),
                   ts_from: z.string().optional(), ts_to: z.string().optional(),
                   types: z.string().optional(), count: z.number().int().min(1).max(1000).optional(),
                   page: z.number().int().min(1).optional(), cursor: z.string().optional(), limit: z.number().int().min(1).max(200).optional() } },
  async (args) => {
    const data = await slackGet("files.list", args as any);
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  }
);

server.registerTool("slack_get_file_info",
  { title: "Get file info",
    description: "files.info for a given file ID.",
    inputSchema: { file: z.string().min(1) } },
  async ({ file }) => {
    const data = await slackGet("files.info", { file });
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  }
);

server.registerTool("slack_download_file",
  { title: "Download file",
    description: "Download a Slack-hosted file as a resource (not external GDrive/Dropbox links).",
    inputSchema: { file: z.string().min(1), preferText: z.boolean().optional() } },
  async ({ file, preferText }) => {
    const info = await slackGet("files.info", { file });
    const f = info?.file;
    if (!f) throw new Error("File not found or not accessible.");
    if (f.is_external || f.external_type) {
      return { content: [{ type: "text", text: JSON.stringify({ ok:false, error:"external_file", note:"Cannot download external files via Slack API.", file:f }) }] };
    }
    const url = f.url_private_download || f.url_private || f.permalink_public;
    if (!url) throw new Error("No downloadable URL available for this file.");
    const { base64, mimeType } = await fetchBinary(url);
    const out: any[] = [{ type: "resource", resource: { mimeType, blob: base64 } }];
    if (preferText && (mimeType.startsWith("text/") || mimeType === "application/json")) {
      out.push({ type: "text", text: Buffer.from(base64, "base64").toString("utf8") });
    } else {
      out.push({ type: "text", text: JSON.stringify({ ok:true, file:{ id:f.id, name:f.name, mimetype:f.mimetype, size:f.size } }) });
    }
    return { content: out };
  }
);

/* ---- Files (write) ---- */
server.registerTool("slack_upload_file",
  { title: "Upload file",
    description: "Upload a file. Provide either 'content' (text) or 'data_base64' (binary).",
    inputSchema: { channels: z.string().optional(), // comma-separated channel IDs
                   filename: z.string().min(1),
                   title: z.string().optional(),
                   initial_comment: z.string().optional(),
                   content: z.string().optional(),        // plain text content
                   data_base64: z.string().optional(),    // base64-encoded bytes
                   mimeType: z.string().optional() } },
  async ({ channels, filename, title, initial_comment, content, data_base64, mimeType }) => {
    if (!content && !data_base64) throw new Error("Provide either 'content' or 'data_base64'.");
    if (content && data_base64) throw new Error("Provide either 'content' or 'data_base64', not both.");
    if (content) {
      // Simple path: send as 'content' (Slack treats it as text)
      const form = new FormData();
      form.set("filename", filename);
      if (channels) form.set("channels", channels);
      if (title) form.set("title", title);
      if (initial_comment) form.set("initial_comment", initial_comment);
      form.set("content", content);
      const data = await slackPostForm("files.upload", form);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    } else {
      // Binary path: multipart 'file'
      const buf = Buffer.from(data_base64!, "base64");
      const file = new File([buf], filename, { type: mimeType || "application/octet-stream" });
      const form = new FormData();
      form.set("filename", filename);
      if (channels) form.set("channels", channels);
      if (title) form.set("title", title);
      if (initial_comment) form.set("initial_comment", initial_comment);
      form.set("file", file);
      const data = await slackPostForm("files.upload", form);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
  }
);

server.registerTool("slack_delete_file",
  { title: "Delete file",
    description: "files.delete by ID.",
    inputSchema: { file: z.string().min(1) } },
  async ({ file }) => {
    const data = await slackPostJson("files.delete", { file });
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  }
);

/* ---- Users ---- */
server.registerTool("slack_users_list",
  { title: "List users",
    description: "users.list (requires users:read).",
    inputSchema: { limit: z.number().int().min(1).max(200).optional(), cursor: z.string().optional() } },
  async ({ limit, cursor }) => {
    const data = await slackGet("users.list", { limit: limit ?? 200, cursor });
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  }
);

/* ---- DMs / Chat ---- */
server.registerTool("slack_open_dm",
  { title: "Open DM",
    description: "Open a direct message with a user and return the channel ID (D…). Requires im:write.",
    inputSchema: { user: z.string().min(1) } },
  async ({ user }) => {
    const data = await slackPostJson("conversations.open", { users: user });
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  }
);

server.registerTool("slack_post_message",
  { title: "Post message",
    description: "chat.postMessage (posts as the user token). Provide channel ID (C…/G…/D…).",
    inputSchema: { channel: z.string().min(1), text: z.string().min(1), thread_ts: z.string().optional(), unfurl_links: z.boolean().optional() } },
  async ({ channel, text, thread_ts, unfurl_links }) => {
    const data = await slackPostJson("chat.postMessage", { channel, text, thread_ts, unfurl_links });
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  }
);

async function main() {
  await slackGet("auth.test", {});
  await server.connect(new StdioServerTransport());
}
void main();

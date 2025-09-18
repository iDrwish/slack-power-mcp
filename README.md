[![MSeeP.ai Security Assessment Badge](https://mseep.net/pr/idrwish-slack-power-mcp-badge.png)](https://mseep.ai/app/idrwish-slack-power-mcp)

# 🚀 Slack OAuth MCP - The Ultimate Slack Integration for Claude

> **Finally!** A Slack MCP that actually works the way you need it to. No more limitations, no more workarounds.

## ⚡ Why This Changes Everything

Traditional Slack integrations are **frustrating**. Limited access, can't see private channels, can't act on your behalf. This MCP is different:

- 🔐 **Access EVERYTHING** - Private channels, DMs, group messages
- 🎯 **Act as YOU** - Send messages, upload files, manage conversations  
- 🔍 **Search EVERYWHERE** - Find anything across your entire workspace
- ⚡ **Zero Friction** - Works instantly with Claude Code

## 🎯 Perfect For Product Managers

- **Sprint Planning**: Search retrospective notes across private channels
- **Stakeholder Updates**: Send status updates to multiple channels instantly
- **Documentation**: Find and analyze team conversations for insights
- **File Management**: Upload specs, download feedback, organize resources
- **Team Coordination**: Monitor discussions, facilitate decisions

## ⚙️ Setup (5 Minutes Max)

### 1. Create Your Slack App
1. Go to [api.slack.com](https://api.slack.com) → "Create New App"
2. Add these OAuth scopes:
   ```
   channels:history, channels:read, chat:write, files:read,
   groups:history, groups:read, groups:write, search:read,
   search:read.files, search:read.private, mpim:history, mpim:write
   ```
3. Install to workspace, copy your **User OAuth Token** (`xoxp-...`)

### 2. Install & Configure
```bash
git clone <this-repo>
cd slack-oauth-mcp
npm install && npm run build

# Create .env
echo "SLACK_TOKEN=your-xoxp-token-here" > .env
```

### 3. Add to Claude Code
```json
{
  "mcps": {
    "slack": {
      "command": "node",
      "args": ["/path/to/slack-oauth-mcp/build/server.js"]
    }
  }
}
```

## 🎉 What You Can Do Now

Ask Claude things like:
- *"Find all mentions of our Q4 goals in private channels"*
- *"Send the launch update to #product and #engineering"*
- *"Download the latest design files from our team channel"*

### 🔎 Search within a specific channel
Use the `slack_search_in_channel` tool to search by content in a single channel (public or private). You can pass a channel name (with or without the `#`) or a channel ID.

Example prompts:

```text
Search "roadmap" in #product only
```

or via direct tool usage:

```json
{
  "tool": "slack_search_in_channel",
  "input": { "channel": "#product", "query": "roadmap", "count": 50 }
}
```
- *"Search for feedback on the mobile app across all conversations"*

## 🔒 Security First

- Uses **your** Slack permissions (nothing more, nothing less)
- OAuth token stays local
- All actions appear as you in Slack audit logs

## 🚨 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SLACK_TOKEN` | Required | Your `xoxp-` user token |
| `MCP_SERVER_NAME` | `mcp-slack-oauth` | Customize MCP name |
| `LOG_LEVEL` | `warn` | Debug with `debug` |

## 💡 Pro Tips

- **Multiple Workspaces**: Create separate .env files and configs
- **Team Setup**: Share OAuth scopes list with your team
- **Debugging**: Set `LOG_LEVEL=debug` if something breaks

---

**Ready to supercharge your Slack workflow?** ⭐ Star this repo and get started in 5 minutes!
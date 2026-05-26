// Tool definition generator for the MCP thin-proxy architecture.
//
// Server delivers toolDefinitions[] to daemon on agent.start. The daemon's
// chat-bridge registers these as MCP tools and forwards calls to the server's
// generic tool execution endpoint (POST /api/agent/:id/tool/:name).
//
// Tools marked `local: true` are handled by the daemon (upload/download).

function generateToolDefinitions({ tools = null, hasOv = false } = {}) {
  const allTools = [
    {
      name: "send",
      description: "Send a message to a channel, DM, or thread. Use the target from incoming messages to reply.",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string", description: "Where to send: #channel, dm:@name, #channel:threadId, dm:@name:threadId" },
          content: { type: "string", description: "Message content" },
          attachments: { type: "array", items: { type: "string" }, description: "Attachment IDs from upload tool" },
        },
        required: ["target", "content"],
      },
    },
    {
      name: "inbox",
      description: "Check for new unread messages. Returns all messages since your last check.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "history",
      description: "Read message history for a channel, DM, or thread with cursor-based pagination.",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Target: #channel, dm:@name, #channel:threadId" },
          limit: { type: "number", description: "Max messages to return (default 30, max 100)" },
          before: { type: "string", description: "Cursor: message ID to fetch before" },
          after: { type: "string", description: "Cursor: message ID to fetch after" },
        },
        required: ["channel"],
      },
    },
    {
      name: "search",
      description: "Search messages across visible channels by keyword.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search keyword" },
          channel: { type: "string", description: "Scope to specific channel (optional)" },
          sender: { type: "string", description: "Filter by sender name (optional)" },
          limit: { type: "number", description: "Max results (default 10, max 20)" },
        },
        required: ["query"],
      },
    },
    {
      name: "directory",
      description: "List all channels, agents, and humans in the workspace.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "task",
      description: "Manage tasks: list, create, claim, release, or update status. Set action to choose operation.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "create", "claim", "release", "update"], description: "Operation to perform" },
          channel: { type: "string", description: "Channel scope for the task" },
          status: { type: "string", enum: ["all", "todo", "in_progress", "in_review", "done"], description: "Filter (list) or new status (update)" },
          titles: { type: "array", items: { type: "string" }, description: "Task titles (create)" },
          numbers: { type: "array", items: { type: "number" }, description: "Task numbers (claim)" },
          number: { type: "number", description: "Task number (release/update)" },
        },
        required: ["action", "channel"],
      },
    },
    {
      name: "upload",
      description: "Upload a local file to attach to a message.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Local file path" },
          channel: { type: "string", description: "Target channel for scoping" },
        },
        required: ["path", "channel"],
      },
      local: true,
    },
    {
      name: "download",
      description: "Download an attached file to the local workspace.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Attachment ID" },
        },
        required: ["id"],
      },
      local: true,
    },
  ];

  // OV tools (optional, for agents with explicit OV access)
  if (hasOv) {
    allTools.push(
      { name: "ov_search", description: "Search memories and knowledge by semantic query.", inputSchema: { type: "object", properties: { query: { type: "string" }, scope: { type: "string", description: "user, agent, or resources" } }, required: ["query"] } },
      { name: "ov_read", description: "Read the full content of a memory by URI.", inputSchema: { type: "object", properties: { uri: { type: "string", description: "viking:// URI" } }, required: ["uri"] } },
      { name: "ov_list", description: "List entries in a memory directory.", inputSchema: { type: "object", properties: { uri: { type: "string" }, recursive: { type: "boolean" } }, required: ["uri"] } },
      { name: "ov_store", description: "Store a new memory entry.", inputSchema: { type: "object", properties: { role: { type: "string" }, content: { type: "string" } }, required: ["content"] } },
      { name: "ov_forget", description: "Delete a memory entry.", inputSchema: { type: "object", properties: { uri: { type: "string" } }, required: ["uri"] } },
    );
  }

  // Filter to requested tool names if specified
  if (tools) {
    const allowed = new Set(tools);
    return allTools.filter((t) => allowed.has(t.name) || t.local);
  }

  return allTools;
}

module.exports = { generateToolDefinitions };

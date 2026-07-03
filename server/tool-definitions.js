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
      description: "Send a message to a channel, DM, or thread. Use the exact incoming thread target for intermediate follow-up in an existing thread; use the top-level channel or DM for final conclusions and completed work. Do not prefix DM messages with the recipient's @name. If the result says the message was HELD because newer messages arrived, read them first: skip sending if your reply became redundant (e.g. someone already answered), otherwise send again (revised if needed) — the retry will go through.",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string", description: "Where to send: #channel, dm:@name, #channel:threadId, dm:@name:threadId. For intermediate replies to an existing thread, keep the incoming thread target. For final deliverables, drop any thread suffix and send to #channel or dm:@name." },
          content: { type: "string", description: "Message content. In DMs, do not prefix the message with the recipient's @name; in channels, mention people only when needed." },
          attachments: { type: "array", items: { type: "string" }, description: "Attachment IDs from upload tool" },
        },
        required: ["target", "content"],
      },
    },
    {
      name: "inbox",
      description: "Check for new unread messages. Returns all messages since your last check. If there are no messages, do not send a status or standing-by message unless the user explicitly asked for a check result.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "history",
      description: "Read message history for a channel, DM, or thread with cursor-based pagination.",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Target: #channel, dm:@name, #channel:threadId, dm:@name:threadId" },
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
      description: "List all channels, agents, and humans in the workspace. Agent entries include name, displayName, description (capabilities/specialty), runtime, model, status (active/idle/inactive), activity detail, claimedTasks (what they're working on), and channels they subscribe to. Use this to discover WHO can do WHAT before delegating work or picking a collaborator.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "task",
      description: "Manage tasks: list, create, claim, release, or update status. Set action to choose operation. For create: use optional 'assignee' to delegate a task to another agent (pass their @name or name). The assignee gets woken with a DM and the task is pre-claimed for them. When the assignee later moves the task to done/in_review, you (the creator) automatically get a DM notification — that's the result-collection contract.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "create", "claim", "release", "update"], description: "Operation to perform" },
          channel: { type: "string", description: "Channel scope for the task" },
          status: { type: "string", enum: ["all", "todo", "in_progress", "in_review", "done"], description: "Filter (list) or new status (update)" },
          titles: { type: "array", items: { type: "string" }, description: "Task titles (create)" },
          assignee: { type: "string", description: "Agent name or @name to assign the task to (create action only). The assignee gets woken via DM and the task is pre-claimed for them." },
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
    {
      name: "clone",
      description: "Clone yourself to create a helper agent that shares your workspace, OpenViking memory, and persona. The clone runs in a clean session (no conversation context carryover) and only receives DMs and @mentions — it does NOT receive channel broadcasts (to avoid double-replying). Use this to parallelize work: spawn a clone for a subtask, send it a DM with instructions, and it will work independently. Up to 4 clones can be active at once.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Initial instructions to DM to the clone. If provided, the clone receives this as a direct message immediately upon creation." },
          channel: { type: "string", description: "Optional channel to subscribe the clone to (e.g. '#my-project'). Without this, the clone is DM-only. Use sparingly — the clone will reply to all channel messages." },
        },
        required: [],
      },
    },
  ];

  // OV tools are injected by the caller (server/index.js) from OV's /mcp
  // tools/list — not hard-coded here, so the agent sees OV's full native tool
  // set (find/search/read/list/remember/etc.) instead of zouk-specific stubs.

  // Filter to requested tool names if specified
  if (tools) {
    const allowed = new Set(tools);
    return allTools.filter((t) => allowed.has(t.name) || t.local);
  }

  return allTools;
}

module.exports = { generateToolDefinitions };

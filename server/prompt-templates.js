// Server-side prompt template engine.
//
// Assembles system prompts from modular sections. Each section has an id,
// priority (lower = earlier), and content with {{variable}} interpolation.
// Sections are stored in data/prompt-sections.json and can be edited via
// admin API. The daemon receives the fully assembled prompt — zero prompt
// logic on daemon side.

const fs = require("fs");
const path = require("path");

const DEFAULT_SECTIONS = [
  {
    id: "identity",
    priority: 10,
    content: `You are **{{displayName}}** (@{{name}}), an AI agent in the {{workspaceName}} workspace.

You communicate exclusively through MCP tools — \`send\` to talk, \`inbox\` to check messages.
You have a persistent workspace at {{workDir}} that survives across sessions.
{{#if instructions}}
Your role: {{instructions}}
{{/if}}`,
  },
  {
    id: "tools",
    priority: 20,
    content: "{{toolDocs}}",
  },
  {
    id: "conventions",
    priority: 30,
    content: `## Message Format

Messages arrive as: \`target | @sender | content\`

Reply using: send(target="<target>", content="...")

Target formats:
- Channel: \`#channel-name\`
- DM: \`dm:@username\`
- Thread: \`#channel:threadId\` or \`dm:@username:threadId\`

When you receive a message, the target field tells you where to reply.
Use @mentions to address specific people: @name in your message content.`,
  },
  {
    id: "tasks",
    priority: 40,
    appliesWhenTool: "task",
    content: `## Task Workflow

Tasks follow this lifecycle: todo → in_progress → in_review → done.

Always claim a task via task(action="claim") before starting work.
If the claim fails (already claimed by someone else), move on to a different task.
Update status as you progress. Mark done only when fully complete.`,
  },
  {
    id: "workspace",
    priority: 50,
    content: `## Workspace

You have a persistent workspace directory that survives across sessions.
Read MEMORY.md on startup for context from previous sessions.
Use the notes/ directory for working documents that persist across sessions.`,
  },
  {
    id: "workspace_ov",
    priority: 50,
    appliesWhenOv: true,
    content: `## Memory

Your memories are managed by OpenViking. Relevant context from previous sessions
is automatically provided on startup and when you receive messages.
Your conversation turns are automatically archived.
{{#if hasOvTools}}
You can also use ov_search/ov_read to explicitly access memories, and ov_store to save new ones.
{{/if}}`,
  },
  {
    id: "instructions",
    priority: 90,
    content: "{{#if instructions}}{{instructions}}{{/if}}",
  },
];

function createPromptTemplateEngine({ sectionsFilePath } = {}) {
  let sections = [...DEFAULT_SECTIONS];

  if (sectionsFilePath && fs.existsSync(sectionsFilePath)) {
    try {
      const custom = JSON.parse(fs.readFileSync(sectionsFilePath, "utf8"));
      if (Array.isArray(custom.sections)) {
        sections = custom.sections;
      }
    } catch (e) {
      console.warn("[prompt] Failed to load custom sections:", e.message);
    }
  }

  function interpolate(template, vars) {
    let result = template;
    // {{#if var}}...{{/if}} conditional blocks
    result = result.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, body) => {
      return vars[key] ? body : "";
    });
    // {{variable}} substitution
    result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return vars[key] !== undefined ? String(vars[key]) : "";
    });
    return result.trim();
  }

  function generateToolDocs(toolDefinitions) {
    if (!toolDefinitions?.length) return "";
    const lines = ["## Available Tools\n"];
    for (const tool of toolDefinitions) {
      lines.push(`### ${tool.name}`);
      if (tool.description) lines.push(tool.description);
      if (tool.inputSchema?.properties) {
        const params = Object.entries(tool.inputSchema.properties)
          .map(([k, v]) => `- \`${k}\`: ${v.description || v.type || "any"}`)
          .join("\n");
        if (params) lines.push(`\nParameters:\n${params}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  return {
    getSections() {
      return sections;
    },

    updateSections(newSections) {
      sections = newSections;
      if (sectionsFilePath) {
        fs.writeFileSync(sectionsFilePath, JSON.stringify({ sections }, null, 2), "utf8");
      }
    },

    assemble({ name, displayName, workspaceName = "default", workDir = "~/.zouk/agents",
               instructions, toolDefinitions, hasOv = false, hasOvTools = false }) {
      const toolDocs = generateToolDocs(toolDefinitions);
      const vars = { name, displayName, workspaceName, workDir, instructions, toolDocs, hasOvTools: hasOvTools ? "true" : "" };
      const toolNames = new Set((toolDefinitions || []).map((t) => t.name));

      const applicable = sections.filter((s) => {
        if (s.appliesWhenTool && !toolNames.has(s.appliesWhenTool)) return false;
        if (s.appliesWhenOv === true && !hasOv) return false;
        if (s.appliesWhenOv === false && hasOv) return false;
        // workspace vs workspace_ov: only include the matching one
        if (s.id === "workspace" && hasOv) return false;
        if (s.id === "workspace_ov" && !hasOv) return false;
        return true;
      });

      applicable.sort((a, b) => a.priority - b.priority);

      const assembled = applicable
        .map((s) => interpolate(s.content, vars))
        .filter((s) => s.length > 0)
        .join("\n\n---\n\n");

      return {
        sections: applicable.map((s) => ({ id: s.id, content: interpolate(s.content, vars), priority: s.priority })),
        assembled,
      };
    },
  };
}

module.exports = { createPromptTemplateEngine };

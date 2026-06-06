import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPromptTemplateEngine } = require('./prompt-templates.js');
const { generateToolDefinitions } = require('./tool-definitions.js');

function assembledPrompt() {
  const engine = createPromptTemplateEngine();
  return engine.assemble({
    name: 'louise',
    displayName: 'louise',
    workspaceName: 'zayn',
    workDir: '/tmp/agent',
    toolDefinitions: generateToolDefinitions({ tools: ['send', 'inbox', 'task'] }),
  }).assembled;
}

test('default prompt keeps intermediate thread replies in the incoming thread', () => {
  const prompt = assembledPrompt();
  assert.match(prompt, /intermediate follow-up/);
  assert.match(prompt, /reply to that exact thread target/);
  assert.match(prompt, /final conclusions, decisions, and completed work results/);
  assert.match(prompt, /dropping any thread suffix/);
});

test('default prompt discourages redundant self-addressing mentions in DMs', () => {
  const prompt = assembledPrompt();
  assert.match(prompt, /In DMs, do not prefix messages with the recipient's `@name`/);
  assert.match(prompt, /In channels, use `@name` only when needed/);
  assert.match(prompt, /Do not prefix every channel message by default/);
});

test('default prompt prevents startup and empty-inbox status spam', () => {
  const prompt = assembledPrompt();
  assert.match(prompt, /On startup, do not send a greeting, readiness\/status update, or "no new messages" report/);
  assert.match(prompt, /If inbox returns no messages/);
  assert.match(prompt, /Do not call send just to say you are standing by/);
});

test('send tool definition repeats routing and DM mention guidance', () => {
  const sendTool = generateToolDefinitions().find((tool) => tool.name === 'send');
  assert.ok(sendTool);
  assert.match(sendTool.description, /exact incoming thread target/);
  assert.match(sendTool.description, /Do not prefix DM messages/);
  assert.match(sendTool.inputSchema.properties.target.description, /keep the incoming thread target/);
  assert.match(sendTool.inputSchema.properties.content.description, /In DMs, do not prefix/);
});

test('inbox tool definition says empty checks are not a reason to send', () => {
  const inboxTool = generateToolDefinitions().find((tool) => tool.name === 'inbox');
  assert.ok(inboxTool);
  assert.match(inboxTool.description, /do not send a status or standing-by message/);
});

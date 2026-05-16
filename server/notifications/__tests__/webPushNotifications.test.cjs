const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildPushPayload,
  mentionsUser,
  messageTargetsUser,
} = require("../webPushNotifications");

test("messageTargetsUser includes DM recipients and excludes the sender", () => {
  const message = {
    id: "m1",
    channelType: "dm",
    channelName: "dm:alice,zayn",
    senderName: "alice",
    senderType: "human",
    content: "ping",
  };

  assert.equal(messageTargetsUser(message, { name: "zayn" }), true);
  assert.equal(messageTargetsUser(message, { name: "alice" }), false);
  assert.equal(messageTargetsUser(message, { name: "bob" }), false);
});

test("messageTargetsUser includes explicit channel mentions only by default", () => {
  const message = {
    id: "m2",
    channelType: "channel",
    channelName: "all",
    senderName: "alice",
    senderType: "human",
    content: "can @zaynjarvis check this?",
  };

  assert.equal(messageTargetsUser(message, { name: "zaynjarvis" }), true);
  assert.equal(messageTargetsUser(message, { name: "bob" }), false);
  assert.equal(
    messageTargetsUser({ ...message, content: "regular channel update" }, { name: "bob" }),
    false,
  );
  assert.equal(
    messageTargetsUser(
      { ...message, content: "regular channel update" },
      { name: "bob" },
      { notifyAllChannelMessages: true },
    ),
    true,
  );
});

test("mentionsUser supports email-local aliases", () => {
  assert.equal(mentionsUser("heads up @zayn", "Zayn Jarvis", "zayn@example.com"), true);
  assert.equal(mentionsUser("heads up @zayn_jarvis", "Zayn Jarvis", "zayn@example.com"), true);
  assert.equal(mentionsUser("heads up @someone_else", "Zayn Jarvis", "zayn@example.com"), false);
});

test("buildPushPayload produces compact title, body, tag, and workspace url", () => {
  const payload = buildPushPayload({
    id: "m3",
    workspaceId: "default",
    channelId: "ch_all",
    channelType: "channel",
    channelName: "all",
    senderName: "alice",
    senderType: "human",
    content: "hello `code` " + "x".repeat(220),
  }, { name: "zayn" }, { publicUrl: "https://zouki.zaynjarvis.com/" });

  assert.equal(payload.title, "alice · #all");
  assert.equal(payload.url, "https://zouki.zaynjarvis.com/z/default");
  assert.equal(payload.tag, "zouk:default:ch_all");
  assert.ok(payload.body.length <= 161);
  assert.match(payload.body, /hello code/);
});

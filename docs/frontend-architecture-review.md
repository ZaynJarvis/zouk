# Frontend Architecture Review

Date: 2026-05-09

## Component Map

- `App.tsx`: auth/config bootstrap, then `AppProvider` + `AppShell`.
- Shell/navigation: `WorkspaceRail`, `ChannelSidebar`, `TopBar`, `PinnedRail`, `RightPanel`, `AgentStatus`.
- Chat surface: `MessageList` -> `MessageItem` + `MessageComposer`; `ThreadPanel` reuses both for thread replies.
- Full-canvas views: `AgentPanel`, `TasksView`, `MemoryView`.
- Right panels: `RightPanel` routes to `ThreadPanel`, `WorkspacePanel`, `AgentSettingsPanel`, `AgentProfilePanel`, `ChannelSettingsPanel`.
- Agent area: `AgentDetail`, `AgentActivityFeed`, `AgentConfigForm`, `CreateAgentDialog`, `MachineSetupDialog`.
- Shared UI/helpers: `zk/primitives`, `panel/PanelShell`, `panel/PanelHeader`, `workspace/WorkspaceTree`, `workspace/useWorkspaceTree`, `memory/AtlasRenderers`, `memory/atlas-helpers`.

## Reuse

- Good existing reuse: `WorkspaceTree` + `useWorkspaceTree` are shared by agent detail/profile/workspace surfaces; panel chrome is shared by settings/detail panels.
- Fixed in this pass: file preview rendering was duplicated between `MemoryView` and `WorkspacePanel`. It now lives in `components/memory/renderPreviewContent.tsx`.
- Still worth doing later: agent selector strips in `MemoryView` and `WorkspacePanel` are similar but not identical; extract only after the target UX is settled.
- Do not extract now: `MessageItem` is shared in main/thread views already; further splitting would add indirection without removing much complexity.

## Dead Code

Removed unused frontend code:

- `PresenceIndicator.tsx`
- `glitch/GlitchText.tsx`
- `navigation/themeVariants.ts`
- `lib/classNames.ts`
- legacy `themes/carbon/*`
- legacy `themes/washington-post/*`
- dead carbon/washington-post CSS blocks in `index.css`

Static import graph now shows all TS/TSX app files reachable from `main.tsx`, except `vite-env.d.ts` which is an ambient Vite type file.

## Fixes

- Fixed `ThreadPanel` hook dependency warning by depending on a stable `activeThreadId`.
- Marked renderer/primitive utility TSX files as non-Fast-Refresh boundaries so lint reflects the intentional module shape.
- Updated theme registry comment to match Atlas-only reality.

## Risks / Next

- `appStore.ts` is still the main state hub; future large feature work should avoid adding more unrelated state there.
- `MemoryView` remains large. Split only around real seams: source navigation, preview pane, and mobile resize behavior.
- `ScanlineTear` / `GlitchTransition` are mostly legacy no-op wrappers under Atlas, but still heavily used by settings/create-agent flows. Remove in a separate UI cleanup if desired.

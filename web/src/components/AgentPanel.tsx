import { Bot, Plus, Server, Monitor, ChevronDown, ChevronRight, Settings, X } from 'lucide-react';
import { useState, useMemo, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import type { ServerAgent, ServerMachine } from '../types';


import { isMobileViewport } from '../lib/layout';
import AgentDetail from './AgentDetail';
import CreateAgentDialog from './CreateAgentDialog';
import MachineSetupDialog from './MachineSetupDialog';
import { formatRuntime, formatRuntimes } from '../lib/runtimeLabels';
import { AgentAvatar, Eyebrow } from './zk/primitives';

function AgentListItem({
  agent,
  isSelected,
  onClick,
  onOpenSettings,
  onDelete,
}: {
  agent: ServerAgent;
  isSelected: boolean;
  onClick: () => void;
  onOpenSettings: () => void;
  onDelete?: () => void;
}) {
  const isInactive = agent.status === 'inactive';

  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full text-left transition-colors"
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        background: isSelected ? 'var(--zk-bg-3)' : 'transparent',
        borderBottom: '1px solid var(--zk-line)',
        color: isSelected ? 'var(--zk-ink)' : 'var(--zk-ink-dim)',
      }}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--zk-bg-2)'; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
    >
      {isSelected && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute', left: 0, top: 8, bottom: 8,
            width: 2, background: 'var(--zk-ember)', borderRadius: '0 2px 2px 0',
          }}
        />
      )}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <AgentAvatar agent={agent} size="md" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--zk-ink)' }} className="zk-truncate">
          {agent.displayName || agent.name}
        </div>
        <div
          className="zk-truncate"
          style={{ fontSize: 11, color: 'var(--zk-ink-mute)', fontFamily: 'var(--zk-font-mono)', marginTop: 1 }}
        >
          {formatRuntime(agent.runtime) || 'No runtime'} · {agent.model || '—'}
        </div>
      </div>
      {agent.archivedAt && <span className="zk-pill">Archived</span>}
      <span
        role="button"
        onClick={(e) => { e.stopPropagation(); onOpenSettings(); }}
        className="zk-btn zk-btn--ghost zk-btn--icon hidden sm:inline-flex"
        style={{
          opacity: 0,
          transition: 'opacity 140ms var(--zk-ease-out)',
          padding: 4,
        }}
        title={`Configure ${agent.displayName || agent.name}`}
      >
        <Settings size={12} />
      </span>
      {isInactive && onDelete && (
        <span
          role="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="zk-btn zk-btn--ghost zk-btn--icon"
          style={{ color: 'var(--zk-err)', padding: 4 }}
          title="Delete agent — its machine is gone"
        >
          <X size={12} />
        </span>
      )}
    </button>
  );
}

function CompactMachineCard({ machine }: { machine: ServerMachine }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 14px',
        borderBottom: '1px solid var(--zk-line)',
        fontFamily: 'var(--zk-font-mono)',
      }}
    >
      <Server size={11} color="var(--zk-ok)" style={{ flexShrink: 0 }} />
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--zk-ink)' }} className="zk-truncate">
        {machine.alias || machine.hostname}
      </span>
      {machine.alias && machine.alias !== machine.hostname && (
        <span style={{ fontSize: 10, color: 'var(--zk-ink-mute)' }} className="zk-truncate">
          {machine.hostname}
        </span>
      )}
      <span
        style={{
          width: 6, height: 6, borderRadius: 999,
          background: 'var(--zk-ok)', flexShrink: 0,
        }}
      />
      {machine.runtimes && (
        <span
          className="zk-truncate"
          style={{
            fontSize: 10, color: 'var(--zk-ink-low)',
            marginLeft: 'auto', maxWidth: '40%',
          }}
          title={formatRuntimes(machine.runtimes)}
        >
          {formatRuntimes(machine.runtimes)}
        </span>
      )}
    </div>
  );
}

export default function AgentsView() {
  const {
    agents, configs, machines, startAgent, stopAgent, updateAgentConfig, deleteAgent,
    isGuest, agentDetailTab, setAgentDetailTab, selectedAgentId, setSelectedAgentId,
  } = useApp();
  const [showArchived, setShowArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showMachineSetup, setShowMachineSetup] = useState(false);
  const [machinesExpanded, setMachinesExpanded] = useState(true);
  const [mobileShowDetail, setMobileShowDetail] = useState(false);

  const filteredAgents = useMemo(() =>
    showArchived
      ? agents.filter((a) => a.archivedAt)
      : agents.filter((a) => !a.archivedAt),
    [agents, showArchived],
  );

  const unifiedEntities = useMemo<ServerAgent[]>(() => {
    const runningIds = new Set(agents.map((a) => a.id));
    const offlineFromConfigs = configs
      .filter((c) => c.id && !runningIds.has(c.id))
      .map((c) => ({
        id: c.id!,
        name: c.name,
        displayName: c.displayName,
        description: c.description,
        runtime: c.runtime ?? 'claude',
        model: c.model,
        picture: c.picture,
        status: 'inactive' as const,
        activity: 'offline' as const,
      } as ServerAgent));
    return [...filteredAgents, ...offlineFromConfigs];
  }, [filteredAgents, configs, agents]);

  const archivedCount = useMemo(() => agents.filter((a) => a.archivedAt).length, [agents]);
  const selected = agents.find((a) => a.id === selectedAgentId)
    ?? (unifiedEntities.length > 0 ? unifiedEntities[0] : null);

  const handleDeleteInactive = async (agentId: string) => {
    const config = configs.find((c) => c.id === agentId);
    const label = config?.displayName || config?.name || agentId;
    const confirmed = window.confirm(`Delete agent ${label}? Its machine is gone, so it cannot be restarted.`);
    if (!confirmed) return;
    await deleteAgent(agentId);
    setSelectedAgentId((current) => (current === agentId ? null : current));
  };

  const handleCreateAgent = async (config: {
    name: string;
    description: string;
    runtime: string;
    model: string;
    machineId?: string;
    lifecycle?: 'persistent' | 'ephemeral';
  }) => {
    await startAgent({
      name: config.name,
      description: config.description,
      runtime: config.runtime,
      model: config.model,
      machineId: config.machineId,
      lifecycle: config.lifecycle,
    });
    setShowCreate(false);
  };

  const handleUpdateAgent = async (updates: Partial<ServerAgent>) => {
    if (!selected) return;
    await updateAgentConfig(selected.id, updates);
  };

  const handleSelectAgent = (id: string) => {
    setSelectedAgentId(id);
    setAgentDetailTab('instructions');
    if (isMobileViewport()) setMobileShowDetail(true);
  };

  const handleOpenAgentSettings = (id: string) => {
    setSelectedAgentId(id);
    setAgentDetailTab('settings');
    if (isMobileViewport()) setMobileShowDetail(true);
  };

  const handleDeleteAgent = async () => {
    if (!selected) return;
    const label = selected.displayName || selected.name;
    const confirmed = window.confirm(`Delete agent ${label}? This removes the saved config and disconnects the running agent.`);
    if (!confirmed) return;
    await deleteAgent(selected.id);
    setSelectedAgentId((current) => (current === selected.id ? null : current));
    if (isMobileViewport()) setMobileShowDetail(false);
  };

  useEffect(() => {
    if (agentDetailTab === 'settings' && isMobileViewport() && selected) {
      setMobileShowDetail(true);
    }
  }, [agentDetailTab, selected]);

  return (
    <div
      style={{
        flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden',
        background: 'var(--zk-bg-0)', color: 'var(--zk-ink)',
      }}
    >
      {/* Left list */}
      <aside
        className={mobileShowDetail ? 'hidden lg:flex' : 'flex'}
        style={{
          width: '100%', flexShrink: 0,
          flexDirection: 'column',
          background: 'var(--zk-bg-1)',
        }}
      >
        {/* Header (page title + actions) */}
        <header
          className="safe-top"
          style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '14px 18px 12px',
            borderBottom: '1px solid var(--zk-line)',
            flexShrink: 0,
          }}
        >
          <div className="zk-col">
            <Eyebrow>WORKSPACE</Eyebrow>
            <h1
              className="zk-display"
              style={{ margin: '2px 0 0', fontWeight: 600, fontSize: 19, letterSpacing: '-0.012em' }}
            >
              Agents
            </h1>
          </div>
          <span style={{ fontSize: 12, color: 'var(--zk-ink-mute)', fontFamily: 'var(--zk-font-mono)' }}>
            {unifiedEntities.length} total
          </span>
          <span className="zk-grow" />
          {archivedCount > 0 && (
            <button
              type="button"
              className="zk-btn"
              onClick={() => setShowArchived(!showArchived)}
              style={{ fontSize: 11 }}
            >
              {showArchived ? 'Active' : `Archived (${archivedCount})`}
            </button>
          )}
          {!isGuest && (
            <>
              <button
                type="button"
                className="zk-btn"
                onClick={() => setShowMachineSetup(true)}
                title="Machine setup & API keys"
              >
                <Settings size={12} /> Machine setup
              </button>
              <button
                type="button"
                className="zk-btn zk-btn--primary"
                onClick={() => setShowCreate(true)}
                title="Add agent"
              >
                <Plus size={12} /> Add agent
              </button>
            </>
          )}
        </header>

        <div
          style={{
            flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden',
          }}
        >
          {/* Agent list */}
          <div className="zk-scroll" style={{
            flex: '0 0 320px', overflow: 'auto',
            borderRight: '1px solid var(--zk-line)',
            background: 'var(--zk-bg-1)',
          }}>
            {/* Machines section */}
            <div>
              <button
                type="button"
                onClick={() => setMachinesExpanded(!machinesExpanded)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '10px 14px 6px',
                  background: 'transparent', border: 0, cursor: 'pointer',
                  width: '100%', textAlign: 'left',
                }}
              >
                {machinesExpanded
                  ? <ChevronDown size={10} color="var(--zk-ink-mute)" />
                  : <ChevronRight size={10} color="var(--zk-ink-mute)" />}
                <Monitor size={10} color="var(--zk-ok)" />
                <span
                  style={{
                    fontFamily: 'var(--zk-font-mono)', fontSize: 10,
                    fontWeight: 500, letterSpacing: '0.16em',
                    color: 'var(--zk-ink-mute)', textTransform: 'uppercase',
                  }}
                >
                  Machines ({machines.length})
                </span>
              </button>
              {machinesExpanded && (
                machines.length > 0
                  ? machines.map((m) => <CompactMachineCard key={m.id} machine={m} />)
                  : (
                    <div style={{ padding: '4px 14px 10px' }}>
                      {isGuest ? (
                        <p style={{ fontSize: 11, color: 'var(--zk-ink-mute)', textAlign: 'center', fontFamily: 'var(--zk-font-mono)' }}>
                          No machines connected
                        </p>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setShowMachineSetup(true)}
                          className="zk-btn"
                          style={{
                            width: '100%', justifyContent: 'center',
                            border: '1px dashed var(--zk-line-bright)',
                            color: 'var(--zk-ink-mute)', background: 'transparent',
                            fontSize: 11,
                          }}
                        >
                          <Plus size={11} /> Connect machine
                        </button>
                      )}
                    </div>
                  )
              )}
            </div>

            {machines.length > 0 && (
              <hr className="zk-hr" style={{ margin: '4px 14px' }} />
            )}

            {/* Agents */}
            {unifiedEntities.length > 0 ? (
              unifiedEntities.map((agent) => (
                <AgentListItem
                  key={agent.id}
                  agent={agent}
                  isSelected={agent.id === (selected?.id ?? '')}
                  onClick={() => handleSelectAgent(agent.id)}
                  onOpenSettings={() => handleOpenAgentSettings(agent.id)}
                  onDelete={agent.status === 'inactive' ? () => handleDeleteInactive(agent.id) : undefined}
                />
              ))
            ) : (
              <div style={{ padding: '48px 16px', textAlign: 'center' }}>
                <div
                  style={{
                    width: 48, height: 48,
                    borderRadius: 12,
                    background: 'var(--zk-bg-2)',
                    border: '1px solid var(--zk-line)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 12,
                  }}
                >
                  <Bot size={20} color="var(--zk-ink-mute)" />
                </div>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--zk-ink)' }}>
                  {showArchived ? 'No archived agents' : 'No agents yet'}
                </p>
                {!showArchived && !isGuest && (
                  <button
                    type="button"
                    onClick={() => setShowCreate(true)}
                    className="zk-btn zk-btn--primary"
                    style={{ marginTop: 12 }}
                  >
                    <Plus size={12} /> Create agent
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Right detail */}
          <div
            className={mobileShowDetail ? 'flex' : 'hidden lg:flex'}
            style={{
              flex: 1, minWidth: 0,
              flexDirection: 'column',
              background: 'var(--zk-bg-0)',
            }}
          >
            {selected ? (
              <AgentDetail
                key={selected.id}
                agent={selected}
                machines={machines}
                initialTab={agentDetailTab}
                onUpdate={handleUpdateAgent}
                onStop={() => stopAgent(selected.id)}
                onDelete={handleDeleteAgent}
                onBack={() => setMobileShowDetail(false)}
              />
            ) : (
              <div
                style={{
                  flex: 1, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  background: 'var(--zk-bg-0)',
                }}
              >
                <div
                  style={{
                    width: 64, height: 64,
                    borderRadius: 14,
                    background: 'var(--zk-bg-1)',
                    border: '1px solid var(--zk-line)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 16,
                  }}
                >
                  <Bot size={26} color="var(--zk-ink-mute)" />
                </div>
                <h3 className="zk-display" style={{ fontSize: 17, fontWeight: 600, margin: 0, color: 'var(--zk-ink)' }}>
                  No agent selected
                </h3>
                <p style={{ fontSize: 12, color: 'var(--zk-ink-mute)', marginTop: 6, fontFamily: 'var(--zk-font-mono)' }}>
                  Select an agent from the list or create a new one.
                </p>
              </div>
            )}
          </div>
        </div>
      </aside>

      {showCreate && !isGuest && (
        <CreateAgentDialog
          machines={machines}
          onClose={() => setShowCreate(false)}
          onCreate={handleCreateAgent}
          onOpenMachineSetup={() => { setShowCreate(false); setShowMachineSetup(true); }}
        />
      )}

      {showMachineSetup && !isGuest && (
        <MachineSetupDialog
          machines={machines}
          onClose={() => setShowMachineSetup(false)}
        />
      )}
    </div>
  );
}

/**
 * LogsSidebar — server list + log source selector for the Logs page.
 * Fetches servers on mount, fetches available log sources when server changes.
 * Collapsible: shows only status dots when collapsed.
 */

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Circle } from 'lucide-react';
import { apiCall } from '@/client/hooks/useApi';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Server {
  id: number;
  name: string;
  host: string;
  status: string;
}

interface LogsSidebarProps {
  selectedServer: number | null;
  onSelectServer: (id: number | null) => void;
  selectedSources: string[];
  onSelectSources: (sources: string[]) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const ALL_SOURCES = [
  'journalctl',
  'auth.log',
  'syslog',
  'dmesg',
  'kern.log',
  'daemon.log',
];

// ─── Component ──────────────────────────────────────────────────────────────

export function LogsSidebar({
  selectedServer,
  onSelectServer,
  selectedSources,
  onSelectSources,
  collapsed,
  onToggleCollapse,
}: LogsSidebarProps) {
  const [servers, setServers] = useState<Server[]>([]);
  const [availableSources, setAvailableSources] = useState<string[]>(ALL_SOURCES);
  const [loadingServers, setLoadingServers] = useState(true);

  // Fetch server list on mount
  useEffect(() => {
    setLoadingServers(true);
    apiCall<Server[]>('/api/servers')
      .then((data) => setServers(data || []))
      .catch(() => setServers([]))
      .finally(() => setLoadingServers(false));
  }, []);

  // Fetch available log sources when server changes
  useEffect(() => {
    if (!selectedServer) {
      setAvailableSources(ALL_SOURCES);
      return;
    }
    apiCall<string[]>(`/api/logs/sources?serverId=${selectedServer}`)
      .then((data) => setAvailableSources(data || ALL_SOURCES))
      .catch(() => setAvailableSources(ALL_SOURCES));
  }, [selectedServer]);

  const toggleSource = (source: string) => {
    if (selectedSources.includes(source)) {
      onSelectSources(selectedSources.filter((s) => s !== source));
    } else {
      onSelectSources([...selectedSources, source]);
    }
  };

  return (
    <div
      className={`flex flex-col h-full border-r border-border bg-card/50 transition-all duration-200 ${
        collapsed ? 'w-12' : 'w-64'
      }`}
    >
      {/* Collapse toggle */}
      <div className="flex items-center justify-end p-2 border-b border-border">
        <button
          onClick={onToggleCollapse}
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* Server list */}
      <div className="flex-1 overflow-y-auto">
        {!collapsed && (
          <h3 className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">
            Servers
          </h3>
        )}

        {loadingServers ? (
          <div className="flex justify-center py-4">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
          </div>
        ) : (
          <div className={collapsed ? 'py-2 space-y-2 flex flex-col items-center' : 'px-2 py-1 space-y-0.5'}>
            {servers.map((server) => {
              const isOnline = server.status === 'online';
              const isSelected = selectedServer === server.id;

              if (collapsed) {
                return (
                  <button
                    key={server.id}
                    onClick={() => onSelectServer(isSelected ? null : server.id)}
                    className={`p-1 rounded transition-colors ${
                      isSelected ? 'bg-primary/10' : 'hover:bg-accent'
                    }`}
                    title={server.name}
                  >
                    <Circle
                      className={`h-3 w-3 ${isOnline ? 'text-green-500 fill-green-500' : 'text-red-500 fill-red-500'}`}
                    />
                  </button>
                );
              }

              return (
                <button
                  key={server.id}
                  onClick={() => onSelectServer(isSelected ? null : server.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left ${
                    isSelected
                      ? 'bg-primary/10 text-foreground font-medium'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  <Circle
                    className={`h-2.5 w-2.5 shrink-0 ${
                      isOnline ? 'text-green-500 fill-green-500' : 'text-red-500 fill-red-500'
                    }`}
                  />
                  <span className="truncate">{server.name}</span>
                </button>
              );
            })}

            {servers.length === 0 && !collapsed && (
              <p className="px-3 py-2 text-xs text-muted-foreground">No servers found</p>
            )}
          </div>
        )}

        {/* Log source checkboxes */}
        {!collapsed && selectedServer && (
          <div className="px-2 mt-4">
            <h3 className="px-1 pb-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">
              Log Sources
            </h3>
            <div className="space-y-1 py-1">
              {ALL_SOURCES.map((source) => {
                const isAvailable = availableSources.includes(source);
                const isChecked = selectedSources.includes(source);

                return (
                  <label
                    key={source}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer transition-colors ${
                      isAvailable
                        ? 'hover:bg-accent text-foreground'
                        : 'opacity-40 cursor-not-allowed text-muted-foreground'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={!isAvailable}
                      onChange={() => isAvailable && toggleSource(source)}
                      className="rounded border-border accent-primary h-3.5 w-3.5"
                    />
                    <span className="truncate">{source}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

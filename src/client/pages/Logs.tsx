/**
 * Logs page — centralized log viewer with server sidebar and 4-tab layout.
 * Tabs: Live, Analysis, Network, Anomalies.
 * Sidebar selects server + log sources; content area renders the active tab.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollText, BarChart3, Network, AlertTriangle } from 'lucide-react';
import { LogsSidebar } from '@/components/logs/LogsSidebar';
import { LiveLogViewer } from '@/components/logs/LiveLogViewer';
import { LogAnalysisTab } from '@/components/logs/LogAnalysisTab';
import { NetworkTab } from '@/components/logs/NetworkTab';
import { AnomalyTab } from '@/components/logs/AnomalyTab';

// ─── Types ──────────────────────────────────────────────────────────────────

type LogTab = 'live' | 'analysis' | 'network' | 'anomalies';

interface TabDef {
  key: LogTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

// ─── Tab definitions ────────────────────────────────────────────────────────

const TABS: TabDef[] = [
  { key: 'live', label: 'Live Logs', icon: ScrollText },
  { key: 'analysis', label: 'Analysis', icon: BarChart3 },
  { key: 'network', label: 'Network', icon: Network },
  { key: 'anomalies', label: 'Anomalies', icon: AlertTriangle },
];

// ─── Main page ──────────────────────────────────────────────────────────────

export default function LogsPage() {
  const { t } = useTranslation('logs');
  const [selectedServer, setSelectedServer] = useState<number | null>(null);
  const [selectedSources, setSelectedSources] = useState<string[]>(['journalctl', 'syslog']);
  const [activeTab, setActiveTab] = useState<LogTab>('live');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // ─── Render tab content ─────────────────────────────────────────────────

  function renderTabContent() {
    if (!selectedServer) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
          <div className="h-16 w-16 rounded-full bg-muted/50 flex items-center justify-center">
            <ScrollText className="h-8 w-8 text-muted-foreground/50" />
          </div>
          <p className="text-sm font-medium">{t('selectServer', 'Wähle einen Server')}</p>
          <p className="text-xs">{t('selectServerHint', 'Wähle einen Server in der Seitenleiste, um Logs anzuzeigen')}</p>
        </div>
      );
    }

    switch (activeTab) {
      case 'live':
        return <LiveLogViewer serverId={selectedServer} sources={selectedSources} />;
      case 'analysis':
        return <LogAnalysisTab serverId={selectedServer} />;
      case 'network':
        return <NetworkTab serverId={selectedServer} />;
      case 'anomalies':
        return <AnomalyTab serverId={selectedServer} />;
      default:
        return null;
    }
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] -m-6 overflow-hidden">
      {/* Sidebar */}
      <LogsSidebar
        selectedServer={selectedServer}
        onSelectServer={setSelectedServer}
        selectedSources={selectedSources}
        onSelectSources={setSelectedSources}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* Content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tab bar */}
        <div className="flex items-center border-b border-border bg-card/50 px-4">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors relative ${
                  isActive
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                )}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-hidden">
          {renderTabContent()}
        </div>
      </div>
    </div>
  );
}

/**
 * AnomalyTab — network anomaly detection with baseline management,
 * status filtering, bulk actions, and AI assessment display.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Shield, AlertCircle, AlertTriangle, Info, RefreshCw,
  Loader2, Check, CheckCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiCall } from '@/client/hooks/useApi';

// ─── Types ──────────────────────────────────────────────────────────────────

type AnomalyType = 'new_port' | 'closed_port' | 'unknown_ip' | 'mac_change';
type AnomalySeverity = 'critical' | 'high' | 'medium' | 'low';
type AnomalyStatus = 'new' | 'acknowledged' | 'resolved';
type StatusFilter = AnomalyStatus | 'all';

interface Anomaly {
  id: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  status: AnomalyStatus;
  details: Record<string, unknown>;
  aiAssessment?: string;
  timestamp: string;
}

interface AnomalyTabProps {
  serverId: number | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<AnomalyType, string> = {
  new_port: 'Neuer Port',
  closed_port: 'Geschlossener Port',
  unknown_ip: 'Unbekannte IP',
  mac_change: 'MAC-Änderung',
};

const SEVERITY_CONFIG: Record<AnomalySeverity, { icon: typeof AlertCircle; color: string; label: string }> = {
  critical: { icon: AlertCircle, color: 'text-red-500', label: 'Kritisch' },
  high: { icon: AlertTriangle, color: 'text-orange-500', label: 'Hoch' },
  medium: { icon: AlertTriangle, color: 'text-yellow-500', label: 'Mittel' },
  low: { icon: Info, color: 'text-blue-500', label: 'Niedrig' },
};

const STATUS_BADGES: Record<AnomalyStatus, string> = {
  new: 'bg-red-500/15 text-red-600 border-red-500/30',
  acknowledged: 'bg-yellow-500/15 text-yellow-700 border-yellow-500/30',
  resolved: 'bg-green-500/15 text-green-600 border-green-500/30',
};

const STATUS_LABELS: Record<AnomalyStatus, string> = {
  new: 'Neu',
  acknowledged: 'Bestätigt',
  resolved: 'Behoben',
};

function formatDate(ts: string): string {
  return new Date(ts).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─── Component ──────────────────────────────────────────────────────────────

export function AnomalyTab({ serverId }: AnomalyTabProps) {
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hasBaseline, setHasBaseline] = useState<boolean | null>(null);
  const [savingBaseline, setSavingBaseline] = useState(false);
  const [checking, setChecking] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);

  const loadAnomalies = useCallback(async () => {
    if (!serverId) return;
    setLoading(true);
    try {
      const data = await apiCall<Anomaly[]>(`/api/anomalies?serverId=${serverId}`);
      setAnomalies(data || []);
    } catch {
      setAnomalies([]);
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  const checkBaseline = useCallback(async () => {
    if (!serverId) return;
    try {
      const res = await apiCall<{ exists: boolean }>(`/api/anomalies/baseline?serverId=${serverId}`);
      setHasBaseline(res?.exists ?? false);
    } catch {
      setHasBaseline(false);
    }
  }, [serverId]);

  useEffect(() => {
    if (serverId) {
      loadAnomalies();
      checkBaseline();
    } else {
      setAnomalies([]);
      setHasBaseline(null);
    }
  }, [serverId, loadAnomalies, checkBaseline]);

  const saveBaseline = async () => {
    if (!serverId) return;
    setSavingBaseline(true);
    try {
      await apiCall('/api/anomalies/baseline', {
        method: 'POST',
        body: JSON.stringify({ serverId }),
      });
      setHasBaseline(true);
    } catch {
      // error handled by apiCall
    } finally {
      setSavingBaseline(false);
    }
  };

  const runCheck = async () => {
    if (!serverId) return;
    setChecking(true);
    try {
      await apiCall('/api/anomalies/check', {
        method: 'POST',
        body: JSON.stringify({ serverId }),
      });
      await loadAnomalies();
    } catch {
      // error handled by apiCall
    } finally {
      setChecking(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((a) => a.id)));
    }
  };

  const bulkUpdate = async (status: AnomalyStatus) => {
    if (selected.size === 0) return;
    setBulkLoading(true);
    try {
      await apiCall('/api/anomalies/bulk-update', {
        method: 'POST',
        body: JSON.stringify({ ids: Array.from(selected), status }),
      });
      setSelected(new Set());
      await loadAnomalies();
    } catch {
      // error handled by apiCall
    } finally {
      setBulkLoading(false);
    }
  };

  const filtered = anomalies.filter(
    (a) => filter === 'all' || a.status === filter
  );

  const filterButtons: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'Alle' },
    { key: 'new', label: 'Neu' },
    { key: 'acknowledged', label: 'Bestätigt' },
    { key: 'resolved', label: 'Behoben' },
  ];

  if (!serverId) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Shield className="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm">Bitte einen Server auswählen</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-orange-500" />
          <h3 className="text-sm font-semibold">Anomalien</h3>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={saveBaseline}
            disabled={savingBaseline}
          >
            {savingBaseline ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              'Baseline speichern'
            )}
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={runCheck}
            disabled={checking}
          >
            {checking ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                Prüfe...
              </>
            ) : (
              'Prüfen'
            )}
          </Button>
        </div>
      </div>

      {/* Baseline status */}
      {hasBaseline === false && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-blue-500/10 border border-blue-500/30 text-blue-700 dark:text-blue-400 text-xs">
          <Info className="h-4 w-4 shrink-0" />
          <span>Keine Baseline vorhanden. Speichere eine Baseline, um Änderungen zu erkennen.</span>
        </div>
      )}

      {/* Status filters */}
      <div className="flex items-center gap-1.5">
        {filterButtons.map((btn) => (
          <Button
            key={btn.key}
            variant={filter === btn.key ? 'default' : 'ghost'}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => {
              setFilter(btn.key);
              setSelected(new Set());
            }}
          >
            {btn.label}
            {btn.key !== 'all' && (
              <span className="ml-1 text-[10px] opacity-70">
                ({anomalies.filter((a) => a.status === btn.key).length})
              </span>
            )}
          </Button>
        ))}
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/30 border border-border">
          <span className="text-xs text-muted-foreground">
            {selected.size} ausgewählt
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-xs"
            onClick={() => bulkUpdate('acknowledged')}
            disabled={bulkLoading}
          >
            <Check className="h-3 w-3 mr-1" />
            Bestätigen
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-xs"
            onClick={() => bulkUpdate('resolved')}
            disabled={bulkLoading}
          >
            <CheckCheck className="h-3 w-3 mr-1" />
            Beheben
          </Button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-muted/30 rounded animate-pulse" />
          ))}
        </div>
      )}

      {/* Anomaly cards */}
      {!loading && filtered.length === 0 && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          Keine Anomalien gefunden
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="space-y-2">
          {/* Select all */}
          <label className="flex items-center gap-2 px-1 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={selected.size === filtered.length && filtered.length > 0}
              onChange={toggleSelectAll}
              className="rounded border-border accent-primary h-3.5 w-3.5"
            />
            Alle auswählen
          </label>

          {filtered.map((anomaly) => {
            const sevConfig = SEVERITY_CONFIG[anomaly.severity];
            const SevIcon = sevConfig.icon;

            return (
              <div
                key={anomaly.id}
                className={`border border-border rounded-lg p-3 space-y-2 transition-colors ${
                  selected.has(anomaly.id) ? 'bg-primary/5 border-primary/30' : ''
                }`}
              >
                {/* Card header */}
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(anomaly.id)}
                    onChange={() => toggleSelect(anomaly.id)}
                    className="rounded border-border accent-primary h-3.5 w-3.5 mt-0.5 shrink-0"
                  />
                  <SevIcon className={`h-4 w-4 shrink-0 mt-0.5 ${sevConfig.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">
                        {TYPE_LABELS[anomaly.type] || anomaly.type}
                      </span>
                      <Badge className={`${STATUS_BADGES[anomaly.severity === 'critical' ? 'new' : anomaly.severity === 'high' ? 'new' : 'acknowledged']} text-[10px]`}>
                        {sevConfig.label}
                      </Badge>
                      <Badge className={`${STATUS_BADGES[anomaly.status]} text-[10px]`}>
                        {STATUS_LABELS[anomaly.status]}
                      </Badge>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {formatDate(anomaly.timestamp)}
                    </span>
                  </div>
                </div>

                {/* Details */}
                <div className="ml-8 bg-zinc-900 text-zinc-300 rounded-md p-2 overflow-x-auto">
                  <pre className="text-[11px] font-mono whitespace-pre-wrap">
                    {JSON.stringify(anomaly.details, null, 2)}
                  </pre>
                </div>

                {/* AI assessment */}
                {anomaly.aiAssessment && (
                  <div className="ml-8 px-3 py-2 rounded-md bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-300 text-xs">
                    <span className="font-semibold text-[10px] uppercase tracking-wider block mb-1">
                      KI-Bewertung
                    </span>
                    {anomaly.aiAssessment}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

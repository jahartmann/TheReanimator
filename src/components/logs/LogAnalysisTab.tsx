/**
 * LogAnalysisTab — AI-powered log analysis with expandable finding cards.
 * Fetches analysis results and allows triggering new analyses.
 */

import { useEffect, useState } from 'react';
import { Brain, ChevronDown, ChevronRight, RefreshCw, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiCall } from '@/client/hooks/useApi';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Finding {
  id: string;
  title: string;
  severity: 'critical' | 'warning' | 'info';
  explanation: string;
  affectedLines: string[];
  recommendation: string;
}

interface AnalysisResult {
  id: string;
  timestamp: string;
  findings: Finding[];
}

interface LogAnalysisTabProps {
  serverId: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function severityBadge(severity: Finding['severity']) {
  const styles: Record<string, string> = {
    critical: 'bg-red-500/15 text-red-600 border-red-500/30',
    warning: 'bg-yellow-500/15 text-yellow-700 border-yellow-500/30',
    info: 'bg-blue-500/15 text-blue-600 border-blue-500/30',
  };
  const labels: Record<string, string> = {
    critical: 'Kritisch',
    warning: 'Warnung',
    info: 'Info',
  };
  return (
    <Badge className={`${styles[severity]} text-[10px]`}>
      {labels[severity]}
    </Badge>
  );
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─── Component ──────────────────────────────────────────────────────────────

export function LogAnalysisTab({ serverId }: LogAnalysisTabProps) {
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [expandedFindings, setExpandedFindings] = useState<Set<string>>(new Set());

  const loadResults = async () => {
    setLoading(true);
    try {
      const data = await apiCall<AnalysisResult[]>(`/api/logs/analysis?serverId=${serverId}`);
      setResults(data || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadResults();
  }, [serverId]);

  const runAnalysis = async () => {
    setAnalyzing(true);
    try {
      await apiCall('/api/logs/analyze', {
        method: 'POST',
        body: JSON.stringify({ serverId }),
      });
      await loadResults();
    } catch {
      // error handled by apiCall
    } finally {
      setAnalyzing(false);
    }
  };

  const toggleFinding = (id: string) => {
    setExpandedFindings((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Aggregate counts from the latest result
  const latest = results[0];
  const criticalCount = latest?.findings.filter((f) => f.severity === 'critical').length ?? 0;
  const warningCount = latest?.findings.filter((f) => f.severity === 'warning').length ?? 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-purple-500" />
          <h3 className="text-sm font-semibold">KI-Analyse</h3>
          {criticalCount > 0 && (
            <Badge className="bg-red-500/15 text-red-600 border-red-500/30 text-[10px]">
              {criticalCount} Kritisch
            </Badge>
          )}
          {warningCount > 0 && (
            <Badge className="bg-yellow-500/15 text-yellow-700 border-yellow-500/30 text-[10px]">
              {warningCount} Warnung
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={loadResults}
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={runAnalysis}
            disabled={analyzing}
          >
            {analyzing ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                Analysiere...
              </>
            ) : (
              'Jetzt analysieren'
            )}
          </Button>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-muted/30 rounded animate-pulse" />
          ))}
        </div>
      )}

      {/* Analyzing overlay */}
      {analyzing && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          <span className="text-sm">Logs werden analysiert...</span>
        </div>
      )}

      {/* Latest findings */}
      {!loading && !analyzing && latest && (
        <div className="space-y-2">
          {latest.findings.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Keine Auffälligkeiten gefunden
            </div>
          ) : (
            latest.findings.map((finding) => {
              const isExpanded = expandedFindings.has(finding.id);
              return (
                <div
                  key={finding.id}
                  className="border border-border rounded-lg overflow-hidden"
                >
                  {/* Finding header */}
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-accent/50 transition-colors"
                    onClick={() => toggleFinding(finding.id)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium flex-1 truncate">
                      {finding.title}
                    </span>
                    {severityBadge(finding.severity)}
                  </button>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="px-4 pb-3 space-y-3 border-t border-border bg-muted/10">
                      {/* Explanation */}
                      <p className="text-sm text-muted-foreground pt-3">
                        {finding.explanation}
                      </p>

                      {/* Affected lines */}
                      {finding.affectedLines.length > 0 && (
                        <div className="bg-zinc-900 text-zinc-300 rounded-md p-3 overflow-x-auto">
                          <pre className="text-xs font-mono whitespace-pre-wrap">
                            {finding.affectedLines.join('\n')}
                          </pre>
                        </div>
                      )}

                      {/* Recommendation */}
                      {finding.recommendation && (
                        <p className="text-sm text-green-600 dark:text-green-400">
                          {finding.recommendation}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* No results at all */}
      {!loading && !analyzing && results.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Brain className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Noch keine Analyse durchgeführt</p>
          <p className="text-xs mt-1">
            Klicke auf "Jetzt analysieren" um die Logs zu untersuchen
          </p>
        </div>
      )}

      {/* Analysis history */}
      {!loading && results.length > 1 && (
        <div className="mt-6 pt-4 border-t border-border">
          <h4 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-bold mb-2">
            Analyse-Verlauf
          </h4>
          <div className="space-y-1">
            {results.slice(1).map((result) => (
              <div
                key={result.id}
                className="flex items-center justify-between px-3 py-2 rounded-md text-sm hover:bg-accent/30 transition-colors"
              >
                <span className="text-muted-foreground text-xs font-mono">
                  {formatDate(result.timestamp)}
                </span>
                <div className="flex items-center gap-1.5">
                  {result.findings.filter((f) => f.severity === 'critical').length > 0 && (
                    <Badge className="bg-red-500/15 text-red-600 border-red-500/30 text-[10px]">
                      {result.findings.filter((f) => f.severity === 'critical').length} Kritisch
                    </Badge>
                  )}
                  {result.findings.filter((f) => f.severity === 'warning').length > 0 && (
                    <Badge className="bg-yellow-500/15 text-yellow-700 border-yellow-500/30 text-[10px]">
                      {result.findings.filter((f) => f.severity === 'warning').length} Warnung
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {result.findings.length} Befunde
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * LiveLogViewer — real-time log streaming via WebSocket with virtual scrolling.
 * Connects to ws(s)://${host}/ws/logs/${serverId}, subscribes to selected sources.
 * Features: search (regex), severity filter, pause/resume, auto-scroll,
 * download (CSV/JSON/TXT), color-coded severity, virtual scrolling for performance.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Search, Pause, Play, Download, ArrowDown, Filter,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

// ─── Constants ──────────────────────────────────────────────────────────────

const LINE_HEIGHT = 24;
const MAX_ENTRIES = 10_000;
const OVERSCAN = 10;

// ─── Types ──────────────────────────────────────────────────────────────────

interface LogEntry {
  id: number;
  timestamp: string;
  source: string;
  service: string;
  severity: 'error' | 'warning' | 'info' | 'debug';
  message: string;
}

interface LiveLogViewerProps {
  serverId: number;
  sources: string[];
}

type ConnectionStatus = 'LIVE' | 'PAUSED' | 'OFFLINE';

// ─── Severity helpers ───────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  error: 'text-red-400',
  warning: 'text-yellow-400',
  info: 'text-blue-400',
  debug: 'text-gray-500',
};

const SEVERITY_BADGE_COLORS: Record<string, string> = {
  error: 'bg-red-500/20 text-red-400 border-red-500/30',
  warning: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  info: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  debug: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

const STATUS_STYLES: Record<ConnectionStatus, string> = {
  LIVE: 'bg-green-500',
  PAUSED: 'bg-yellow-500',
  OFFLINE: 'bg-red-500',
};

const ALL_SEVERITIES = ['error', 'warning', 'info', 'debug'] as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    } as Intl.DateTimeFormatOptions);
  } catch {
    return ts;
  }
}

function parseSeverity(raw: string): LogEntry['severity'] {
  const lower = raw?.toLowerCase?.() || '';
  if (lower.includes('err') || lower.includes('crit') || lower.includes('emerg') || lower.includes('alert')) return 'error';
  if (lower.includes('warn')) return 'warning';
  if (lower.includes('debug') || lower.includes('trace')) return 'debug';
  return 'info';
}

let entryIdCounter = 0;

// ─── Component ──────────────────────────────────────────────────────────────

export function LiveLogViewer({ serverId, sources }: LiveLogViewerProps) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('OFFLINE');
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string[]>([...ALL_SEVERITIES]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showSeverityDropdown, setShowSeverityDropdown] = useState(false);
  const [showDownloadDropdown, setShowDownloadDropdown] = useState(false);
  const [containerHeight, setContainerHeight] = useState(600);
  const [scrollTop, setScrollTop] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isPausedRef = useRef(false);

  // ─── WebSocket connection ───────────────────────────────────────────────

  useEffect(() => {
    if (!serverId || sources.length === 0) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/logs/${serverId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('LIVE');
      ws.send(JSON.stringify({ type: 'subscribe', sources }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'log' || msg.type === 'entry') {
          const entry: LogEntry = {
            id: ++entryIdCounter,
            timestamp: msg.timestamp || new Date().toISOString(),
            source: msg.source || 'unknown',
            service: msg.service || msg.unit || '',
            severity: parseSeverity(msg.severity || msg.priority || 'info'),
            message: msg.message || msg.line || '',
          };

          setEntries((prev) => {
            const next = [...prev, entry];
            if (next.length > MAX_ENTRIES) {
              return next.slice(next.length - MAX_ENTRIES);
            }
            return next;
          });
        } else if (msg.type === 'batch') {
          const batch: LogEntry[] = (msg.entries || []).map((e: any) => ({
            id: ++entryIdCounter,
            timestamp: e.timestamp || new Date().toISOString(),
            source: e.source || 'unknown',
            service: e.service || e.unit || '',
            severity: parseSeverity(e.severity || e.priority || 'info'),
            message: e.message || e.line || '',
          }));

          setEntries((prev) => {
            const next = [...prev, ...batch];
            if (next.length > MAX_ENTRIES) {
              return next.slice(next.length - MAX_ENTRIES);
            }
            return next;
          });
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      setStatus('OFFLINE');
    };

    ws.onerror = () => {
      setStatus('OFFLINE');
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [serverId, sources]);

  // ─── ResizeObserver for container ─────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ─── Auto-scroll ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (autoScroll && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [entries, autoScroll]);

  // ─── Pause / Resume ──────────────────────────────────────────────────────

  const togglePause = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    if (isPausedRef.current) {
      ws.send(JSON.stringify({ type: 'resume' }));
      setStatus('LIVE');
      isPausedRef.current = false;
    } else {
      ws.send(JSON.stringify({ type: 'pause' }));
      setStatus('PAUSED');
      isPausedRef.current = true;
    }
  }, []);

  // ─── Filtering ────────────────────────────────────────────────────────────

  const filteredEntries = useMemo(() => {
    let result = entries;

    // Severity filter
    if (severityFilter.length < ALL_SEVERITIES.length) {
      result = result.filter((e) => severityFilter.includes(e.severity));
    }

    // Search filter
    if (searchQuery) {
      try {
        const regex = new RegExp(searchQuery, 'i');
        result = result.filter(
          (e) => regex.test(e.message) || regex.test(e.service) || regex.test(e.source)
        );
      } catch {
        // Invalid regex — fall back to plain text search
        const lower = searchQuery.toLowerCase();
        result = result.filter(
          (e) =>
            e.message.toLowerCase().includes(lower) ||
            e.service.toLowerCase().includes(lower) ||
            e.source.toLowerCase().includes(lower)
        );
      }
    }

    return result;
  }, [entries, severityFilter, searchQuery]);

  // ─── Virtual scrolling ────────────────────────────────────────────────────

  const totalHeight = filteredEntries.length * LINE_HEIGHT;
  const visibleCount = Math.ceil(containerHeight / LINE_HEIGHT);
  const startIdx = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(filteredEntries.length, startIdx + visibleCount + OVERSCAN * 2);
  const visibleEntries = filteredEntries.slice(startIdx, endIdx);
  const offsetY = startIdx * LINE_HEIGHT;

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    setScrollTop(target.scrollTop);

    // Disable auto-scroll if user scrolls up
    const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < LINE_HEIGHT * 2;
    setAutoScroll(isAtBottom);
  }, []);

  const jumpToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      setAutoScroll(true);
    }
  }, []);

  // ─── Download ──────────────────────────────────────────────────────────────

  const downloadLogs = useCallback(
    (format: 'csv' | 'json' | 'txt') => {
      let content: string;
      let mimeType: string;
      let extension: string;

      const data = filteredEntries;

      switch (format) {
        case 'csv':
          content =
            'timestamp,source,service,severity,message\n' +
            data
              .map(
                (e) =>
                  `"${e.timestamp}","${e.source}","${e.service}","${e.severity}","${e.message.replace(/"/g, '""')}"`
              )
              .join('\n');
          mimeType = 'text/csv';
          extension = 'csv';
          break;
        case 'json':
          content = JSON.stringify(data, null, 2);
          mimeType = 'application/json';
          extension = 'json';
          break;
        case 'txt':
        default:
          content = data
            .map((e) => `${e.timestamp} [${e.severity.toUpperCase()}] ${e.source}/${e.service}: ${e.message}`)
            .join('\n');
          mimeType = 'text/plain';
          extension = 'txt';
          break;
      }

      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `logs-server${serverId}-${new Date().toISOString().slice(0, 19)}.${extension}`;
      a.click();
      URL.revokeObjectURL(url);
      setShowDownloadDropdown(false);
    },
    [filteredEntries, serverId]
  );

  // ─── Search match highlighting ────────────────────────────────────────────

  const highlightMatch = useCallback(
    (text: string) => {
      if (!searchQuery) return text;
      try {
        const regex = new RegExp(`(${searchQuery})`, 'gi');
        const parts = text.split(regex);
        return parts.map((part, i) =>
          regex.test(part) ? (
            <mark key={i} className="bg-yellow-400/30 text-yellow-200 rounded px-0.5">
              {part}
            </mark>
          ) : (
            part
          )
        );
      } catch {
        return text;
      }
    },
    [searchQuery]
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-3 border-b border-border bg-card/80 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search logs (regex supported)..."
            className="w-full pl-9 pr-3 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Severity filter */}
        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSeverityDropdown(!showSeverityDropdown)}
            className="gap-1.5"
          >
            <Filter className="h-3.5 w-3.5" />
            Severity
            <ChevronDown className="h-3 w-3" />
          </Button>
          {showSeverityDropdown && (
            <div className="absolute top-full right-0 mt-1 w-40 bg-popover border border-border rounded-md shadow-lg z-50 py-1">
              {ALL_SEVERITIES.map((sev) => (
                <label
                  key={sev}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={severityFilter.includes(sev)}
                    onChange={() =>
                      setSeverityFilter((prev) =>
                        prev.includes(sev) ? prev.filter((s) => s !== sev) : [...prev, sev]
                      )
                    }
                    className="rounded border-border accent-primary h-3.5 w-3.5"
                  />
                  <span className={`capitalize ${SEVERITY_COLORS[sev]}`}>{sev}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Pause / Resume */}
        <Button
          variant="outline"
          size="sm"
          onClick={togglePause}
          disabled={status === 'OFFLINE'}
          className="gap-1.5"
        >
          {status === 'PAUSED' ? (
            <>
              <Play className="h-3.5 w-3.5" /> Resume
            </>
          ) : (
            <>
              <Pause className="h-3.5 w-3.5" /> Pause
            </>
          )}
        </Button>

        {/* Download */}
        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDownloadDropdown(!showDownloadDropdown)}
            className="gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            Export
            <ChevronDown className="h-3 w-3" />
          </Button>
          {showDownloadDropdown && (
            <div className="absolute top-full right-0 mt-1 w-32 bg-popover border border-border rounded-md shadow-lg z-50 py-1">
              {(['csv', 'json', 'txt'] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => downloadLogs(fmt)}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent"
                >
                  {fmt.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Status badge */}
        <div className="flex items-center gap-1.5 ml-auto">
          <div className={`h-2 w-2 rounded-full ${STATUS_STYLES[status]} ${status === 'LIVE' ? 'animate-pulse' : ''}`} />
          <span className={`text-xs font-mono font-medium ${
            status === 'LIVE' ? 'text-green-400' : status === 'PAUSED' ? 'text-yellow-400' : 'text-red-400'
          }`}>
            {status}
          </span>
        </div>
      </div>

      {/* Log viewport */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden bg-gray-950 dark:bg-gray-950">
        <div
          ref={scrollContainerRef}
          className="absolute inset-0 overflow-y-auto font-mono text-xs"
          onScroll={handleScroll}
        >
          <div style={{ height: totalHeight, position: 'relative' }}>
            <div style={{ transform: `translateY(${offsetY}px)` }}>
              {visibleEntries.map((entry) => (
                <div
                  key={entry.id}
                  className={`flex items-center gap-2 px-3 hover:bg-white/5 ${SEVERITY_COLORS[entry.severity]}`}
                  style={{ height: LINE_HEIGHT }}
                >
                  {/* Timestamp */}
                  <span className="text-gray-500 shrink-0 w-[90px]">
                    {formatTimestamp(entry.timestamp)}
                  </span>

                  {/* Source badge */}
                  <span
                    className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                      SEVERITY_BADGE_COLORS[entry.severity] || SEVERITY_BADGE_COLORS.info
                    }`}
                  >
                    {entry.source}
                  </span>

                  {/* Service name */}
                  {entry.service && (
                    <span className="text-gray-400 shrink-0 max-w-[120px] truncate">
                      {entry.service}
                    </span>
                  )}

                  {/* Message */}
                  <span className="truncate">{highlightMatch(entry.message)}</span>
                </div>
              ))}
            </div>
          </div>

          {filteredEntries.length === 0 && (
            <div className="flex items-center justify-center h-full text-gray-500">
              {entries.length === 0 ? 'Waiting for log entries...' : 'No entries match current filters'}
            </div>
          )}
        </div>

        {/* Jump to bottom */}
        {!autoScroll && filteredEntries.length > 0 && (
          <button
            onClick={jumpToBottom}
            className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium shadow-lg hover:bg-primary/90 transition-colors"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            Jump to bottom
          </button>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-border bg-card/80 text-xs text-muted-foreground">
        <span>
          {filteredEntries.length.toLocaleString()} entries
          {filteredEntries.length !== entries.length && (
            <span className="ml-1">({entries.length.toLocaleString()} total)</span>
          )}
        </span>
        {!autoScroll && (
          <button onClick={jumpToBottom} className="text-primary hover:underline">
            Jump to bottom
          </button>
        )}
      </div>
    </div>
  );
}

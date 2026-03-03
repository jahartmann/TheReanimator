/**
 * Console Terminal page - xterm.js WebSocket terminal for a server/VM.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import '@xterm/xterm/css/xterm.css';

// ─── ConsoleTerminal page ─────────────────────────────────────────────────────

export default function ConsoleTerminalPage() {
  const { id: serverId, vmid } = useParams<{ id: string; vmid: string }>();
  const navigate = useNavigate();
  const termDivRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

  useEffect(() => {
    let mounted = true;
    let ws: WebSocket;
    let terminal: any;
    let fitAddon: any;

    (async () => {
      // Dynamic import to avoid SSR issues and ensure CSS is loaded
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-web-links'),
      ]);

      if (!mounted || !termDivRef.current) return;

      terminal = new Terminal({
        cursorBlink: true,
        fontFamily: '"Fira Code", "Cascadia Code", "JetBrains Mono", Consolas, monospace',
        fontSize: 14,
        theme: {
          background: '#0d1117',
          foreground: '#e6edf3',
          cursor: '#58a6ff',
          selectionBackground: '#264f78',
          black: '#484f58',
          red: '#ff7b72',
          green: '#3fb950',
          yellow: '#d29922',
          blue: '#58a6ff',
          magenta: '#bc8cff',
          cyan: '#39c5cf',
          white: '#b1bac4',
          brightBlack: '#6e7681',
          brightRed: '#ffa198',
          brightGreen: '#56d364',
          brightYellow: '#e3b341',
          brightBlue: '#79c0ff',
          brightMagenta: '#d2a8ff',
          brightCyan: '#56d4dd',
          brightWhite: '#f0f6fc',
        },
      });

      fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(webLinksAddon);
      terminal.open(termDivRef.current);
      fitAddon.fit();

      termRef.current = terminal;
      fitAddonRef.current = fitAddon;

      // Connect WebSocket
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/ws/terminal/${serverId}-${vmid}`;
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mounted) return;
        // Send initial size
        try {
          ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
        } catch {}
      };

      ws.onmessage = (evt) => {
        if (!mounted) return;
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'output') {
            terminal.write(msg.data);
          } else if (msg.type === 'status') {
            if (mounted) setStatus(msg.status === 'connected' ? 'connected' : 'disconnected');
          }
        } catch {}
      };

      ws.onerror = () => {
        if (mounted) setStatus('disconnected');
      };

      ws.onclose = () => {
        if (mounted) setStatus('disconnected');
      };

      // Send input
      terminal.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data }));
        }
      });

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        try {
          fitAddon.fit();
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
          }
        } catch {}
      });

      if (termDivRef.current) {
        resizeObserver.observe(termDivRef.current);
      }

      // Cleanup stored so unmount can use them
      (termDivRef as any)._cleanup = () => {
        resizeObserver.disconnect();
        terminal.dispose();
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, 'Component unmounted');
        }
      };
    })();

    return () => {
      mounted = false;
      if ((termDivRef as any)._cleanup) {
        (termDivRef as any)._cleanup();
      } else {
        if (wsRef.current) {
          wsRef.current.close(1000, 'Component unmounted');
        }
        if (termRef.current) {
          termRef.current.dispose();
        }
      }
    };
  }, [serverId, vmid]);

  return (
    <div className="flex flex-col h-full min-h-screen bg-[#0d1117]">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#161b22] border-b border-[#30363d] shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-400 hover:text-white hover:bg-slate-700"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-mono">
              server:{serverId} vm:{vmid}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Circle
            className={`h-2.5 w-2.5 fill-current ${
              status === 'connected'
                ? 'text-green-500'
                : status === 'connecting'
                ? 'text-amber-500 animate-pulse'
                : 'text-red-500'
            }`}
          />
          <span className="text-xs text-slate-400">
            {status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting...' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Terminal container */}
      <div className="flex-1 overflow-hidden p-2">
        <div
          ref={termDivRef}
          className="h-full w-full"
          style={{ minHeight: 0 }}
        />
      </div>

      {status === 'disconnected' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none">
          <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-6 text-center pointer-events-auto">
            <p className="text-slate-300 mb-4">Connection closed</p>
            <Button
              size="sm"
              onClick={() => window.location.reload()}
            >
              Reconnect
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";

interface DiffLine {
    type: 'unchanged' | 'added' | 'removed' | 'modified';
    lineNumber: { backup: number | null; live: number | null };
    content: string;
    originalContent?: string;
    detection?: {
        type: string;
        oldValue: string;
        newValue: string;
        description: { de: string; en: string };
    };
}

interface DiffResult {
    filePath: string;
    identical: boolean;
    changedLines: number;
    lines: DiffLine[];
    detections: any[];
    backupExists: boolean;
    liveExists: boolean;
    backupContent: string | null;
    liveContent: string | null;
}

export interface UUIDMappingEntry {
    oldUUID: string;
    newUUID: string;
    device: string;
    mountpoint: string;
    fstype: string;
    confidence: 'high' | 'medium' | 'low';
    description: { de: string; en: string };
}

interface ConfigDiffViewProps {
    diff: DiffResult;
    filePath: string;
    action: string;
    onMergedContentChange: (content: string) => void;
    locale: string;
    /** Contextual description generated from actual diff analysis */
    contextInfo?: string | null;
    /** Previously saved merged content (persisted in parent state) */
    savedContent?: string | null;
    /** UUID mappings for fstab files (old → new UUIDs from blkid) */
    uuidMappings?: UUIDMappingEntry[] | null;
}

export default function ConfigDiffView({
    diff,
    filePath,
    action,
    onMergedContentChange,
    locale,
    contextInfo,
    savedContent,
    uuidMappings,
}: ConfigDiffViewProps) {
    const [editorContent, setEditorContent] = useState('');
    const [showDiff, setShowDiff] = useState(true);
    const [copied, setCopied] = useState<'backup' | 'live' | null>(null);
    const editorRef = useRef<HTMLTextAreaElement>(null);

    // When file changes: restore saved content if available, otherwise use defaults
    useEffect(() => {
        if (savedContent != null && savedContent !== '') {
            // User already edited this file - restore their work
            setEditorContent(savedContent);
        } else {
            // First time viewing - use backup or live as base
            const content = action === 'merge'
                ? (diff.backupContent || diff.liveContent || '')
                : (diff.backupContent || '');
            setEditorContent(content);
        }
    }, [filePath]); // Only on file switch

    // Auto-save changes to parent when editor content changes
    const onChangeRef = useRef(onMergedContentChange);
    onChangeRef.current = onMergedContentChange;
    const isInitialMount = useRef(true);
    useEffect(() => {
        // Skip the initial mount to avoid overwriting parent state with default content
        if (isInitialMount.current) {
            isInitialMount.current = false;
            return;
        }
        onChangeRef.current(editorContent);
    }, [editorContent]);

    // Reset the initial mount flag when file changes
    useEffect(() => {
        isInitialMount.current = true;
    }, [filePath]);

    const copyContent = (content: string | null, side: 'backup' | 'live') => {
        if (content) {
            navigator.clipboard.writeText(content);
            setCopied(side);
            setTimeout(() => setCopied(null), 1500);
        }
    };

    const useBackupContent = () => {
        if (diff.backupContent) {
            setEditorContent(diff.backupContent);
        }
    };

    const useLiveContent = () => {
        if (diff.liveContent) {
            setEditorContent(diff.liveContent);
        }
    };

    // Apply UUID mappings to current editor content
    const applyUUIDMappings = () => {
        if (!uuidMappings || uuidMappings.length === 0) return;
        let result = editorContent;
        for (const mapping of uuidMappings) {
            result = result.replace(
                new RegExp(mapping.oldUUID.replace(/[-]/g, '[-]'), 'g'),
                mapping.newUUID
            );
        }
        setEditorContent(result);
    };

    const detections = diff.detections || [];
    const isFstab = filePath.endsWith('etc/fstab');
    const isLiveEmpty = !diff.liveContent || diff.liveContent.trim() === '' ||
        diff.liveContent.split('\n').filter(l => l.trim() && !l.startsWith('#')).length === 0;

    return (
        <div className="space-y-3 h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                    <h4 className="font-medium text-sm font-mono">/{filePath}</h4>
                    {diff.identical ? (
                        <Badge variant="outline" className="text-green-500 border-green-500/30 text-[10px]">
                            {locale === 'de' ? 'Identisch' : 'Identical'}
                        </Badge>
                    ) : (
                        <Badge variant="outline" className="text-amber-500 border-amber-500/30 text-[10px]">
                            {diff.changedLines} {locale === 'de' ? 'Änderungen' : 'changes'}
                        </Badge>
                    )}
                </div>
            </div>

            {/* Context info - individual analysis of this file */}
            {contextInfo && (
                <div className="p-2.5 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs text-blue-300 leading-relaxed shrink-0">
                    {contextInfo}
                </div>
            )}

            {/* Detections */}
            {detections.length > 0 && (
                <div className="space-y-1 shrink-0">
                    {detections.map((d: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 p-2 rounded bg-amber-500/5 border border-amber-500/20 text-xs">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                            <span>{locale === 'de' ? d.description.de : d.description.en}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* fstab special case: disks replaced, live is empty */}
            {isFstab && isLiveEmpty && diff.backupExists && (
                <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 shrink-0 space-y-2">
                    <div className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                        <div className="text-xs space-y-1">
                            <p className="font-medium text-amber-400">
                                {locale === 'de'
                                    ? 'Festplatten-Sonderfall: Live-fstab ist leer'
                                    : 'Disk special case: Live fstab is empty'}
                            </p>
                            <p className="text-muted-foreground">
                                {locale === 'de'
                                    ? 'Die Festplatten wurden vermutlich komplett getauscht und die Storages sind noch nicht eingerichtet. Das Backup-fstab enthält die alte Konfiguration mit den alten UUIDs. Sie können die Backup-Struktur als Ausgangsbasis verwenden und die UUIDs manuell anpassen, oder — falls neue Platten erkannt wurden — das automatische UUID-Mapping nutzen.'
                                    : 'Disks were likely fully replaced and storages are not set up yet. The backup fstab contains the old configuration with old UUIDs. You can use the backup structure as a starting point and adjust UUIDs manually, or — if new disks are detected — use the automatic UUID mapping.'}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* UUID mapping helper for fstab */}
            {isFstab && uuidMappings && uuidMappings.length > 0 && (
                <div className="p-3 rounded-lg bg-green-500/5 border border-green-500/20 shrink-0 space-y-2">
                    <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-green-400">
                            {locale === 'de'
                                ? `${uuidMappings.length} UUID-Zuordnung${uuidMappings.length !== 1 ? 'en' : ''} erkannt`
                                : `${uuidMappings.length} UUID mapping${uuidMappings.length !== 1 ? 's' : ''} detected`}
                        </p>
                        <Button
                            size="sm"
                            variant="secondary"
                            className="h-6 text-[10px] px-2 bg-green-600/20 hover:bg-green-600/30 text-green-400"
                            onClick={applyUUIDMappings}
                        >
                            {locale === 'de' ? 'UUIDs im Editor ersetzen' : 'Replace UUIDs in editor'}
                        </Button>
                    </div>
                    <div className="space-y-1">
                        {uuidMappings.map((m, i) => (
                            <div key={i} className="text-[10px] font-mono flex items-center gap-2 text-muted-foreground">
                                <span className={`px-1 rounded ${
                                    m.confidence === 'high' ? 'bg-green-500/20 text-green-400' :
                                    m.confidence === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                                    'bg-red-500/20 text-red-400'
                                }`}>
                                    {m.confidence}
                                </span>
                                <span className="text-red-400">{m.oldUUID.substring(0, 8)}...</span>
                                <span>→</span>
                                <span className="text-green-400">{m.newUUID.substring(0, 8)}...</span>
                                <span className="text-muted-foreground/60">{m.mountpoint} ({m.device})</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* fstab: no mappings found but UUIDs differ */}
            {isFstab && uuidMappings && uuidMappings.length === 0 && !diff.identical && (
                <div className="p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs text-amber-300 shrink-0">
                    {locale === 'de'
                        ? 'Keine automatischen UUID-Zuordnungen möglich. Die neuen Festplatten wurden noch nicht erkannt (blkid leer). Richten Sie zuerst die Storages ein (z.B. ZFS-Pool erstellen, LVM anlegen), dann laden Sie diese Seite neu.'
                        : 'No automatic UUID mappings possible. New disks not yet detected (blkid empty). Set up storages first (e.g. create ZFS pool, set up LVM), then reload this page.'}
                </div>
            )}

            {/* File states */}
            {!diff.backupExists && (
                <div className="p-2 rounded bg-blue-500/10 text-xs text-blue-400 shrink-0">
                    {locale === 'de' ? 'Datei existiert nicht im Backup' : 'File does not exist in backup'}
                </div>
            )}
            {!diff.liveExists && (
                <div className="p-2 rounded bg-amber-500/10 text-xs text-amber-400 shrink-0">
                    {locale === 'de' ? 'Datei existiert nicht auf dem Server' : 'File does not exist on server'}
                </div>
            )}

            {/* Collapsible Diff View */}
            <div className="border rounded-lg overflow-hidden shrink-0">
                <button
                    onClick={() => setShowDiff(!showDiff)}
                    className="w-full flex items-center justify-between px-3 py-1.5 bg-muted/30 hover:bg-muted/50 transition-colors text-xs"
                >
                    <span className="font-medium">
                        {locale === 'de' ? 'Vergleich: Backup vs. Live' : 'Comparison: Backup vs. Live'}
                    </span>
                    {showDiff ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>

                {showDiff && (
                    <>
                        <div className="grid grid-cols-2 bg-muted/20 border-b border-t text-xs">
                            <div className="px-3 py-1 font-medium flex items-center justify-between border-r">
                                <span>Backup</span>
                                <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => copyContent(diff.backupContent, 'backup')}>
                                    {copied === 'backup' ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                                </Button>
                            </div>
                            <div className="px-3 py-1 font-medium flex items-center justify-between">
                                <span>Live</span>
                                <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => copyContent(diff.liveContent, 'live')}>
                                    {copied === 'live' ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                                </Button>
                            </div>
                        </div>

                        <div className="max-h-[350px] overflow-auto">
                            <div className="font-mono text-xs">
                                {diff.lines.map((line, i) => {
                                    const bgClass = {
                                        unchanged: '',
                                        added: 'bg-green-500/10',
                                        removed: 'bg-red-500/10',
                                        modified: 'bg-amber-500/10',
                                    }[line.type];

                                    return (
                                        <div key={i} className={`grid grid-cols-2 ${bgClass} hover:bg-white/5 transition-colors`}>
                                            {/* Backup side */}
                                            <div className="flex border-r border-border/20">
                                                <span className="w-8 text-right px-1 text-muted-foreground/50 select-none shrink-0 border-r border-border/10">
                                                    {line.type === 'added' ? '' : (line.lineNumber.backup ?? '')}
                                                </span>
                                                <span className={`px-2 py-0.5 whitespace-pre break-all ${line.type === 'removed' ? 'text-red-400' :
                                                    line.type === 'modified' ? 'text-amber-400' : ''
                                                    }`}>
                                                    {line.type === 'added' ? '' :
                                                        line.type === 'modified' ? (line.originalContent || line.content) :
                                                            line.content}
                                                </span>
                                            </div>
                                            {/* Live side */}
                                            <div className="flex">
                                                <span className="w-8 text-right px-1 text-muted-foreground/50 select-none shrink-0 border-r border-border/10">
                                                    {line.type === 'removed' ? '' : (line.lineNumber.live ?? '')}
                                                </span>
                                                <span className={`px-2 py-0.5 whitespace-pre break-all ${line.type === 'added' ? 'text-green-400' :
                                                    line.type === 'modified' ? 'text-blue-400' : ''
                                                    }`}>
                                                    {line.type === 'removed' ? '' : line.content}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Always-visible inline editor */}
            <div className="border rounded-lg overflow-hidden flex-1 min-h-0 flex flex-col">
                <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b text-xs">
                    <span className="font-medium">
                        {locale === 'de' ? 'Ergebnis (direkt bearbeiten)' : 'Result (edit directly)'}
                    </span>
                    <div className="flex gap-1">
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-[10px] px-2"
                            onClick={useBackupContent}
                            disabled={!diff.backupContent}
                        >
                            {locale === 'de' ? 'Backup nutzen' : 'Use backup'}
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-[10px] px-2"
                            onClick={useLiveContent}
                            disabled={!diff.liveContent}
                        >
                            {locale === 'de' ? 'Live nutzen' : 'Use live'}
                        </Button>
                    </div>
                </div>
                <textarea
                    ref={editorRef}
                    value={editorContent}
                    onChange={(e) => setEditorContent(e.target.value)}
                    className="flex-1 min-h-[200px] w-full bg-black/20 font-mono text-xs p-3 resize-none focus:outline-none focus:ring-1 focus:ring-primary/30 border-0"
                    spellCheck={false}
                    placeholder={locale === 'de' ? 'Inhalt hier bearbeiten...' : 'Edit content here...'}
                />
            </div>
        </div>
    );
}

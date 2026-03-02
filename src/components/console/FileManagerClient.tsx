'use client';

import { useState, useEffect, useCallback } from 'react';
import { listRemoteFiles, createRemoteDirectory, deleteRemoteItem, type FileEntry } from '@/lib/actions/console';
import { useTranslations, useLocale } from 'next-intl';
import { Folder, File, ArrowUp, RefreshCw, Trash2, Upload, Download, FolderPlus, ChevronRight, Loader2, AlertCircle, X } from 'lucide-react';

interface FileManagerProps {
    serverId: number;
    vmid: string;
}

export default function FileManagerClient({ serverId, vmid }: FileManagerProps) {
    const t = useTranslations('console');
    const locale = useLocale();
    const [currentPath, setCurrentPath] = useState('/root');
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [pathInput, setPathInput] = useState('/root');
    const [showNewFolder, setShowNewFolder] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

    const loadFiles = useCallback(async (path: string) => {
        setLoading(true);
        setError(null);
        try {
            const entries = await listRemoteFiles(serverId, path);
            setFiles(entries);
            setCurrentPath(path);
            setPathInput(path);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [serverId]);

    useEffect(() => { loadFiles(currentPath); }, []);

    const navigateTo = (name: string) => {
        const newPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
        loadFiles(newPath);
    };

    const navigateUp = () => {
        const parent = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/';
        loadFiles(parent);
    };

    const handlePathSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        loadFiles(pathInput || '/');
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const droppedFiles = e.dataTransfer.files;
        if (!droppedFiles.length) return;

        setUploading(true);
        try {
            for (const file of Array.from(droppedFiles)) {
                if (file.size > 100 * 1024 * 1024) {
                    setError(t('maxSizeExceeded'));
                    continue;
                }
                const formData = new FormData();
                formData.append('file', file);
                formData.append('serverId', serverId.toString());
                formData.append('remotePath', currentPath);

                const res = await fetch(`/${locale}/api/files/upload`, { method: 'POST', body: formData });
                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.error || 'Upload failed');
                }
            }
            await loadFiles(currentPath);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setUploading(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFiles = e.target.files;
        if (!selectedFiles?.length) return;

        setUploading(true);
        try {
            for (const file of Array.from(selectedFiles)) {
                if (file.size > 100 * 1024 * 1024) {
                    setError(t('maxSizeExceeded'));
                    continue;
                }
                const formData = new FormData();
                formData.append('file', file);
                formData.append('serverId', serverId.toString());
                formData.append('remotePath', currentPath);

                const res = await fetch(`/${locale}/api/files/upload`, { method: 'POST', body: formData });
                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.error || 'Upload failed');
                }
            }
            await loadFiles(currentPath);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setUploading(false);
            e.target.value = '';
        }
    };

    const handleDownload = (name: string) => {
        const filePath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
        window.open(`/${locale}/api/files/download?serverId=${serverId}&path=${encodeURIComponent(filePath)}`, '_blank');
    };

    const handleCreateFolder = async () => {
        if (!newFolderName.trim()) return;
        const fullPath = currentPath === '/' ? `/${newFolderName}` : `${currentPath}/${newFolderName}`;
        const result = await createRemoteDirectory(serverId, fullPath);
        if (result.success) {
            setShowNewFolder(false);
            setNewFolderName('');
            await loadFiles(currentPath);
        } else {
            setError(result.error || 'Failed');
        }
    };

    const handleDelete = async (name: string) => {
        const fullPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
        const result = await deleteRemoteItem(serverId, fullPath);
        if (result.success) {
            setDeleteTarget(null);
            await loadFiles(currentPath);
        } else {
            setError(result.error || 'Failed');
        }
    };

    const formatSize = (bytes: number) => {
        if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
        if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
        if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${bytes} B`;
    };

    const pathParts = currentPath.split('/').filter(Boolean);

    return (
        <div className="flex flex-col h-full">
            {/* Toolbar */}
            <div className="flex items-center gap-2 p-3 border-b bg-card/50 backdrop-blur-sm">
                <button
                    onClick={navigateUp}
                    disabled={currentPath === '/'}
                    className="p-1.5 rounded-lg hover:bg-muted/50 border border-transparent hover:border-border/50 disabled:opacity-20 transition-all"
                >
                    <ArrowUp className="h-4 w-4" />
                </button>
                <button
                    onClick={() => loadFiles(currentPath)}
                    className="p-1.5 rounded-lg hover:bg-muted/50 border border-transparent hover:border-border/50 transition-all"
                >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </button>

                {/* Path input */}
                <form onSubmit={handlePathSubmit} className="flex-1">
                    <input
                        value={pathInput}
                        onChange={(e) => setPathInput(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm bg-background/80 border border-border/50 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
                        placeholder="/path/to/directory"
                    />
                </form>

                <button
                    onClick={() => setShowNewFolder(true)}
                    className="p-1.5 rounded-lg hover:bg-muted/50 border border-transparent hover:border-border/50 transition-all"
                    title={t('newFolder')}
                >
                    <FolderPlus className="h-4 w-4" />
                </button>
                <label
                    className="p-1.5 rounded-lg hover:bg-muted/50 border border-transparent hover:border-border/50 cursor-pointer transition-all"
                    title={t('uploadFile')}
                >
                    <Upload className="h-4 w-4" />
                    <input type="file" multiple className="hidden" onChange={handleFileUpload} />
                </label>
            </div>

            {/* Breadcrumb */}
            <div className="flex items-center gap-1 px-4 py-2 text-xs text-muted-foreground/60 border-b bg-muted/10 overflow-x-auto">
                <button onClick={() => loadFiles('/')} className="hover:text-foreground transition-colors font-mono">/</button>
                {pathParts.map((part, i) => (
                    <span key={i} className="flex items-center gap-1">
                        <ChevronRight className="h-3 w-3 opacity-40" />
                        <button
                            onClick={() => loadFiles('/' + pathParts.slice(0, i + 1).join('/'))}
                            className="hover:text-foreground transition-colors font-mono"
                        >
                            {part}
                        </button>
                    </span>
                ))}
            </div>

            {/* New Folder Dialog */}
            {showNewFolder && (
                <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-primary/5">
                    <FolderPlus className="h-4 w-4 text-primary/60" />
                    <input
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                        placeholder={t('newFolder')}
                        className="flex-1 px-2.5 py-1 text-sm bg-background/80 border border-border/50 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/30"
                        autoFocus
                    />
                    <button onClick={handleCreateFolder} className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors">OK</button>
                    <button onClick={() => { setShowNewFolder(false); setNewFolderName(''); }} className="text-xs px-3 py-1.5 rounded-lg hover:bg-muted/50 transition-colors">{t('cancel')}</button>
                </div>
            )}

            {/* Error */}
            {error && (
                <div className="flex items-center gap-2 px-4 py-2.5 text-sm text-red-400 bg-red-500/5 border-b border-red-500/10">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span className="flex-1 text-xs">{error}</span>
                    <button onClick={() => setError(null)} className="p-0.5 hover:bg-red-500/10 rounded transition-colors">
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            )}

            {/* Delete Confirmation */}
            {deleteTarget && (
                <div className="flex items-center gap-2 px-4 py-2.5 text-sm bg-red-500/5 border-b border-red-500/10">
                    <span className="text-xs">{t('confirmDelete')}: <strong className="text-red-400">{deleteTarget}</strong>?</span>
                    <button onClick={() => handleDelete(deleteTarget)} className="text-[11px] px-3 py-1 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors">{t('deleteItem')}</button>
                    <button onClick={() => setDeleteTarget(null)} className="text-[11px] px-3 py-1 rounded-lg hover:bg-muted/50 transition-colors">{t('cancel')}</button>
                </div>
            )}

            {/* Drop Zone + File List */}
            <div
                className={`flex-1 overflow-y-auto transition-all ${dragOver ? 'bg-primary/5 ring-2 ring-primary/20 ring-inset' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
            >
                {uploading && (
                    <div className="px-4 py-3 text-xs text-muted-foreground flex items-center gap-2 border-b bg-primary/5">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        {t('uploading')}
                    </div>
                )}

                {dragOver && (
                    <div className="px-4 py-10 text-center">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border-2 border-dashed border-primary/30 mb-3">
                            <Upload className="h-7 w-7 text-primary/60" />
                        </div>
                        <p className="text-sm text-primary/80 font-medium">{t('dropHere')}</p>
                    </div>
                )}

                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 className="h-5 w-5 animate-spin text-primary/60" />
                    </div>
                ) : files.length === 0 ? (
                    <div className="text-center py-16">
                        <Folder className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
                        <p className="text-sm text-muted-foreground">{t('emptyDirectory')}</p>
                    </div>
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground/50">
                                <th className="text-left px-4 py-2 font-semibold">Name</th>
                                <th className="text-right px-4 py-2 font-semibold">Size</th>
                                <th className="text-left px-4 py-2 font-semibold">Permissions</th>
                                <th className="text-left px-4 py-2 font-semibold">Modified</th>
                                <th className="text-right px-4 py-2 font-semibold"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {files
                                .sort((a, b) => {
                                    if (a.type === 'directory' && b.type !== 'directory') return -1;
                                    if (a.type !== 'directory' && b.type === 'directory') return 1;
                                    return a.name.localeCompare(b.name);
                                })
                                .map((file) => (
                                    <tr
                                        key={file.name}
                                        className="border-b last:border-0 hover:bg-muted/20 transition-colors group"
                                    >
                                        <td className="px-4 py-2.5">
                                            <button
                                                onClick={() => file.type === 'directory' ? navigateTo(file.name) : handleDownload(file.name)}
                                                className="flex items-center gap-2.5 hover:text-primary transition-colors"
                                            >
                                                {file.type === 'directory' ? (
                                                    <Folder className="h-4 w-4 text-blue-400/80" />
                                                ) : (
                                                    <File className="h-4 w-4 text-muted-foreground/50" />
                                                )}
                                                <span className={file.type === 'directory' ? 'font-medium' : 'text-muted-foreground'}>{file.name}</span>
                                            </button>
                                        </td>
                                        <td className="px-4 py-2.5 text-right text-muted-foreground/60 font-mono text-xs">
                                            {file.type === 'directory' ? '\u2014' : formatSize(file.size)}
                                        </td>
                                        <td className="px-4 py-2.5 text-muted-foreground/50 font-mono text-xs">{file.permissions}</td>
                                        <td className="px-4 py-2.5 text-muted-foreground/50 text-xs">{file.modified}</td>
                                        <td className="px-4 py-2.5 text-right">
                                            <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                                {file.type !== 'directory' && (
                                                    <button onClick={() => handleDownload(file.name)} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors" title={t('downloadFile')}>
                                                        <Download className="h-3.5 w-3.5" />
                                                    </button>
                                                )}
                                                <button onClick={() => setDeleteTarget(file.name)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400/70 hover:text-red-400 transition-colors" title={t('deleteItem')}>
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}

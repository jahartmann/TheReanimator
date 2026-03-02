'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
    Folder, File, Upload, Download, Trash2, FolderPlus,
    ArrowUp, RefreshCw, Loader2, AlertTriangle
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
    listRemoteFiles, downloadFileFromVM, uploadFileToVM,
    createRemoteDir, deleteRemoteFile
} from '@/lib/actions/file-transfer';
import type { FileEntry } from '@/lib/actions/file-transfer';

interface FileExplorerProps {
    serverId: number;
    vmid: number;
    vmType: 'qemu' | 'lxc';
    compact?: boolean;
}

export function FileExplorer({ serverId, vmid, vmType, compact = false }: FileExplorerProps) {
    const t = useTranslations('console');
    const [currentPath, setCurrentPath] = useState('/');
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<string | null>(null);
    const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
    const [newDirDialog, setNewDirDialog] = useState(false);
    const [newDirName, setNewDirName] = useState('');
    const [deleteDialog, setDeleteDialog] = useState<FileEntry | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const loadFiles = useCallback(async (path: string) => {
        setLoading(true);
        try {
            const entries = await listRemoteFiles(serverId, vmid, vmType, path);
            setFiles(entries);
            setCurrentPath(path);
            setSelectedFile(null);
        } catch (err) {
            toast.error(`Failed to load directory: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setLoading(false);
        }
    }, [serverId, vmid, vmType]);

    useEffect(() => {
        loadFiles('/');
    }, [loadFiles]);

    const navigateTo = (entry: FileEntry) => {
        if (entry.isDir) {
            const newPath = currentPath === '/'
                ? `/${entry.name}`
                : `${currentPath}/${entry.name}`;
            loadFiles(newPath);
        }
    };

    const goUp = () => {
        if (currentPath === '/') return;
        const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
        loadFiles(parent);
    };

    const handleDownload = async (entry: FileEntry) => {
        if (entry.isDir) {
            toast.error('Cannot download directories');
            return;
        }

        const fullPath = currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`;

        try {
            toast.info(`Downloading ${entry.name}...`);
            const result = await downloadFileFromVM(serverId, vmid, vmType, fullPath);

            const byteChars = atob(result.content);
            const byteArray = new Uint8Array(byteChars.length);
            for (let i = 0; i < byteChars.length; i++) {
                byteArray[i] = byteChars.charCodeAt(i);
            }
            const blob = new Blob([byteArray]);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = result.filename;
            a.click();
            URL.revokeObjectURL(url);

            toast.success(`Downloaded ${result.filename}`);
        } catch (err) {
            toast.error(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    };

    const uploadFiles = async (fileList: FileList | File[]) => {
        const files = Array.from(fileList);
        if (files.length === 0) return;

        setUploading(true);

        for (const file of files) {
            try {
                setUploadProgress(`Uploading ${file.name}...`);

                const content = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        const base64 = (reader.result as string).split(',')[1];
                        resolve(base64);
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });

                const result = await uploadFileToVM(
                    serverId, vmid, vmType,
                    currentPath.endsWith('/') ? currentPath : `${currentPath}/`,
                    content,
                    file.name
                );

                if (result.success) {
                    toast.success(`Uploaded ${file.name}`);
                } else {
                    toast.error(result.message);
                }
            } catch (err) {
                toast.error(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        }

        setUploading(false);
        setUploadProgress(null);
        loadFiles(currentPath);

        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) uploadFiles(e.target.files);
    };

    // ── Drag & Drop ──────────────────────────────────────────────────

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            uploadFiles(e.dataTransfer.files);
        }
    };

    // ── Helpers ──────────────────────────────────────────────────────

    const handleCreateDir = async () => {
        if (!newDirName.trim()) return;
        const path = currentPath === '/' ? `/${newDirName}` : `${currentPath}/${newDirName}`;
        const result = await createRemoteDir(serverId, vmid, vmType, path);
        if (result.success) {
            toast.success(result.message);
            setNewDirDialog(false);
            setNewDirName('');
            loadFiles(currentPath);
        } else {
            toast.error(result.message);
        }
    };

    const handleDelete = async () => {
        if (!deleteDialog) return;
        const path = currentPath === '/' ? `/${deleteDialog.name}` : `${currentPath}/${deleteDialog.name}`;
        const result = await deleteRemoteFile(serverId, vmid, vmType, path);
        if (result.success) {
            toast.success(result.message);
            setDeleteDialog(null);
            loadFiles(currentPath);
        } else {
            toast.error(result.message);
        }
    };

    const formatSize = (bytes: number): string => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    };

    return (
        <div
            className={`flex flex-col h-full relative ${dragOver ? 'ring-2 ring-primary ring-inset' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* Drag overlay */}
            {dragOver && (
                <div className="absolute inset-0 bg-primary/10 z-20 flex items-center justify-center pointer-events-none">
                    <div className="bg-background border-2 border-dashed border-primary rounded-lg p-6 flex flex-col items-center gap-2">
                        <Upload className="h-8 w-8 text-primary" />
                        <span className="text-sm font-medium text-primary">
                            Drop files to upload to {currentPath}
                        </span>
                    </div>
                </div>
            )}

            {/* Path bar */}
            <div className="flex items-center gap-2 p-2 border-b bg-muted/30">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={goUp} disabled={currentPath === '/'}>
                    <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <div className="flex-1 px-2 py-1 bg-background rounded border text-xs font-mono truncate">
                    {currentPath}
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => loadFiles(currentPath)} disabled={loading}>
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                </Button>
            </div>

            {/* File list */}
            <ScrollArea className="flex-1">
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : files.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                        <Folder className="h-8 w-8 mb-2 opacity-50" />
                        <span className="text-sm">{t('emptyDirectory')}</span>
                    </div>
                ) : (
                    <div className="divide-y">
                        {files.map((entry) => (
                            <div
                                key={entry.name}
                                className={`flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 cursor-pointer transition-colors ${
                                    selectedFile?.name === entry.name ? 'bg-muted' : ''
                                }`}
                                onClick={() => setSelectedFile(entry)}
                                onDoubleClick={() => navigateTo(entry)}
                            >
                                {entry.isDir ? (
                                    <Folder className="h-4 w-4 text-blue-500 shrink-0" />
                                ) : (
                                    <File className="h-4 w-4 text-muted-foreground shrink-0" />
                                )}
                                <span className="flex-1 text-sm truncate">{entry.name}</span>
                                {!compact && (
                                    <>
                                        <span className="text-xs text-muted-foreground w-16 text-right">
                                            {entry.isDir ? '' : formatSize(entry.size)}
                                        </span>
                                        <span className="text-xs text-muted-foreground w-36 text-right hidden lg:block">
                                            {entry.modified}
                                        </span>
                                        <span className="text-xs font-mono text-muted-foreground w-24 hidden xl:block">
                                            {entry.permissions}
                                        </span>
                                    </>
                                )}
                                {compact && !entry.isDir && (
                                    <span className="text-xs text-muted-foreground">
                                        {formatSize(entry.size)}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </ScrollArea>

            {/* Upload progress */}
            {uploadProgress && (
                <div className="px-3 py-1.5 border-t bg-blue-500/10 text-blue-600 text-xs flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {uploadProgress}
                </div>
            )}

            {/* Action bar */}
            <div className="flex items-center gap-1.5 p-2 border-t bg-muted/30">
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleFileInput}
                />
                <Button
                    variant="outline" size="sm" className="h-7 text-xs gap-1"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                >
                    <Upload className="h-3 w-3" />
                    {compact ? '' : t('uploadFile')}
                </Button>
                <Button
                    variant="outline" size="sm" className="h-7 text-xs gap-1"
                    onClick={() => selectedFile && handleDownload(selectedFile)}
                    disabled={!selectedFile || selectedFile.isDir}
                >
                    <Download className="h-3 w-3" />
                    {compact ? '' : t('downloadFile')}
                </Button>
                <Button
                    variant="outline" size="sm" className="h-7 text-xs gap-1"
                    onClick={() => setNewDirDialog(true)}
                >
                    <FolderPlus className="h-3 w-3" />
                </Button>
                <Button
                    variant="outline" size="sm" className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
                    onClick={() => selectedFile && setDeleteDialog(selectedFile)}
                    disabled={!selectedFile}
                >
                    <Trash2 className="h-3 w-3" />
                </Button>
                {selectedFile && !compact && (
                    <Badge variant="secondary" className="ml-auto text-xs">
                        {selectedFile.name}
                    </Badge>
                )}
            </div>

            {/* New Directory Dialog */}
            <Dialog open={newDirDialog} onOpenChange={setNewDirDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('createDirectory')}</DialogTitle>
                    </DialogHeader>
                    <Input
                        value={newDirName}
                        onChange={(e) => setNewDirName(e.target.value)}
                        placeholder={t('directoryName')}
                        onKeyDown={(e) => e.key === 'Enter' && handleCreateDir()}
                    />
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setNewDirDialog(false)}>{t('cancel')}</Button>
                        <Button onClick={handleCreateDir}>{t('create')}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <Dialog open={!!deleteDialog} onOpenChange={(o) => !o && setDeleteDialog(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-destructive" />
                            {t('confirmDelete')}
                        </DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        {t('confirmDeleteMessage', { name: deleteDialog?.name || '' })}
                    </p>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteDialog(null)}>{t('cancel')}</Button>
                        <Button variant="destructive" onClick={handleDelete}>{t('deleteItem')}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

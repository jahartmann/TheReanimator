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
}

export function FileExplorer({ serverId, vmid, vmType }: FileExplorerProps) {
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

            // Convert base64 to blob and download
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

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const fileList = e.target.files;
        if (!fileList || fileList.length === 0) return;

        setUploading(true);

        for (const file of Array.from(fileList)) {
            try {
                setUploadProgress(`Uploading ${file.name}...`);

                // Read file as base64
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

        // Reset input
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

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
        <div className="flex flex-col h-full">
            {/* Path bar */}
            <div className="flex items-center gap-2 p-3 border-b bg-muted/30">
                <Button variant="ghost" size="icon" onClick={goUp} disabled={currentPath === '/'}>
                    <ArrowUp className="h-4 w-4" />
                </Button>
                <div className="flex-1 px-3 py-1.5 bg-background rounded border text-sm font-mono truncate">
                    {currentPath}
                </div>
                <Button variant="ghost" size="icon" onClick={() => loadFiles(currentPath)} disabled={loading}>
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
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
                                className={`flex items-center gap-3 px-4 py-2 hover:bg-muted/50 cursor-pointer transition-colors ${
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
                                <span className="text-xs text-muted-foreground w-16 text-right">
                                    {entry.isDir ? '' : formatSize(entry.size)}
                                </span>
                                <span className="text-xs text-muted-foreground w-36 text-right hidden sm:block">
                                    {entry.modified}
                                </span>
                                <span className="text-xs font-mono text-muted-foreground w-24 hidden md:block">
                                    {entry.permissions}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </ScrollArea>

            {/* Upload progress */}
            {uploadProgress && (
                <div className="px-4 py-2 border-t bg-blue-500/10 text-blue-600 text-sm flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {uploadProgress}
                </div>
            )}

            {/* Action bar */}
            <div className="flex items-center gap-2 p-3 border-t bg-muted/30">
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleUpload}
                />
                <Button
                    variant="outline" size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="gap-1.5"
                >
                    <Upload className="h-3.5 w-3.5" />
                    {t('uploadFile')}
                </Button>
                <Button
                    variant="outline" size="sm"
                    onClick={() => selectedFile && handleDownload(selectedFile)}
                    disabled={!selectedFile || selectedFile.isDir}
                    className="gap-1.5"
                >
                    <Download className="h-3.5 w-3.5" />
                    {t('downloadFile')}
                </Button>
                <Button
                    variant="outline" size="sm"
                    onClick={() => setNewDirDialog(true)}
                    className="gap-1.5"
                >
                    <FolderPlus className="h-3.5 w-3.5" />
                    {t('newFolder')}
                </Button>
                <Button
                    variant="outline" size="sm"
                    onClick={() => selectedFile && setDeleteDialog(selectedFile)}
                    disabled={!selectedFile}
                    className="gap-1.5 text-destructive hover:text-destructive"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('deleteItem')}
                </Button>
                {selectedFile && (
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

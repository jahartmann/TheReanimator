'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plus, Wrench, Code, Shield, Database, Terminal, FileText, Package, Server, Workflow, Brain, MessageSquare, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

interface ToolDefinition {
    name: string;
    category: string;
    description: string;
    status: 'built-in' | 'custom' | 'disabled';
}

const TOOL_CATEGORIES = {
    core: { icon: Wrench, label: 'Core Operations' },
    diagnostics: { icon: Terminal, label: 'Diagnostics & Monitoring' },
    security: { icon: Shield, label: 'Security & SSH' },
    data: { icon: Database, label: 'Data Management' },
    files: { icon: FileText, label: 'File Operations' },
    packages: { icon: Package, label: 'Package & Service Management' },
    infrastructure: { icon: Server, label: 'Infrastructure Management' },
    templates: { icon: Workflow, label: 'Templates & Provisioning' },
    knowledge: { icon: Brain, label: 'Knowledge & Memory' },
    communication: { icon: MessageSquare, label: 'Communication' },
    advanced: { icon: Zap, label: 'Advanced Features' },
    custom: { icon: Code, label: 'Custom Tools' },
};

// Built-in tools organized by category
const BUILT_IN_TOOLS: ToolDefinition[] = [
    // Core Operations
    { name: 'getServers', category: 'core', description: 'List all configured servers', status: 'built-in' },
    { name: 'getServerDetails', category: 'core', description: 'Get server system info (CPU, disks, networks, pools)', status: 'built-in' },
    { name: 'listVMs', category: 'core', description: 'List all VMs/containers', status: 'built-in' },
    { name: 'manageVM', category: 'core', description: 'Start/stop/reboot/shutdown VM or container', status: 'built-in' },
    { name: 'getVMStatus', category: 'core', description: 'Check VM/container status', status: 'built-in' },
    { name: 'createVM', category: 'core', description: 'Create QEMU/KVM VM', status: 'built-in' },
    { name: 'createContainer', category: 'core', description: 'Create LXC container', status: 'built-in' },
    { name: 'cloneVM', category: 'core', description: 'Clone existing VM or container', status: 'built-in' },

    // Diagnostics & Monitoring
    { name: 'runHealthScan', category: 'diagnostics', description: 'Run infrastructure health scan', status: 'built-in' },
    { name: 'runAutonomousCommand', category: 'diagnostics', description: 'Run safe diagnostic commands', status: 'built-in' },
    { name: 'runNetworkAnalysis', category: 'diagnostics', description: 'AI-powered network analysis', status: 'built-in' },
    { name: 'getLinuxHosts', category: 'diagnostics', description: 'List all configured Linux hosts', status: 'built-in' },
    { name: 'listMonitorChecks', category: 'diagnostics', description: 'List all monitoring checks', status: 'built-in' },
    { name: 'getMonitorStatus', category: 'diagnostics', description: 'Get overall monitoring status', status: 'built-in' },
    { name: 'createMonitorCheck', category: 'diagnostics', description: 'Create new monitoring check', status: 'built-in' },
    { name: 'getSystemMetrics', category: 'diagnostics', description: 'Get detailed system metrics (CPU, RAM, Disk, Network)', status: 'built-in' },
    { name: 'analyzeLogs', category: 'diagnostics', description: 'Analyze system logs for errors/warnings', status: 'built-in' },
    { name: 'checkDiskHealth', category: 'diagnostics', description: 'Check disk health using SMART', status: 'built-in' },
    { name: 'testNetworkConnectivity', category: 'diagnostics', description: 'Test network connectivity (ping, traceroute, DNS)', status: 'built-in' },
    { name: 'getProcessList', category: 'diagnostics', description: 'Get top processes by CPU/RAM usage', status: 'built-in' },
    { name: 'getDiskUsage', category: 'diagnostics', description: 'Get detailed disk usage breakdown', status: 'built-in' },

    // Security & SSH
    { name: 'executeSSHCommand', category: 'security', description: 'Execute SSH command (requires confirmation)', status: 'built-in' },

    // Data Management
    { name: 'createConfigBackup', category: 'data', description: 'Create configuration backup NOW', status: 'built-in' },
    { name: 'getBackups', category: 'data', description: 'List recent config backups', status: 'built-in' },
    { name: 'getScheduledJobs', category: 'data', description: 'List all scheduled jobs', status: 'built-in' },
    { name: 'createScheduledJob', category: 'data', description: 'Schedule cron job (backup/scan/command)', status: 'built-in' },
    { name: 'getRecentTasks', category: 'data', description: 'Show recent background tasks', status: 'built-in' },

    // File Operations
    { name: 'readFile', category: 'files', description: 'Read file content from remote server', status: 'built-in' },
    { name: 'writeFile', category: 'files', description: 'Write content to file (requires confirmation)', status: 'built-in' },
    { name: 'listDirectory', category: 'files', description: 'List directory contents on remote server', status: 'built-in' },
    { name: 'findFiles', category: 'files', description: 'Search for files by name pattern', status: 'built-in' },
    { name: 'searchFileContent', category: 'files', description: 'Search for text pattern in files (grep)', status: 'built-in' },

    // Package & Service Management
    { name: 'managePackages', category: 'packages', description: 'Manage system packages (install/update/remove/list)', status: 'built-in' },
    { name: 'manageService', category: 'packages', description: 'Manage systemd services (start/stop/restart/status)', status: 'built-in' },
    { name: 'listServices', category: 'packages', description: 'List all systemd services and their status', status: 'built-in' },

    // Infrastructure Management
    { name: 'getProvisioningProfiles', category: 'infrastructure', description: 'List provisioning profiles', status: 'built-in' },
    { name: 'getTags', category: 'infrastructure', description: 'List all tags', status: 'built-in' },
    { name: 'getReanimatorSettings', category: 'infrastructure', description: 'Get Reanimator settings (AI, SMTP, Telegram)', status: 'built-in' },
    { name: 'listProxmoxStorages', category: 'infrastructure', description: 'List all storage pools on Proxmox', status: 'built-in' },
    { name: 'listProxmoxNetworks', category: 'infrastructure', description: 'List network interfaces and bridges', status: 'built-in' },
    { name: 'getClusterStatus', category: 'infrastructure', description: 'Get Proxmox cluster status', status: 'built-in' },
    { name: 'getNodeInfo', category: 'infrastructure', description: 'Get detailed node information', status: 'built-in' },

    // Templates & Provisioning
    { name: 'listVMTemplates', category: 'templates', description: 'List all VM/container templates', status: 'built-in' },
    { name: 'createFromTemplate', category: 'templates', description: 'Create VM/container from template', status: 'built-in' },
    { name: 'saveVMAsTemplate', category: 'templates', description: 'Save current VM config as template', status: 'built-in' },
    { name: 'createTemplate', category: 'templates', description: 'Create new VM template from parameters', status: 'built-in' },

    // Knowledge & Memory
    { name: 'manageKnowledge', category: 'knowledge', description: 'Manage Brain (long-term memory)', status: 'built-in' },
    { name: 'searchKnowledge', category: 'knowledge', description: 'Full-text search in Brain (FTS5)', status: 'built-in' },
    { name: 'rememberContext', category: 'knowledge', description: 'Remember fact in working memory', status: 'built-in' },
    { name: 'forgetContext', category: 'knowledge', description: 'Remove fact from working memory', status: 'built-in' },

    // Communication
    { name: 'manageContacts', category: 'communication', description: 'Manage email contacts (list/add/delete)', status: 'built-in' },
    { name: 'sendEmail', category: 'communication', description: 'Send email (text/HTML)', status: 'built-in' },
    { name: 'sendTelegram', category: 'communication', description: 'Send Telegram message to all admins', status: 'built-in' },

    // Advanced Features
    { name: 'searchInternet', category: 'advanced', description: 'Search internet for information (if enabled)', status: 'built-in' },
    { name: 'createTool', category: 'advanced', description: 'Create new custom tool (requires admin approval)', status: 'built-in' },
    { name: 'listAvailableTools', category: 'advanced', description: 'List all available tools (built-in + custom)', status: 'built-in' },
    { name: 'getToolHelp', category: 'advanced', description: 'Show help for specific tool', status: 'built-in' },
];

export function ToolsClient() {
    const t = useTranslations('tools');
    const [tools, setTools] = useState<ToolDefinition[]>(BUILT_IN_TOOLS);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [newTool, setNewTool] = useState({
        name: '',
        description: '',
        category: 'custom',
    });

    const handleCreateTool = async () => {
        if (!newTool.name || !newTool.description) {
            toast.error('Please fill all fields');
            return;
        }

        // TODO: Call API to create custom tool
        toast.success('Custom tool creation coming soon!');
        setIsDialogOpen(false);
        setNewTool({ name: '', description: '', category: 'custom' });
    };

    const toolsByCategory = tools.reduce((acc, tool) => {
        if (!acc[tool.category]) acc[tool.category] = [];
        acc[tool.category].push(tool);
        return acc;
    }, {} as Record<string, ToolDefinition[]>);

    return (
        <div className="space-y-6">
            {/* Header with Create Button */}
            <div className="flex justify-between items-center">
                <div>
                    <Badge variant="outline" className="mb-2">
                        {tools.length} Tools Available
                    </Badge>
                </div>
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="mr-2 h-4 w-4" />
                            Create Custom Tool
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Create Custom Tool</DialogTitle>
                            <DialogDescription>
                                Define a new custom tool for the AI agent to use.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div>
                                <Label htmlFor="name">Tool Name</Label>
                                <Input
                                    id="name"
                                    placeholder="e.g. deployApplication"
                                    value={newTool.name}
                                    onChange={(e) => setNewTool({ ...newTool, name: e.target.value })}
                                />
                            </div>
                            <div>
                                <Label htmlFor="description">Description</Label>
                                <Textarea
                                    id="description"
                                    placeholder="What does this tool do?"
                                    value={newTool.description}
                                    onChange={(e) => setNewTool({ ...newTool, description: e.target.value })}
                                />
                            </div>
                            <Button onClick={handleCreateTool} className="w-full">
                                Create Tool
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Tool Categories */}
            {Object.entries(TOOL_CATEGORIES).map(([key, { icon: Icon, label }]) => {
                const categoryTools = toolsByCategory[key] || [];
                if (categoryTools.length === 0) return null;

                return (
                    <Card key={key}>
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Icon className="h-5 w-5 text-primary" />
                                <CardTitle>{label}</CardTitle>
                            </div>
                            <CardDescription>
                                {categoryTools.length} tool{categoryTools.length > 1 ? 's' : ''} available
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid gap-3">
                                {categoryTools.map((tool) => (
                                    <div
                                        key={tool.name}
                                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors"
                                    >
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <code className="text-sm font-mono">{tool.name}</code>
                                                <Badge variant={tool.status === 'built-in' ? 'default' : 'secondary'} className="text-xs">
                                                    {tool.status}
                                                </Badge>
                                            </div>
                                            <p className="text-sm text-muted-foreground">{tool.description}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );
}

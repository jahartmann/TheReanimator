/**
 * Tools page - shows all built-in agent tools organized by category.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import {
  Terminal, Activity, HardDrive, Server, FolderOpen, Package,
  Brain, MessageSquare, Wrench, Shield, Database,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

// ─── Tool categories ──────────────────────────────────────────────────────────

interface ToolCategory {
  name: string;
  icon: React.ReactNode;
  color: string;
  tools: string[];
  description: string;
}

const TOOL_CATEGORIES: ToolCategory[] = [
  {
    name: 'Core VM Operations',
    icon: <Server className="h-5 w-5" />,
    color: 'text-blue-500',
    description: 'Control virtual machines and containers',
    tools: ['getVMStatus', 'startVM', 'stopVM', 'rebootVM', 'createVM', 'deleteVM'],
  },
  {
    name: 'Diagnostics & Monitoring',
    icon: <Activity className="h-5 w-5" />,
    color: 'text-green-500',
    description: 'System metrics, logs and connectivity checks',
    tools: ['executeSSH', 'checkDiskHealth', 'getSystemMetrics', 'analyzeLogs', 'getProcessList', 'getDiskUsage', 'testNetworkConnectivity', 'listServices'],
  },
  {
    name: 'Backups',
    icon: <HardDrive className="h-5 w-5" />,
    color: 'text-orange-500',
    description: 'Config and VM backup operations',
    tools: ['runConfigBackup', 'listConfigBackups', 'runProxmoxBackup', 'batchRestoreFiles'],
  },
  {
    name: 'Infrastructure Monitoring',
    icon: <Database className="h-5 w-5" />,
    color: 'text-purple-500',
    description: 'Cluster status and node information',
    tools: ['refreshNodeStats', 'getClusterStatus', 'getNodeInfo', 'listProxmoxStorages', 'listProxmoxNetworks'],
  },
  {
    name: 'File Operations',
    icon: <FolderOpen className="h-5 w-5" />,
    color: 'text-amber-500',
    description: 'Remote file management via SSH',
    tools: ['readFile', 'writeFile', 'listDirectory', 'findFiles', 'searchFileContent'],
  },
  {
    name: 'Package & Service Management',
    icon: <Package className="h-5 w-5" />,
    color: 'text-cyan-500',
    description: 'Install packages and manage system services',
    tools: ['managePackages', 'manageService', 'getServiceStatus'],
  },
  {
    name: 'Brain / Memory',
    icon: <Brain className="h-5 w-5" />,
    color: 'text-pink-500',
    description: 'Persistent agent knowledge base',
    tools: ['saveBrainEntry', 'getBrainEntry', 'searchBrain', 'listBrainEntries'],
  },
  {
    name: 'Communication',
    icon: <MessageSquare className="h-5 w-5" />,
    color: 'text-teal-500',
    description: 'Send notifications and alerts',
    tools: ['sendTelegramMessage', 'sendEmail'],
  },
  {
    name: 'Security & SSH',
    icon: <Shield className="h-5 w-5" />,
    color: 'text-red-500',
    description: 'SSH key management and security checks',
    tools: ['listSSHKeys', 'addSSHKey', 'removeSSHKey', 'getReanimatorSettings'],
  },
  {
    name: 'Templates & Provisioning',
    icon: <Wrench className="h-5 w-5" />,
    color: 'text-indigo-500',
    description: 'Provision VMs with predefined profiles',
    tools: ['listProvisioningProfiles', 'runProvisioningProfile', 'createVMFromTemplate'],
  },
  {
    name: 'Advanced Features',
    icon: <Terminal className="h-5 w-5" />,
    color: 'text-slate-500',
    description: 'Migration, snapshots and advanced operations',
    tools: ['migrateVM', 'createSnapshot', 'rollbackSnapshot', 'listSnapshots', 'delegateToSubAgent'],
  },
];

// ─── Tools page ───────────────────────────────────────────────────────────────

export default function ToolsPage() {
  const totalTools = TOOL_CATEGORIES.reduce((sum, c) => sum + c.tools.length, 0);

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Agent Tools</h1>
            <p className="text-sm text-muted-foreground">
              {totalTools} built-in tools across {TOOL_CATEGORIES.length} categories
            </p>
          </div>
          <Link to="/tools/bulk-command">
            <Button size="sm" variant="outline">
              <Terminal className="mr-2 h-4 w-4" />
              Bulk Command
            </Button>
          </Link>
        </div>

        {/* Info card */}
        <div className="p-4 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm dark:bg-blue-950/20 dark:border-blue-800/30 dark:text-blue-400">
          The AI agent has access to all tools below. Custom tools can be created via the Agent chat
          using natural language — the agent will scaffold and deploy them automatically.
        </div>

        {/* Categories grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {TOOL_CATEGORIES.map((category) => (
            <Card key={category.name} className="border-muted/60 hover:border-primary/30 transition-colors">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className={`${category.color}`}>
                      {category.icon}
                    </div>
                    <div>
                      <CardTitle className="text-sm">{category.name}</CardTitle>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{category.description}</p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-xs shrink-0 ml-2">
                    {category.tools.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap gap-1">
                  {category.tools.map((tool) => (
                    <code
                      key={tool}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono"
                    >
                      {tool}
                    </code>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Bulk command CTA */}
        <Card className="border-dashed border-muted/50">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="font-medium text-sm">Run SSH commands on multiple servers at once</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Select servers and execute a command in parallel with the Bulk Command tool.
              </p>
            </div>
            <Link to="/tools/bulk-command">
              <Button size="sm">
                <Terminal className="mr-2 h-4 w-4" />
                Bulk Command
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}

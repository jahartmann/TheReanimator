'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
    Shield, ArrowLeft, ArrowRight, Server, HardDrive, Check, X,
    AlertTriangle, Info, ChevronDown, ChevronRight, Eye, EyeOff,
    GitCompare, Merge, RotateCcw, Play, CheckCircle2, XCircle,
    Loader2, FileText, Terminal, Copy
} from "lucide-react";
import {
    analyzeBackupForDR,
    generateDRPlan,
    compareConfigs,
    fetchDiskInfo,
    restoreWithMerge,
    executePostCommand,
    generateFstabUUIDMapping,
    generateContextDescription,
} from '@/lib/actions/disasterRecovery';
import ConfigDiffView from './ConfigDiffView';

interface ServerItem {
    id: number;
    name: string;
    type: string;
    url: string;
    ssh_host?: string;
}

interface DisasterRecoveryWizardProps {
    backupId: number;
    serverId: number;
    serverName: string;
    backupDate: string;
    allServers: ServerItem[];
}

type WizardStep = 'target' | 'plan' | 'diff' | 'execute';

const STEPS: WizardStep[] = ['target', 'plan', 'diff', 'execute'];

export default function DisasterRecoveryWizard({
    backupId,
    serverId: originalServerId,
    serverName,
    backupDate,
    allServers,
}: DisasterRecoveryWizardProps) {
    const t = useTranslations('disasterRecovery');
    const locale = useLocale();

    // Wizard state
    const [currentStep, setCurrentStep] = useState<WizardStep>('target');
    const [targetServerId, setTargetServerId] = useState(originalServerId);

    // Data state
    const [analysis, setAnalysis] = useState<any>(null);
    const [plan, setPlan] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Selection state (which files to restore/merge/skip)
    const [fileActions, setFileActions] = useState<Record<string, 'restore' | 'merge' | 'skip' | 'compare-first'>>({});

    // Diff state
    const [selectedFileForDiff, setSelectedFileForDiff] = useState<string | null>(null);
    const [diffData, setDiffData] = useState<Record<string, any>>({});
    const [diffLoading, setDiffLoading] = useState(false);

    // Merge state
    const [mergedContents, setMergedContents] = useState<Record<string, string>>({});

    // Context descriptions state (file-specific, generated from diff analysis)
    const [contextDescriptions, setContextDescriptions] = useState<Record<string, string>>({});

    // UUID mappings for fstab
    const [uuidMappings, setUuidMappings] = useState<any[] | null>(null);

    // Execution state
    const [executing, setExecuting] = useState(false);
    const [executionResults, setExecutionResults] = useState<Record<string, { success: boolean; message: string }>>({});
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

    // Load analysis on mount
    useEffect(() => {
        loadAnalysis();
    }, [backupId]);

    const loadAnalysis = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await analyzeBackupForDR(backupId);
            if (result.success && result.analysis) {
                setAnalysis(result.analysis);
            } else {
                setError(result.error || 'Analysis failed');
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        setLoading(false);
    };

    const loadPlan = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await generateDRPlan(backupId, targetServerId);
            if (result.success && result.plan) {
                setPlan(result.plan);
                // Initialize file actions from plan recommendations
                const actions: Record<string, any> = {};
                for (const phase of result.plan.phases) {
                    for (const step of phase.steps) {
                        actions[step.file.relativePath] = step.action;
                    }
                }
                setFileActions(actions);
                // Expand all categories
                setExpandedCategories(new Set(result.plan.phases.map((p: any) => p.id)));
            } else {
                setError(result.error || 'Plan generation failed');
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        setLoading(false);
    };

    const loadDiff = async (relativePath: string) => {
        setDiffLoading(true);
        try {
            const promises: Promise<any>[] = [
                compareConfigs(backupId, targetServerId, relativePath),
                generateContextDescription(backupId, targetServerId, relativePath, locale),
            ];

            // Load UUID mappings for fstab files
            const isFstab = relativePath.endsWith('etc/fstab');
            if (isFstab) {
                promises.push(generateFstabUUIDMapping(backupId, targetServerId));
            }

            const results = await Promise.all(promises);
            const [diffResult, contextResult] = results;

            if (diffResult.success && diffResult.diff) {
                setDiffData(prev => ({ ...prev, [relativePath]: diffResult.diff }));
            }
            if (contextResult.success && contextResult.description) {
                setContextDescriptions(prev => ({ ...prev, [relativePath]: contextResult.description! }));
            }
            if (isFstab && results[2]) {
                setUuidMappings(results[2].success ? (results[2].mappings || []) : []);
            }
        } catch (e) {
            console.error('Diff failed:', e);
        }
        setDiffLoading(false);
    };

    const handleFileActionChange = (path: string, action: 'restore' | 'merge' | 'skip' | 'compare-first') => {
        setFileActions(prev => ({ ...prev, [path]: action }));
    };

    const goToStep = (step: WizardStep) => {
        if (step === 'plan' && !plan) {
            loadPlan();
        }
        setCurrentStep(step);
    };

    const nextStep = () => {
        const idx = STEPS.indexOf(currentStep);
        if (idx < STEPS.length - 1) {
            goToStep(STEPS[idx + 1]);
        }
    };

    const prevStep = () => {
        const idx = STEPS.indexOf(currentStep);
        if (idx > 0) {
            goToStep(STEPS[idx - 1]);
        }
    };

    const handleExecuteFile = async (relativePath: string) => {
        const action = fileActions[relativePath];
        if (action === 'skip') return;

        try {
            const remotePath = '/' + relativePath;
            let content: string;

            if (action === 'merge' && mergedContents[relativePath]) {
                content = mergedContents[relativePath];
            } else {
                // Use backup content
                const allFiles = plan?.phases?.flatMap((p: any) => p.steps.map((s: any) => s.file)) || [];
                const file = allFiles.find((f: any) => f.relativePath === relativePath);
                if (!file?.content) {
                    setExecutionResults(prev => ({
                        ...prev,
                        [relativePath]: { success: false, message: 'No content available' }
                    }));
                    return;
                }
                content = file.content;
            }

            const result = await restoreWithMerge(targetServerId, remotePath, content);
            setExecutionResults(prev => ({
                ...prev,
                [relativePath]: {
                    success: result.success,
                    message: result.success ? (result.message || 'OK') : (result.error || 'Failed')
                }
            }));
        } catch (e) {
            setExecutionResults(prev => ({
                ...prev,
                [relativePath]: { success: false, message: e instanceof Error ? e.message : String(e) }
            }));
        }
    };

    const handleExecuteAll = async () => {
        setExecuting(true);
        const filesToExecute = Object.entries(fileActions)
            .filter(([_, action]) => action !== 'skip')
            .map(([path]) => path);

        for (const filePath of filesToExecute) {
            await handleExecuteFile(filePath);
        }
        setExecuting(false);
    };

    const toggleCategory = (id: string) => {
        setExpandedCategories(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    // ═══════════════════════════════════════════════════════════════
    // STEP 1: TARGET SERVER
    // ═══════════════════════════════════════════════════════════════
    const renderTargetStep = () => (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Server className="h-5 w-5" />
                        {t('selectTarget')}
                    </CardTitle>
                    <CardDescription>{t('selectTargetDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-3">
                        {allServers.map(server => (
                            <div
                                key={server.id}
                                className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${targetServerId === server.id
                                        ? 'border-primary bg-primary/5'
                                        : 'border-border hover:border-primary/30'
                                    }`}
                                onClick={() => setTargetServerId(server.id)}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${server.type === 'pve' ? 'bg-orange-500/10 text-orange-600' : 'bg-blue-500/10 text-blue-600'
                                            }`}>
                                            {server.type === 'pve' ? <Server className="h-5 w-5" /> : <HardDrive className="h-5 w-5" />}
                                        </div>
                                        <div>
                                            <p className="font-medium">{server.name}</p>
                                            <p className="text-sm text-muted-foreground">{server.url}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {server.id === originalServerId && (
                                            <Badge variant="secondary">{t('originalServer')}</Badge>
                                        )}
                                        {targetServerId === server.id && (
                                            <CheckCircle2 className="h-5 w-5 text-primary" />
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {analysis && (
                        <div className="mt-6 p-4 rounded-lg bg-muted/30 border">
                            <h4 className="font-medium mb-2">{t('backupInfo')}</h4>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                                <div className="text-muted-foreground">{t('hostname')}:</div>
                                <div className="font-mono">{analysis.hostname || '—'}</div>
                                <div className="text-muted-foreground">{t('clusterMode')}:</div>
                                <div>{analysis.isCluster ? t('yes') : t('no')}</div>
                                <div className="text-muted-foreground">{t('recognizedFiles')}:</div>
                                <div>{analysis.recognizedFiles} / {analysis.totalFiles}</div>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );

    // ═══════════════════════════════════════════════════════════════
    // STEP 2: RECOVERY PLAN
    // ═══════════════════════════════════════════════════════════════
    const renderPlanStep = () => {
        if (!plan) return <div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8" /></div>;

        return (
            <div className="space-y-6">
                {/* Scenario Banner */}
                <Card className="border-primary/30 bg-gradient-to-r from-primary/5 to-transparent">
                    <CardContent className="py-4">
                        <div className="flex items-start gap-3">
                            <Shield className="h-6 w-6 text-primary mt-0.5" />
                            <div>
                                <h3 className="font-semibold text-lg">{t(`scenario_${plan.scenario}`)}</h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {locale === 'de' ? plan.scenarioDescription.de : plan.scenarioDescription.en}
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Stats */}
                <div className="grid grid-cols-4 gap-3">
                    {[
                        { label: t('toRestore'), value: plan.stats.toRestore, color: 'text-green-500', bg: 'bg-green-500/10' },
                        { label: t('toMerge'), value: plan.stats.toMerge, color: 'text-blue-500', bg: 'bg-blue-500/10' },
                        { label: t('toCompare'), value: plan.stats.toCompare, color: 'text-amber-500', bg: 'bg-amber-500/10' },
                        { label: t('toSkip'), value: plan.stats.toSkip, color: 'text-gray-500', bg: 'bg-gray-500/10' },
                    ].map(stat => (
                        <div key={stat.label} className={`p-3 rounded-lg ${stat.bg} text-center`}>
                            <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
                            <div className="text-xs text-muted-foreground">{stat.label}</div>
                        </div>
                    ))}
                </div>

                {/* Phases */}
                <div className="space-y-4">
                    {plan.phases.map((phase: any) => (
                        <Card key={phase.id} className="overflow-hidden">
                            <CardHeader
                                className="py-3 px-4 cursor-pointer hover:bg-muted/5 transition-colors"
                                onClick={() => toggleCategory(phase.id)}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        {expandedCategories.has(phase.id) ? (
                                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                        ) : (
                                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                        )}
                                        <span className="text-lg">{phase.icon}</span>
                                        <div>
                                            <CardTitle className="text-sm">
                                                {locale === 'de' ? phase.name.de : phase.name.en}
                                            </CardTitle>
                                            <CardDescription className="text-xs">
                                                {locale === 'de' ? phase.description.de : phase.description.en}
                                            </CardDescription>
                                        </div>
                                    </div>
                                    <Badge variant="outline">{phase.steps.length} {t('files')}</Badge>
                                </div>
                            </CardHeader>

                            {expandedCategories.has(phase.id) && (
                                <CardContent className="p-0 divide-y divide-border/30">
                                    {phase.steps.map((step: any) => (
                                        <div key={step.id} className="p-4 hover:bg-muted/3 transition-colors">
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="font-mono text-sm truncate">
                                                            /{step.file.relativePath}
                                                        </span>
                                                        {step.file.vmId && (
                                                            <Badge variant="secondary" className="text-xs">
                                                                VM {step.file.vmId}
                                                                {step.file.vmName && `: ${step.file.vmName}`}
                                                            </Badge>
                                                        )}
                                                    </div>

                                                    {step.file.configInfo && (
                                                        <>
                                                            <p className="text-xs text-muted-foreground mb-2">
                                                                {locale === 'de'
                                                                    ? step.file.configInfo.description.de
                                                                    : step.file.configInfo.description.en}
                                                            </p>

                                                            {/* Consequence boxes */}
                                                            <div className="grid grid-cols-2 gap-2 mt-2">
                                                                <div className="p-2 rounded bg-red-500/5 border border-red-500/20">
                                                                    <p className="text-[10px] font-semibold text-red-400 uppercase mb-1">
                                                                        {t('ifIgnored')}
                                                                    </p>
                                                                    <p className="text-xs text-muted-foreground">
                                                                        {locale === 'de'
                                                                            ? step.file.configInfo.consequences.ifIgnored.de
                                                                            : step.file.configInfo.consequences.ifIgnored.en}
                                                                    </p>
                                                                </div>
                                                                <div className="p-2 rounded bg-green-500/5 border border-green-500/20">
                                                                    <p className="text-[10px] font-semibold text-green-400 uppercase mb-1">
                                                                        {t('ifRestored')}
                                                                    </p>
                                                                    <p className="text-xs text-muted-foreground">
                                                                        {locale === 'de'
                                                                            ? step.file.configInfo.consequences.ifRestored.de
                                                                            : step.file.configInfo.consequences.ifRestored.en}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>

                                                {/* Action selector */}
                                                <div className="flex flex-col gap-1 shrink-0">
                                                    {getRiskBadge(step.file.configInfo?.risk)}
                                                    <div className="flex gap-1 mt-2">
                                                        {['restore', 'merge', 'skip'].map(action => (
                                                            <Button
                                                                key={action}
                                                                size="sm"
                                                                variant={fileActions[step.file.relativePath] === action ? 'default' : 'outline'}
                                                                className={`h-7 text-xs px-2 ${fileActions[step.file.relativePath] === action
                                                                        ? action === 'skip' ? 'bg-gray-600' : action === 'merge' ? 'bg-blue-600' : 'bg-green-600'
                                                                        : ''
                                                                    }`}
                                                                onClick={() => handleFileActionChange(step.file.relativePath, action as any)}
                                                            >
                                                                {action === 'restore' && <RotateCcw className="h-3 w-3 mr-1" />}
                                                                {action === 'merge' && <Merge className="h-3 w-3 mr-1" />}
                                                                {action === 'skip' && <X className="h-3 w-3 mr-1" />}
                                                                {t(action)}
                                                            </Button>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </CardContent>
                            )}
                        </Card>
                    ))}
                </div>
            </div>
        );
    };

    // ═══════════════════════════════════════════════════════════════
    // STEP 3: DIFF & MERGE
    // ═══════════════════════════════════════════════════════════════
    const renderDiffStep = () => {
        if (!plan) return null;

        const activeFiles = Object.entries(fileActions)
            .filter(([_, action]) => action !== 'skip')
            .map(([path]) => {
                const allFiles = plan.phases.flatMap((p: any) => p.steps.map((s: any) => s.file));
                return allFiles.find((f: any) => f.relativePath === path);
            })
            .filter(Boolean);

        return (
            <div className="space-y-4">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <GitCompare className="h-5 w-5" />
                            {t('compareTitle')}
                        </CardTitle>
                        <CardDescription>{t('compareDesc')}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex gap-4 min-h-[600px]">
                            {/* File list - scrollable */}
                            <ScrollArea className="w-72 shrink-0 h-[600px]">
                                <div className="space-y-1 pr-3">
                                    {activeFiles.map((file: any) => (
                                        <div
                                            key={file.relativePath}
                                            className={`p-2 rounded cursor-pointer text-sm transition-colors ${selectedFileForDiff === file.relativePath
                                                    ? 'bg-primary/10 border border-primary/30'
                                                    : 'hover:bg-muted/50'
                                                }`}
                                            onClick={() => {
                                                setSelectedFileForDiff(file.relativePath);
                                                if (!diffData[file.relativePath]) {
                                                    loadDiff(file.relativePath);
                                                }
                                            }}
                                        >
                                            <div className="flex items-center gap-2">
                                                <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                                <span className="font-mono text-xs truncate">
                                                    {file.relativePath.split('/').pop()}
                                                </span>
                                            </div>
                                            <p className="text-[10px] text-muted-foreground ml-5 mt-0.5 truncate">
                                                /{file.relativePath}
                                            </p>
                                            <div className="flex items-center gap-1 mt-1 ml-5">
                                                {fileActions[file.relativePath] === 'merge' && (
                                                    <Badge variant="outline" className="text-[10px] h-4 text-blue-500">merge</Badge>
                                                )}
                                                {fileActions[file.relativePath] === 'restore' && (
                                                    <Badge variant="outline" className="text-[10px] h-4 text-green-500">restore</Badge>
                                                )}
                                                {diffData[file.relativePath]?.identical && (
                                                    <Badge variant="outline" className="text-[10px] h-4 text-gray-500">{t('identical')}</Badge>
                                                )}
                                                {executionResults[file.relativePath] && (
                                                    executionResults[file.relativePath].success
                                                        ? <CheckCircle2 className="h-3 w-3 text-green-500" />
                                                        : <XCircle className="h-3 w-3 text-red-500" />
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>

                            {/* Diff view - scrollable */}
                            <div className="flex-1 min-w-0 overflow-auto max-h-[600px]">
                                {selectedFileForDiff ? (
                                    diffLoading ? (
                                        <div className="flex items-center justify-center p-12">
                                            <Loader2 className="animate-spin h-6 w-6 mr-2" />
                                            <span>{t('loadingDiff')}</span>
                                        </div>
                                    ) : diffData[selectedFileForDiff] ? (
                                        <ConfigDiffView
                                            diff={diffData[selectedFileForDiff]}
                                            filePath={selectedFileForDiff}
                                            action={fileActions[selectedFileForDiff]}
                                            onMergedContentChange={(content) => {
                                                setMergedContents(prev => ({ ...prev, [selectedFileForDiff!]: content }));
                                            }}
                                            locale={locale}
                                            contextInfo={contextDescriptions[selectedFileForDiff] || null}
                                            savedContent={mergedContents[selectedFileForDiff] || null}
                                            uuidMappings={selectedFileForDiff.endsWith('etc/fstab') ? uuidMappings : null}
                                        />
                                    ) : (
                                        <div className="text-center text-muted-foreground p-12">
                                            {t('selectFileToCompare')}
                                        </div>
                                    )
                                ) : (
                                    <div className="text-center text-muted-foreground p-12">
                                        <GitCompare className="h-12 w-12 mx-auto mb-3 opacity-20" />
                                        <p>{t('selectFileToCompare')}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    };

    // ═══════════════════════════════════════════════════════════════
    // STEP 4: EXECUTE
    // ═══════════════════════════════════════════════════════════════
    const renderExecuteStep = () => {
        if (!plan) return null;

        const filesToExecute = Object.entries(fileActions)
            .filter(([_, action]) => action !== 'skip');

        const completed = Object.keys(executionResults).length;
        const successful = Object.values(executionResults).filter(r => r.success).length;

        return (
            <div className="space-y-6">
                {/* Summary */}
                <Card className="border-amber-500/30 bg-gradient-to-r from-amber-500/5 to-transparent">
                    <CardContent className="py-4">
                        <div className="flex items-start gap-3">
                            <AlertTriangle className="h-6 w-6 text-amber-500 mt-0.5" />
                            <div>
                                <h3 className="font-semibold">{t('executeSummary')}</h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {t('executeDesc', { count: filesToExecute.length })}
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Progress */}
                {completed > 0 && (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                        <div className="text-sm">
                            {t('progress')}: <span className="font-semibold">{completed}/{filesToExecute.length}</span>
                            {' '}({successful} {t('successful')})
                        </div>
                    </div>
                )}

                {/* File list */}
                <Card>
                    <CardContent className="p-0 divide-y divide-border/30">
                        {filesToExecute.map(([filePath, action]) => {
                            const result = executionResults[filePath];
                            return (
                                <div key={filePath} className="p-4 flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                        {result ? (
                                            result.success ? (
                                                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                                            ) : (
                                                <XCircle className="h-5 w-5 text-red-500 shrink-0" />
                                            )
                                        ) : (
                                            <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 shrink-0" />
                                        )}
                                        <div className="min-w-0">
                                            <p className="font-mono text-sm truncate">/{filePath}</p>
                                            {result && !result.success && (
                                                <p className="text-xs text-red-400 mt-0.5">{result.message}</p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <Badge variant="outline" className="text-xs">
                                            {t(action)}
                                        </Badge>
                                        {!result && (
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                className="h-7"
                                                onClick={async () => {
                                                    setExecuting(true);
                                                    await handleExecuteFile(filePath);
                                                    setExecuting(false);
                                                }}
                                                disabled={executing}
                                            >
                                                <Play className="h-3 w-3 mr-1" />
                                                {t('execute')}
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </CardContent>
                </Card>

                {/* Execute All button */}
                <div className="flex justify-center">
                    <Button
                        size="lg"
                        onClick={handleExecuteAll}
                        disabled={executing || completed === filesToExecute.length}
                        className="bg-gradient-to-r from-green-600 to-emerald-600"
                    >
                        {executing ? (
                            <Loader2 className="animate-spin h-4 w-4 mr-2" />
                        ) : (
                            <Play className="h-4 w-4 mr-2" />
                        )}
                        {t('executeAll')}
                    </Button>
                </div>

                {/* Post-restore actions */}
                {plan.postActions && plan.postActions.length > 0 && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-sm">
                                <Terminal className="h-4 w-4" />
                                {t('postActions')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {plan.postActions.map((action: any, i: number) => (
                                <div key={i} className="p-3 rounded-lg bg-muted/30 border">
                                    <div className="flex items-center justify-between mb-2">
                                        <p className="text-sm">
                                            {locale === 'de' ? action.description.de : action.description.en}
                                        </p>
                                        <div className="flex gap-2">
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-7"
                                                onClick={() => navigator.clipboard.writeText(action.command)}
                                            >
                                                <Copy className="h-3 w-3" />
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                className="h-7"
                                                onClick={() => executePostCommand(targetServerId, action.command)}
                                            >
                                                <Play className="h-3 w-3 mr-1" />
                                                {t('run')}
                                            </Button>
                                        </div>
                                    </div>
                                    <code className="text-xs font-mono bg-black/40 px-2 py-1 rounded block">
                                        {action.command}
                                    </code>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                )}
            </div>
        );
    };

    // ═══════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════
    const getRiskBadge = (risk?: string) => {
        if (!risk) return null;
        const colors: Record<string, string> = {
            critical: 'bg-red-500/10 text-red-500 border-red-500/30',
            high: 'bg-orange-500/10 text-orange-500 border-orange-500/30',
            medium: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30',
            low: 'bg-green-500/10 text-green-500 border-green-500/30',
        };
        return (
            <Badge variant="outline" className={`text-[10px] ${colors[risk] || ''}`}>
                {t(`risk_${risk}`)}
            </Badge>
        );
    };

    const stepIndex = STEPS.indexOf(currentStep);

    // ═══════════════════════════════════════════════════════════════
    // MAIN RENDER
    // ═══════════════════════════════════════════════════════════════
    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href={`/${locale}/configs/${backupId}`}>
                        <Button variant="ghost" size="sm">
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            {t('back')}
                        </Button>
                    </Link>
                    <div>
                        <h2 className="text-2xl font-bold bg-gradient-to-r from-red-400 to-orange-400 bg-clip-text text-transparent flex items-center gap-2">
                            <Shield className="h-6 w-6 text-red-400" />
                            {t('title')}
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            {serverName} • {new Date(backupDate).toLocaleString(locale)}
                        </p>
                    </div>
                </div>
            </div>

            {/* Step Indicator */}
            <div className="flex items-center gap-2">
                {STEPS.map((step, i) => (
                    <div key={step} className="flex items-center">
                        <div
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm cursor-pointer transition-colors ${currentStep === step
                                    ? 'bg-primary text-primary-foreground'
                                    : i < stepIndex
                                        ? 'bg-primary/20 text-primary'
                                        : 'bg-muted text-muted-foreground'
                                }`}
                            onClick={() => i <= stepIndex && goToStep(step)}
                        >
                            <span className="w-5 h-5 rounded-full bg-background/20 flex items-center justify-center text-xs font-bold">
                                {i < stepIndex ? <Check className="h-3 w-3" /> : i + 1}
                            </span>
                            {t(`step_${step}`)}
                        </div>
                        {i < STEPS.length - 1 && (
                            <div className={`w-8 h-0.5 mx-1 ${i < stepIndex ? 'bg-primary/40' : 'bg-muted'}`} />
                        )}
                    </div>
                ))}
            </div>

            {/* Error */}
            {error && (
                <Card className="border-red-500/30 bg-red-500/5">
                    <CardContent className="py-3 flex items-center gap-2 text-red-400">
                        <XCircle className="h-4 w-4" />
                        <span className="text-sm">{error}</span>
                    </CardContent>
                </Card>
            )}

            {/* Loading */}
            {loading && (
                <div className="flex items-center justify-center p-12">
                    <Loader2 className="animate-spin h-8 w-8 mr-3" />
                    <span className="text-lg">{t('analyzing')}</span>
                </div>
            )}

            {/* Step content */}
            {!loading && (
                <>
                    {currentStep === 'target' && renderTargetStep()}
                    {currentStep === 'plan' && renderPlanStep()}
                    {currentStep === 'diff' && renderDiffStep()}
                    {currentStep === 'execute' && renderExecuteStep()}
                </>
            )}

            {/* Navigation */}
            <div className="flex justify-between pt-4 border-t">
                <Button
                    variant="outline"
                    onClick={prevStep}
                    disabled={stepIndex === 0}
                >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    {t('back')}
                </Button>
                <Button
                    onClick={nextStep}
                    disabled={stepIndex === STEPS.length - 1}
                >
                    {t('next')}
                    <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
            </div>
        </div>
    );
}

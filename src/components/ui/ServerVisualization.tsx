'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from "framer-motion";
import { Cpu, MemoryStick, HardDrive, Network, Database } from 'lucide-react';
import { useTranslations } from 'next-intl';

// Simple UsageBar component since it was missing
const UsageBar = ({ usage, color, label }: { usage: number, color: string, label: string }) => (
    <div className="w-full">
        <div className="flex justify-between text-[10px] mb-1">
            <span className="text-zinc-400">{label}</span>
            <span className="text-zinc-300">{usage.toFixed(1)}%</span>
        </div>
        <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
            <div
                className="h-full transition-all duration-500"
                style={{ width: `${Math.min(usage, 100)}%`, backgroundColor: color }}
            />
        </div>
    </div>
);

import { SystemInfo, NetworkInterface, DiskInfo, StoragePool, ServerHealth } from '@/lib/actions/monitoring';

export interface ServerVisualizationProps {
    system: SystemInfo;
    networks: NetworkInterface[];
    disks: DiskInfo[];
    pools: StoragePool[];
    serverType: 'pve' | 'pbs';
    health?: ServerHealth | null;
}
export function ServerVisualization({ system, networks, disks, pools, serverType, health }: ServerVisualizationProps) {
    const [hoveredComponent, setHoveredComponent] = useState<string | null>(null);
    const [detailData, setDetailData] = useState<any>(null); // For specific disk/net info
    const t = useTranslations('serverOverview');

    const primaryColor = serverType === 'pve' ? '#f97316' : '#3b82f6';
    const primaryColorLight = serverType === 'pve' ? 'rgba(249, 115, 22, 0.2)' : 'rgba(59, 130, 246, 0.2)';

    // Stats
    const physicalDisks = disks.filter(d => d.type === 'disk');
    const ssdCount = physicalDisks.filter(d => d.rotational === false).length;
    const hddCount = physicalDisks.filter(d => d.rotational === true).length;
    const nvmeCount = physicalDisks.filter(d => d.transport === 'nvme').length;

    // Parse memory
    const memUsage = system.memoryUsage || 0;
    const cpuUsage = system.cpuUsage || 0;

    const getUsageColor = (usage: number) => {
        if (usage < 50) return '#22c55e';
        if (usage < 80) return '#f59e0b';
        return '#ef4444';
    };

    // Helper to render Detail Overlay Content
    const renderDetailContent = () => {
        if (hoveredComponent === 'cpu') {
            return (
                <div className="flex flex-col justify-center h-full">
                    <p className="text-xs text-zinc-400 mb-2">{t('processor')}</p>
                    <p className="text-xs text-white font-medium leading-tight mb-3">{system.cpu || t('unknown')}</p>
                    <div className="space-y-2">
                        <UsageBar usage={cpuUsage} color={getUsageColor(cpuUsage)} label={t('load')} />
                        <p className="text-[10px] text-zinc-500">{t('loadLabel')} {system.loadAvg} • {t('coresLabel')} {system.cpuCores}</p>
                    </div>
                </div>
            )
        }
        if (hoveredComponent === 'ram') {
            return (
                <div className="flex flex-col justify-center h-full">
                    <p className="text-xs text-zinc-400 mb-2">{t('ram')}</p>
                    <p className="text-lg text-white font-bold">
                        {(system.memoryUsed / 1024 / 1024 / 1024).toFixed(1)} / {(system.memoryTotal / 1024 / 1024 / 1024).toFixed(1)} {t('gb')}
                    </p>
                    <div className="mt-3">
                        <UsageBar usage={memUsage} color={getUsageColor(memUsage)} label={t('used')} />
                    </div>
                </div>
            )
        }
        if (hoveredComponent === 'disk' && detailData) {
            const disk = detailData as DiskInfo;
            // Find SMART data
            const smart = health?.smart?.find(s => s.device === disk.name);
            const isFailed = smart?.health === 'FAILED';

            // Also find status led color
            let ledColor = disk.transport === 'nvme' ? 'bg-purple-500' : disk.rotational === false ? 'bg-blue-500' : 'bg-zinc-500';
            if (isFailed) ledColor = 'bg-red-500 animate-pulse';

            return (
                <div className="flex flex-col justify-center h-full overflow-hidden">
                    <div className="flex items-center gap-2 mb-2">
                        <div className={`w-3 h-3 rounded-full ${ledColor}`} />
                        <span className="font-bold text-white text-sm">{disk.name}</span>
                        <span className="text-xs text-zinc-500 bg-zinc-800 px-1 rounded">{disk.type}</span>
                    </div>
                    <div className="space-y-1 text-xs">
                        <div className="flex justify-between"><span className="text-zinc-500">{t('size')}</span> <span className="text-zinc-300">{disk.size}</span></div>
                        <div className="flex justify-between"><span className="text-zinc-500">{t('model')}</span> <span className="text-zinc-300 truncate w-32 text-right">{disk.model || '-'}</span></div>

                        {smart ? (
                            <>
                                <div className="flex justify-between"><span className="text-zinc-500">{t('health')}</span> <span className={isFailed ? 'text-red-500 font-bold' : 'text-green-500'}>{smart.health}</span></div>
                                {smart.temperature && <div className="flex justify-between"><span className="text-zinc-500">{t('temperature')}</span> <span className="text-zinc-300">{smart.temperature}°C</span></div>}
                                {smart.wearLevel !== undefined && <div className="flex justify-between"><span className="text-zinc-500">{t('wear')}</span> <span className={smart.wearLevel < 10 ? 'text-amber-500' : 'text-zinc-300'}>{100 - smart.wearLevel} {t('usedPercent')}</span></div>}
                            </>
                        ) : (
                            <div className="flex justify-between"><span className="text-zinc-500">{t('mount')}</span> <span className="text-zinc-300 truncate w-32 text-right">{disk.mountpoint}</span></div>
                        )}
                        <div className="flex justify-between"><span className="text-zinc-500">{t('interface')}</span> <span className="text-zinc-300">{disk.transport || 'SATA'}</span></div>
                    </div>
                </div>
            )
        }
        if (hoveredComponent === 'pool' && detailData) {
            const pool = detailData as StoragePool;
            const typeColor = pool.type === 'zfs' ? 'text-cyan-400' : 'text-zinc-400';
            return (
                <div className="flex flex-col justify-center h-full">
                    <p className="text-xs text-zinc-400 mb-1">{t('storagePool')}</p>
                    <div className="flex items-center gap-2 mb-3">
                        <Database className={`h-4 w-4 ${typeColor}`} />
                        <span className="font-bold text-white text-sm">{pool.name}</span>
                        <span className="text-[10px] uppercase bg-zinc-800 px-1 rounded text-zinc-400">{pool.type}</span>
                    </div>
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs text-zinc-400">
                            <span>{t('usedLabel')} {pool.used}</span>
                            <span>{t('totalLabel')} {pool.size}</span>
                        </div>
                    </div>
                </div>
            )
        }
        if (hoveredComponent === 'net' && detailData) {
            const net = detailData as NetworkInterface;
            const isActive = net.state === 'UP';
            return (
                <div className="flex flex-col justify-center h-full overflow-hidden">
                    <div className="flex items-center gap-2 mb-2">
                        <div className={`w-3 h-3 rounded-full ${isActive ? 'bg-green-500' : 'bg-red-500'}`} />
                        <span className="font-bold text-white text-sm">{net.name}</span>
                    </div>
                    <div className="space-y-1 text-xs">
                        <div className="flex justify-between"><span className="text-zinc-500">IP:</span> <span className="text-zinc-300 font-mono">{net.ip}</span></div>
                        <div className="flex justify-between"><span className="text-zinc-500">MAC:</span> <span className="text-zinc-300 font-mono">{net.mac}</span></div>
                        <div className="flex justify-between"><span className="text-zinc-500">{t('state')}</span> <span className={isActive ? 'text-green-400' : 'text-red-400'}>{net.state}</span></div>
                        {net.speed && <div className="flex justify-between"><span className="text-zinc-500">{t('speed')}</span> <span className="text-zinc-300">{net.speed}</span></div>}
                        {net.bridge && <div className="flex justify-between"><span className="text-zinc-500">{t('bridge')}</span> <span className="text-zinc-300">{net.bridge}</span></div>}
                        {net.slaves && net.slaves.length > 0 && (
                            <div className="pt-1 border-t border-zinc-700 mt-1">
                                <span className="text-zinc-500 block mb-1">{t('slaves')}</span>
                                <div className="flex flex-wrap gap-1">
                                    {net.slaves.map(s => <span key={s} className="px-1 bg-zinc-800 rounded text-[9px] text-zinc-300">{s}</span>)}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )
        }
        return <div className="flex items-center justify-center h-full text-zinc-500 text-xs">{t('selectComponent')}</div>
    }

    return (
        <div className="relative w-full max-w-4xl mx-auto">
            {/* ... Chassis & LEDs unchanged ... */}
            <div
                className="relative bg-gradient-to-b from-zinc-800 to-zinc-900 rounded-xl p-6 border border-zinc-700 shadow-2xl"
                style={{ minHeight: '340px' }}
            >
                {/* (LEDs and Bezel here, same as before) */}
                <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-b from-zinc-700 to-zinc-800 rounded-t-xl flex justify-center gap-1 items-center overflow-hidden">
                    {Array.from({ length: 40 }).map((_, i) => (
                        <div key={i} className="w-1 h-1 rounded-full bg-zinc-600" />
                    ))}
                </div>
                <div className="absolute top-4 right-4 flex items-center gap-4">
                    {/* ... LEDs ... */}
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full animate-pulse ${cpuUsage > 80 ? 'bg-red-500' : 'bg-green-500'}`} />
                        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{t('cpu')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full animate-pulse ${memUsage > 80 ? 'bg-red-500' : 'bg-green-500'}`} />
                        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{t('memory')}</span>
                    </div>
                </div>

                <div className="grid grid-cols-5 gap-4 mt-10">
                    {/* CPU Box */}
                    <motion.div
                        className="relative bg-zinc-800/50 rounded-lg p-4 border border-zinc-700 cursor-pointer overflow-hidden"
                        onHoverStart={() => setHoveredComponent('cpu')}
                        onHoverEnd={() => setHoveredComponent(null)}
                        whileHover={{ scale: 1.02, borderColor: primaryColor }}
                    >
                        <Cpu className="h-5 w-5 mb-3" style={{ color: primaryColor }} />
                        {/* CPU Circle visualization */}
                        <div className="flex justify-center"><span className="text-xl font-bold text-white">{cpuUsage.toFixed(0)}%</span></div>
                        <p className="text-center text-[10px] text-zinc-500 mt-1">{system.cpuCores} {t('cores')}</p>
                    </motion.div>

                    {/* RAM Box */}
                    <motion.div
                        className="relative bg-zinc-800/50 rounded-lg p-4 border border-zinc-700 cursor-pointer overflow-hidden"
                        onHoverStart={() => setHoveredComponent('ram')}
                        onHoverEnd={() => setHoveredComponent(null)}
                        whileHover={{ scale: 1.02, borderColor: primaryColor }}
                    >
                        <MemoryStick className="h-5 w-5 mb-3" style={{ color: primaryColor }} />
                        <div className="flex justify-center"><span className="text-xl font-bold text-white">{memUsage.toFixed(0)}%</span></div>
                        <p className="text-center text-[10px] text-zinc-500 mt-1">{(system.memoryUsed / 1024 / 1024 / 1024).toFixed(1)} GB</p>
                    </motion.div>

                    {/* Storage Box (Contains Disks) */}
                    <div className="col-span-2 relative bg-zinc-800/50 rounded-lg p-4 border border-zinc-700 flex flex-col">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <HardDrive className="h-5 w-5" style={{ color: primaryColor }} />
                                <span className="text-xs font-semibold text-zinc-400">{t('storage')}</span>
                            </div>
                        </div>

                        {/* Interactive Disks Grid with scroll */}
                        <div className="max-h-32 overflow-y-auto pr-1 custom-scrollbar">
                            <div className="grid grid-cols-4 gap-2">
                                {physicalDisks.map((disk, i) => {
                                    const smart = health?.smart?.find(s => s.device === disk.name);
                                    const isFailed = smart?.health === 'FAILED';
                                    const isWarning = smart?.wearLevel !== undefined && smart.wearLevel < 10;
                                    let borderColor = '';
                                    if (isFailed) borderColor = '!border-red-500 !border-2 animate-pulse';
                                    else if (isWarning) borderColor = '!border-amber-500 !border-2';

                                    return (
                                        <motion.div
                                            key={i}
                                            className={`h-10 rounded-sm flex flex-col items-center justify-center text-[9px] cursor-pointer shrink-0 ${disk.transport === 'nvme' ? 'bg-purple-500/20 border-purple-500/40' :
                                                disk.rotational === false ? 'bg-blue-500/20 border-blue-500/40' :
                                                    'bg-zinc-700 border-zinc-600'
                                                } ${borderColor}`}
                                            onHoverStart={() => { setHoveredComponent('disk'); setDetailData(disk); }}
                                            onHoverEnd={() => { setHoveredComponent(null); setDetailData(null); }}
                                            whileHover={{ scale: 1.05, borderColor: '#fff' }}
                                        >
                                            <span className={`font-mono font-bold ${isFailed ? 'text-red-500' : 'text-zinc-300'}`}>{disk.name}</span>
                                        </motion.div>
                                    )
                                })}
                            </div>
                        </div>

                        {/* Interactive Pools with scroll if needed */}
                        <div className="mt-2 pt-2 max-h-16 overflow-y-auto custom-scrollbar">
                            <div className="flex flex-wrap gap-2">
                                {pools.map((pool, i) => (
                                    <motion.div
                                        key={i}
                                        className="flex items-center gap-1.5 text-[10px] bg-zinc-800/80 px-2 py-1 rounded cursor-pointer border border-transparent"
                                        onHoverStart={() => { setHoveredComponent('pool'); setDetailData(pool); }}
                                        onHoverEnd={() => { setHoveredComponent(null); setDetailData(null); }}
                                        whileHover={{ borderColor: primaryColor }}
                                    >
                                        <Database className="h-3 w-3 text-zinc-400" />
                                        <span className="text-zinc-300">{pool.name}</span>
                                    </motion.div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Network Box (Contains Ports) */}
                    <div className="relative bg-zinc-800/50 rounded-lg p-4 border border-zinc-700 overflow-hidden flex flex-col">
                        <div className="flex items-center gap-2 mb-3">
                            <Network className="h-5 w-5" style={{ color: primaryColor }} />
                            <span className="text-xs font-semibold text-zinc-400">{t('network')}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 align-start content-start">
                            {networks.slice(0, 8).map((net, i) => {
                                const isBridge = net.type === 'bridge' || net.name.startsWith('vmbr');
                                return (
                                    <motion.div
                                        key={i}
                                        className={`h-6 rounded-sm flex items-center justify-center text-[8px] font-mono cursor-pointer border ${net.state === 'UP'
                                            ? isBridge ? 'bg-purple-500/30 border-purple-500/50' : 'bg-green-500/30 border-green-500/50'
                                            : 'bg-zinc-700/50 border-zinc-600'
                                            }`}
                                        onHoverStart={() => { setHoveredComponent('net'); setDetailData(net); }}
                                        onHoverEnd={() => { setHoveredComponent(null); setDetailData(null); }}
                                        whileHover={{ scale: 1.1, zIndex: 10, borderColor: '#fff' }}
                                    >
                                        <span className={net.state === 'UP' ? 'text-white' : 'text-zinc-500'}>{net.name}</span>
                                    </motion.div>
                                )
                            })}
                        </div>
                    </div>
                </div>

                {/* Central Detail Overlay Pointer (Optional, or just display the overly fixed on the right/bottom) */}
                {/* Actually, user wanted "not just simple info from bottom". 
                     I will display the info in a dedicated "Monitor Screen" overlay or floating tooltip.
                     Let's use a Floating Info Panel right over the component grid?
                     Or replace the bottom bar instructions with the Details?
                     Let's overlay the specific component if its large enough, or use a fixed area.
                     Given the layout, a Fixed Area on top of the grid (glassmorphism) might be best.
                  */}

                <AnimatePresence>
                    {hoveredComponent && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.1 }}
                            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 min-h-48 max-h-80 overflow-y-auto bg-zinc-900/95 border border-zinc-600 rounded-lg shadow-2xl p-4 backdrop-blur-md z-50 pointer-events-none"
                        >
                            {renderDetailContent()}
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Bottom Info Bar (Static) */}
                <div className="mt-6 pt-4 border-t border-zinc-700 flex items-center justify-between text-xs text-zinc-500">
                    <div className="flex items-center gap-4">
                        <span className="font-mono text-zinc-300">{system.hostname}</span>
                        <span>{system.os}</span>
                        <span className="font-mono text-[10px]">{system.kernel}</span>
                    </div>
                    <div>
                        <span className="text-zinc-400">{t('uptime')}: {system.uptime}</span>
                    </div>
                </div>

            </div>
            <p className="text-center text-xs text-muted-foreground mt-4">
                {t('hoverForDetails')}
            </p>
        </div>
    );
}

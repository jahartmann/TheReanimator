/**
 * Library page - provisioning profiles / VM templates.
 */

import React, { useState } from 'react';
import { useApi } from '../hooks/useApi';
import {
  BookOpen, RefreshCw, ChevronDown, ChevronRight,
  Container, Activity, Shield, Code, Globe, Settings,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProvisioningStep {
  id: number;
  profile_id: number;
  step_order: number;
  step_type: 'script' | 'file' | 'packages';
  name: string;
  content: string;
  target_path: string | null;
}

interface ProvisioningProfile {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  created_at: string;
  steps: ProvisioningStep[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function profileIcon(icon: string | null) {
  switch (icon) {
    case 'container':  return <Container className="h-5 w-5" />;
    case 'activity':   return <Activity className="h-5 w-5" />;
    case 'shield':     return <Shield className="h-5 w-5" />;
    case 'code':       return <Code className="h-5 w-5" />;
    case 'globe':      return <Globe className="h-5 w-5" />;
    default:           return <Settings className="h-5 w-5" />;
  }
}

function stepTypeColor(type: string): string {
  switch (type) {
    case 'script':   return 'text-blue-600 bg-blue-50 border-blue-200';
    case 'file':     return 'text-amber-600 bg-amber-50 border-amber-200';
    case 'packages': return 'text-green-600 bg-green-50 border-green-200';
    default:         return 'text-muted-foreground bg-muted border-border';
  }
}

// ─── Profile card ─────────────────────────────────────────────────────────────

function ProfileCard({ profile }: { profile: ProvisioningProfile }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="border-muted/60 hover:border-primary/30 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-2 rounded-md text-primary">
              {profileIcon(profile.icon)}
            </div>
            <div>
              <CardTitle className="text-sm">{profile.name}</CardTitle>
              {profile.description && (
                <p className="text-xs text-muted-foreground mt-0.5">{profile.description}</p>
              )}
            </div>
          </div>
          <Badge variant="secondary" className="text-xs shrink-0">
            {profile.steps.length} steps
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-xs text-primary hover:underline mb-2"
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {expanded ? 'Hide steps' : 'Show steps'}
        </button>

        {expanded && (
          <div className="space-y-2">
            {profile.steps
              .sort((a, b) => a.step_order - b.step_order)
              .map((step) => (
                <div key={step.id} className="flex items-start gap-2.5">
                  <span className="text-xs text-muted-foreground w-4 shrink-0 mt-0.5 text-right">
                    {step.step_order}.
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium">{step.name}</span>
                      <Badge variant="outline" className={`text-[9px] ${stepTypeColor(step.step_type)}`}>
                        {step.step_type}
                      </Badge>
                    </div>
                    <pre className="text-[10px] font-mono text-muted-foreground bg-muted/40 p-1.5 rounded overflow-auto max-h-20 whitespace-pre-wrap break-all">
                      {step.step_type === 'packages'
                        ? (() => { try { return JSON.parse(step.content).join(', '); } catch { return step.content; } })()
                        : step.content.length > 200 ? step.content.slice(0, 200) + '...' : step.content}
                    </pre>
                  </div>
                </div>
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Library page ─────────────────────────────────────────────────────────────

export default function LibraryPage() {
  const { data, loading, error, refetch } = useApi<ProvisioningProfile[]>('/api/library');
  const profiles = data ?? [];

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Library</h1>
            <p className="text-sm text-muted-foreground">
              Provisioning profiles for automated VM and container setup
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Info */}
        <div className="p-4 rounded-lg bg-primary/5 border border-primary/20 text-sm">
          Provisioning profiles are Ansible-style templates that run on new VMs via SSH.
          Ask the AI Agent to "Apply the Docker Ready profile to VM 100 on server X" to execute them.
        </div>

        {error && (
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
            {error}
          </div>
        )}

        {loading && profiles.length === 0 && (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        )}

        {!loading && profiles.length === 0 && !error && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 space-y-3">
              <BookOpen className="h-12 w-12 text-muted-foreground/50" />
              <div className="text-center space-y-1">
                <p className="font-medium">No provisioning profiles</p>
                <p className="text-sm text-muted-foreground">
                  Default profiles are created automatically on first run.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {profiles.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {profiles.map((profile) => (
              <ProfileCard key={profile.id} profile={profile} />
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

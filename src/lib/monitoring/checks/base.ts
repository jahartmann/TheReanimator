/**
 * Abstract base class for all monitor checks.
 */

export type CheckStatus = 'ok' | 'warning' | 'critical' | 'error';

export interface CheckResult {
    status: CheckStatus;
    value?: number;
    message: string;
    details?: Record<string, any>;
}

export interface CheckConfig {
    id: number;
    name: string;
    check_type: string;
    server_id: number | null;
    vm_id: number | null;
    enabled: boolean;
    interval_minutes: number;
    threshold_warning: Record<string, any>;
    threshold_critical: Record<string, any>;
    notification_channels: string[];
    notification_mode: string;
    last_check: string | null;
    last_status: string;
    consecutive_failures: number;
}

export abstract class MonitorCheck {
    protected config: CheckConfig;

    constructor(config: CheckConfig) {
        this.config = config;
    }

    abstract execute(): Promise<CheckResult>;

    /**
     * Evaluate a numeric value against warning/critical thresholds.
     */
    protected evaluateThreshold(value: number, field: string = 'value'): CheckStatus {
        const critical = this.config.threshold_critical[field];
        const warning = this.config.threshold_warning[field];

        if (critical !== undefined && value >= critical) return 'critical';
        if (warning !== undefined && value >= warning) return 'warning';
        return 'ok';
    }

    get name(): string { return this.config.name; }
    get checkType(): string { return this.config.check_type; }
}

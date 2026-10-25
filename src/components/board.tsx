'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DependencyReport, DependencyState, ServiceReport, State, StatusReport, UptimeSample } from '@/lib/aggregate';
import { uptimeRatio } from '@/lib/history';
import { SettingsPanel } from '@/components/settings';
import { ThemeToggle } from '@/components/theme-toggle';

const REFRESH_MS = 10_000;

export function Board() {
    const [report, setReport] = useState<StatusReport | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const closeSettings = useCallback(() => setSettingsOpen(false), []);

    const load = useCallback(async (refresh = false) => {
        if (refresh) setRefreshing(true);
        try {
            const response = await fetch(refresh ? '/api/status?refresh=1' : '/api/status', { cache: 'no-store' });
            if (response.status === 401) {
                window.location.assign('/');
                return;
            }
            if (!response.ok) throw new Error('status request failed');
            const body = (await response.json()) as StatusReport;
            setReport(body);
            setError(null);
        } catch {
            setError('The checker could not refresh.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void load();
        }, 0);
        const interval = window.setInterval(() => {
            void load();
        }, REFRESH_MS);
        return () => {
            window.clearTimeout(timer);
            window.clearInterval(interval);
        };
    }, [load]);

    const services = report?.services ?? [];
    const up = services.filter(service => service.state === 'up').length;
    const degraded = services.filter(service => service.state === 'degraded').length;
    const down = services.filter(service => service.state === 'down').length;
    const samples = services.flatMap(service => report?.history?.[service.id] ?? []);
    const uptime = uptimeRatio(samples);

    return (
        <div className="shell">
            <header className="mast">
                <div>
                    <p className="eyebrow">Operations</p>
                    <h1>App Health Checker</h1>
                </div>
                <div className="actions">
                    <ThemeToggle />
                    <button type="button" onClick={() => void signOut()}>Sign out</button>
                    <button type="button" onClick={() => setSettingsOpen(true)} aria-expanded={settingsOpen}>
                        Settings
                    </button>
                    <button type="button" className="primary" onClick={() => void load(true)} disabled={refreshing}>
                        {refreshing ? 'Checking…' : 'Check now'}
                    </button>
                </div>
            </header>
            <main className="page">

            {error ? <p className="banner warn">{error}</p> : null}

            {loading && !report ? (
                <p className="banner">Checking apps…</p>
            ) : report ? (
                <>
                    <section className="widgets" aria-label="Overall">
                        <article className={`widget state-${report.state}`}>
                            <h2>Overall</h2>
                            <p className="widget-value">{stateLabel(report.state)}</p>
                            <p>{headline(report.state)}</p>
                        </article>
                        <article className="widget">
                            <h2>Responding</h2>
                            <p className="widget-value">{up}<span> / {services.length}</span></p>
                            <p>{degraded} degraded, {down} down</p>
                        </article>
                        <article className="widget">
                            <h2>Uptime</h2>
                            <p className="widget-value">{uptime == null ? '—' : `${Math.round(uptime * 100)}%`}</p>
                            <p>{samples.length === 0 ? 'Builds as checks run' : `${samples.length} recorded checks`}</p>
                        </article>
                        <article className="widget">
                            <h2>Alerts</h2>
                            <p className="widget-value">{report.alerts === 'on' ? 'On' : 'Off'}</p>
                            <p>Checked {formatTime(report.checkedAt)}. Every {Math.round(report.pollMs / 1000)}s.</p>
                        </article>
                    </section>

                    {services.length === 0 ? (
                        <p className="banner">No apps are watched. Add one in Settings.</p>
                    ) : (
                        <ul className="app-rows">
                            {services.map(service => (
                                <AppRow key={service.id} service={service} samples={report.history?.[service.id] ?? []} />
                            ))}
                        </ul>
                    )}
                </>
            ) : null}

            {settingsOpen ? <SettingsPanel onClose={closeSettings} onSaved={() => void load(true)} /> : null}
            </main>
        </div>
    );
}

async function signOut() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.assign('/');
}

function AppRow({ service, samples }: { service: ServiceReport; samples: UptimeSample[] }) {
    const ratio = uptimeRatio(samples);
    return (
        <li className="app-row">
            <article className={`info state-${service.state}`}>
                <div className="card-top">
                    <h3>{service.name}</h3>
                    <span className="pill">{stateLabel(service.state)}</span>
                </div>
                <dl>
                    <div>
                        <dt>Response</dt>
                        <dd>{formatLatency(service.latencyMs)}</dd>
                    </div>
                    <div>
                        <dt>Version</dt>
                        <dd>{service.version ?? '—'}</dd>
                    </div>
                    <div>
                        <dt>Uptime</dt>
                        <dd>{ratio == null ? '—' : `${Math.round(ratio * 100)}%`}</dd>
                    </div>
                </dl>
                {service.detail ? <p className="detail">{service.detail}</p> : null}
                {service.dependencies.length > 0 ? (
                    <ul className="deps">
                        {service.dependencies.map(dependency => (
                            <DependencyRow key={dependency.id} dependency={dependency} />
                        ))}
                    </ul>
                ) : null}
            </article>
            <UptimeGraph name={service.name} samples={samples} ratio={ratio} />
        </li>
    );
}

const HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

function UptimeGraph({ name, samples, ratio }: { name: string; samples: UptimeSample[]; ratio: number | null }) {
    const slots = hourSlots(samples);
    const label = ratio == null
        ? `${name} uptime is waiting for checks`
        : `${name} uptime ${Math.round(ratio * 100)} percent over the last 24 hours`;
    return (
        <section className="graph" aria-label={label}>
            <div className="graph-top">
                <h3>Uptime</h3>
                <p>{ratio == null ? 'Waiting for checks' : `${Math.round(ratio * 100)}% up`}</p>
            </div>
            <div className="hours" role="img">
                {slots.map(slot => (
                    <span
                        key={slot.at}
                        className={`hour state-${slot.state}`}
                        title={slot.state === 'empty' ? `${formatHour(slot.at)} No checks` : `${formatHour(slot.at)} ${stateLabel(slot.state)}`}
                    />
                ))}
            </div>
            <p className="graph-scale">Last 24 hours · one block per hour</p>
        </section>
    );
}

function hourSlots(samples: UptimeSample[], now = Date.now()): Array<{ at: number; state: State | 'empty' }> {
    const start = now - HOURS * HOUR_MS;
    const slots = Array.from({ length: HOURS }, (_, index) => ({
        at: start + index * HOUR_MS,
        state: 'empty' as State | 'empty',
        rank: 0,
    }));
    for (const sample of samples) {
        const time = Date.parse(sample.at);
        if (!Number.isFinite(time) || time < start || time > now) continue;
        const index = Math.min(HOURS - 1, Math.floor((time - start) / HOUR_MS));
        const rank = sample.state === 'down' ? 3 : sample.state === 'degraded' ? 2 : 1;
        const slot = slots[index];
        if (!slot || rank < slot.rank) continue;
        slot.state = sample.state;
        slot.rank = rank;
    }
    return slots.map(({ at, state }) => ({ at, state }));
}

function DependencyRow({ dependency }: { dependency: DependencyReport }) {
    return (
        <li className={`dep state-${dependency.state}`}>
            <span className="lamp" aria-hidden="true" />
            <span className="dep-name">{dependency.name}</span>
            <span className="dep-state">{dependency.state === 'skipped' ? 'Not used' : stateLabel(dependency.state)}</span>
            <span className="dep-meta">{dependencyMeta(dependency)}</span>
        </li>
    );
}

function headline(state: State): string {
    if (state === 'up') return 'All apps are responding';
    if (state === 'degraded') return 'An app is up with a failing check';
    return 'An app is not responding';
}

function stateLabel(state: State | DependencyState): string {
    if (state === 'up') return 'Up';
    if (state === 'degraded') return 'Degraded';
    if (state === 'skipped') return 'Not used';
    return 'Down';
}

function formatLatency(ms: number | null): string {
    if (ms == null) return '—';
    return `${ms} ms`;
}

function dependencyMeta(dependency: DependencyReport): string {
    if (dependency.state === 'skipped') {
        return dependency.id === 'redis' ? 'SQL queue' : 'Not checked';
    }
    return dependency.detail ?? formatLatency(dependency.latencyMs);
}

function formatHour(at: number): string {
    return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

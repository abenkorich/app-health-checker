'use client';

import { useEffect, useState } from 'react';
import type { PublicSettings, ServiceSetting } from '@/lib/settings-model';

type Draft = PublicSettings & { smtpPassword: string };

export function SettingsPanel({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
    const [draft, setDraft] = useState<Draft | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    const [saving, setSaving] = useState(false);
    const [sending, setSending] = useState(false);
    const [sentSubject, setSentSubject] = useState<string | null>(null);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void fetch('/api/settings', { cache: 'no-store' })
                .then(async response => {
                    if (response.status === 401) {
                        window.location.assign('/');
                        return;
                    }
                    if (!response.ok) throw new Error('load failed');
                    const body = (await response.json()) as PublicSettings;
                    setDraft({ ...body, smtpPassword: '' });
                })
                .catch(() => setError('Settings could not be loaded.'));
        }, 0);
        return () => window.clearTimeout(timer);
    }, []);

    useEffect(() => {
        function onKey(event: KeyboardEvent) {
            if (event.key === 'Escape') onClose();
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    async function save() {
        if (!draft) return;
        setSaving(true);
        setSaved(false);
        setSentSubject(null);
        setError(null);
        try {
            const response = await fetch('/api/settings', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(draft),
            });
            if (response.status === 401) {
                window.location.assign('/');
                return;
            }
            const body = (await response.json()) as PublicSettings & { error?: string };
            if (!response.ok) throw new Error(body.error || 'Save failed.');
            setDraft({ ...body, smtpPassword: '' });
            setSaved(true);
            onSaved();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Save failed.');
        } finally {
            setSaving(false);
        }
    }

    async function sendStatus() {
        setSending(true);
        setSentSubject(null);
        setError(null);
        try {
            const response = await fetch('/api/email', { method: 'POST' });
            if (response.status === 401) {
                window.location.assign('/');
                return;
            }
            const body = (await response.json()) as { subject?: string; error?: string };
            if (!response.ok) throw new Error(body.error || 'The status email could not be sent.');
            setSentSubject(body.subject ?? 'Status email sent.');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'The status email could not be sent.');
        } finally {
            setSending(false);
        }
    }

    return (
        <div className="drawer-root">
            <button type="button" className="drawer-backdrop" aria-label="Close settings" onClick={onClose} />
            <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="settings-title">
                <header className="drawer-head">
                    <div>
                        <p className="eyebrow">Configuration</p>
                        <h2 id="settings-title">Settings</h2>
                    </div>
                    <button type="button" onClick={onClose}>Close</button>
                </header>
                <p className="drawer-note">The sign-in key stays in <code>STATUS_SECRET</code>. Everything else on this pane is saved here and replaces the environment after the first save.</p>
                {!draft && !error ? <p className="banner">Loading settings…</p> : null}
                {!draft && error ? <p className="banner warn">{error}</p> : null}
                {draft ? (
                    <form
                        className="settings"
                        onSubmit={event => {
                            event.preventDefault();
                            void save();
                        }}
                    >
                        <fieldset>
                            <legend>Checks</legend>
                            <div className="settings-grid">
                                <label>
                                    Check every (seconds)
                                    <input
                                        type="number"
                                        min={15}
                                        max={86400}
                                        value={draft.pollSeconds}
                                        onChange={event => setDraft({ ...draft, pollSeconds: Number(event.target.value) })}
                                    />
                                </label>
                                <label>
                                    Timeout (seconds)
                                    <input
                                        type="number"
                                        min={1}
                                        max={10}
                                        value={draft.timeoutSeconds}
                                        onChange={event => setDraft({ ...draft, timeoutSeconds: Number(event.target.value) })}
                                    />
                                </label>
                            </div>
                        </fieldset>

                        <fieldset>
                            <legend>Email</legend>
                            <div className="settings-grid">
                                <label>
                                    Email when
                                    <select
                                        value={draft.alertOn}
                                        onChange={event => setDraft({
                                            ...draft,
                                            alertOn: event.target.value === 'down' ? 'down' : 'down-and-degraded',
                                        })}
                                    >
                                        <option value="down-and-degraded">An app is down or degraded</option>
                                        <option value="down">An app is down</option>
                                    </select>
                                </label>
                                <label>
                                    Remind every (minutes)
                                    <input
                                        type="number"
                                        min={1}
                                        max={1440}
                                        value={draft.remindMinutes}
                                        onChange={event => setDraft({ ...draft, remindMinutes: Number(event.target.value) })}
                                    />
                                </label>
                                <label className="span">
                                    Recipients
                                    <input
                                        type="text"
                                        value={draft.recipients}
                                        placeholder="ops@example.com, oncall@example.com"
                                        onChange={event => setDraft({ ...draft, recipients: event.target.value })}
                                    />
                                </label>
                                <label>
                                    From
                                    <input type="text" value={draft.from} onChange={event => setDraft({ ...draft, from: event.target.value })} />
                                </label>
                                <label>
                                    SMTP host
                                    <input type="text" value={draft.smtpHost} onChange={event => setDraft({ ...draft, smtpHost: event.target.value })} />
                                </label>
                                <label>
                                    SMTP port
                                    <input
                                        type="number"
                                        min={1}
                                        max={65535}
                                        value={draft.smtpPort}
                                        onChange={event => setDraft({ ...draft, smtpPort: Number(event.target.value) })}
                                    />
                                </label>
                                <label>
                                    SMTP user
                                    <input
                                        type="text"
                                        autoComplete="off"
                                        value={draft.smtpUser}
                                        onChange={event => setDraft({ ...draft, smtpUser: event.target.value })}
                                    />
                                </label>
                                <label className="span">
                                    SMTP password
                                    <input
                                        type="password"
                                        autoComplete="new-password"
                                        value={draft.smtpPassword}
                                        placeholder={draft.passwordSet ? 'Saved. Leave blank to keep it.' : ''}
                                        onChange={event => setDraft({ ...draft, smtpPassword: event.target.value })}
                                    />
                                </label>
                            </div>
                            <div className="settings-actions">
                                <button type="button" onClick={() => void sendStatus()} disabled={sending}>
                                    {sending ? 'Sending…' : 'Send status'}
                                </button>
                                {sentSubject ? <p className="ok">Sent. {sentSubject}</p> : null}
                            </div>
                            <p className="drawer-note">Sends a live check to the saved recipients. Save email settings before sending.</p>
                        </fieldset>

                        <fieldset>
                            <legend>Apps</legend>
                            <ul className="app-editor">
                                {draft.services.map(service => (
                                    <li key={service.id}>
                                        <div className="app-editor-top">
                                            <label className="check">
                                                <input
                                                    type="checkbox"
                                                    checked={service.enabled}
                                                    onChange={event => updateService(service.id, { enabled: event.target.checked })}
                                                />
                                                Watched
                                            </label>
                                            <button type="button" onClick={() => removeService(service.id)}>Remove</button>
                                        </div>
                                        <label>
                                            Name
                                            <input
                                                type="text"
                                                value={service.name}
                                                onChange={event => updateService(service.id, { name: event.target.value })}
                                            />
                                        </label>
                                        <label>
                                            Type
                                            <select
                                                value={service.type}
                                                onChange={event => {
                                                    const type = event.target.value === 'api' ? 'api' : 'web-app';
                                                    updateService(service.id, { type, kind: type === 'api' ? 'platform' : 'http' });
                                                }}
                                            >
                                                <option value="api">API</option>
                                                <option value="web-app">Web app</option>
                                            </select>
                                        </label>
                                        <label>
                                            Health URL
                                            <input
                                                type="url"
                                                value={service.healthUrl}
                                                placeholder="https://example.com/health"
                                                onChange={event => updateService(service.id, { healthUrl: event.target.value })}
                                            />
                                        </label>
                                        {service.type === 'api' ? (
                                            <>
                                                <label>
                                                    Ready URL
                                                    <input
                                                        type="url"
                                                        value={service.readyUrl}
                                                        placeholder="Optional readiness check"
                                                        onChange={event => updateService(service.id, { readyUrl: event.target.value })}
                                                    />
                                                </label>
                                                <label>
                                                    Worker URL
                                                    <input
                                                        type="url"
                                                        value={service.workerUrl}
                                                        placeholder="http://127.0.0.1:3020/health"
                                                        onChange={event => updateService(service.id, { workerUrl: event.target.value })}
                                                    />
                                                </label>
                                                <label>
                                                    Redis URL
                                                    <input
                                                        type="text"
                                                        value={service.redisUrl}
                                                        placeholder="redis://127.0.0.1:6379"
                                                        spellCheck={false}
                                                        onChange={event => updateService(service.id, { redisUrl: event.target.value })}
                                                    />
                                                </label>
                                            </>
                                        ) : (
                                            <label>
                                                Homepage URL
                                                <input
                                                    type="url"
                                                    value={service.homeUrl}
                                                    placeholder="Optional curl of the public page"
                                                    onChange={event => updateService(service.id, { homeUrl: event.target.value })}
                                                />
                                            </label>
                                        )}
                                    </li>
                                ))}
                            </ul>
                            <button type="button" onClick={addService}>Add app</button>
                        </fieldset>

                        <div className="settings-actions">
                            <button type="submit" className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
                            {saved ? <p className="ok">Saved. The board uses these apps on the next check.</p> : null}
                            {error ? <p className="banner warn">{error}</p> : null}
                        </div>
                    </form>
                ) : null}
            </aside>
        </div>
    );

    function updateService(id: string, patch: Partial<ServiceSetting>) {
        setDraft(current => {
            if (!current) return current;
            return {
                ...current,
                services: current.services.map(service => (service.id === id ? { ...service, ...patch } : service)),
            };
        });
    }

    function removeService(id: string) {
        setDraft(current => {
            if (!current) return current;
            return { ...current, services: current.services.filter(service => service.id !== id) };
        });
    }

    function addService() {
        setDraft(current => {
            if (!current) return current;
            const id = newAppId(current.services.map(service => service.id));
            return {
                ...current,
                services: [...current.services, { id, name: 'New app', type: 'web-app', kind: 'http', enabled: true, healthUrl: '', readyUrl: '', homeUrl: '', workerUrl: '', redisUrl: '' }],
            };
        });
    }
}

function newAppId(used: string[]): string {
    const taken = new Set(used);
    let id = '';
    do {
        const bytes = new Uint8Array(4);
        crypto.getRandomValues(bytes);
        id = `app-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
    } while (taken.has(id));
    return id;
}

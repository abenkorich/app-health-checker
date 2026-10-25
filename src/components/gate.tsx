'use client';

import { useState, type FormEvent } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';

export function Gate({ mode }: { mode: 'unset' | 'login' }) {
    const [secret, setSecret] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);

    async function submit(event: FormEvent) {
        event.preventDefault();
        setPending(true);
        setError(null);
        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ secret }),
            });
            if (response.status === 429) {
                setError('Too many attempts. Wait a few minutes and try again.');
                return;
            }
            if (!response.ok) {
                setError('That key does not match.');
                return;
            }
            window.location.assign('/');
        } catch {
            setError('The status service could not be reached.');
        } finally {
            setPending(false);
        }
    }

    return (
        <main className="gate">
            <ThemeToggle />
            <section className="gate-card">
                <p className="eyebrow">App Health Checker</p>
                <h1>{mode === 'unset' ? 'Checker is locked' : 'Sign in'}</h1>
                {mode === 'unset' ? (
                    <>
                        <p>Set a secret in the environment, then restart this app. Checks keep running in the background.</p>
                        <pre>{`# app-health-checker/.env.local\nSTATUS_SECRET=a-long-random-value`}</pre>
                    </>
                ) : (
                    <form onSubmit={event => void submit(event)}>
                        <p>Enter the key from <code>STATUS_SECRET</code>.</p>
                        <label>
                            Secret key
                            <input
                                type="password"
                                name="secret"
                                autoComplete="current-password"
                                required
                                value={secret}
                                onChange={event => setSecret(event.target.value)}
                            />
                        </label>
                        {error ? <p className="gate-error">{error}</p> : null}
                        <button type="submit" className="primary" disabled={pending}>{pending ? 'Checking…' : 'Continue'}</button>
                    </form>
                )}
            </section>
        </main>
    );
}

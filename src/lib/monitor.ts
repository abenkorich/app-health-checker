import fs from 'node:fs';
import path from 'node:path';
import type { StatusReport } from './aggregate';
import { planAlerts, statusSnapshot, type AlertMemory } from './alerts';
import { collectStatus } from './collect';
import { appendHistory, type History } from './history';
import { sendAlertEmail } from './mail';
import { mailFromSettings } from './settings-model';
import { loadConfig } from './settings-store';

type Stored = {
    at: number;
    body: StatusReport;
    previous: Array<[string, AlertMemory]> | null;
};

const dir = path.join(process.cwd(), '.status');
const lockDir = path.join(dir, 'lock');
const cacheFile = path.join(dir, 'report.json');
const historyFile = path.join(dir, 'history.json');
const SLOT = '__appHealthCheckerMonitor';

function startedFlag(): { started: boolean; warnedOff: boolean; timer: ReturnType<typeof setTimeout> | null } {
    const g = globalThis as typeof globalThis & {
        [SLOT]?: { started: boolean; warnedOff: boolean; timer: ReturnType<typeof setTimeout> | null };
    };
    g[SLOT] ??= { started: false, warnedOff: false, timer: null };
    return g[SLOT];
}

/** Probe on a timer, even when the board has no open browser. */
export function startMonitor(): void {
    const flag = startedFlag();
    if (flag.started) return;
    flag.started = true;
    const settings = loadConfig();
    console.log(
        `App Health Checker started. Checks every ${settings.pollSeconds}s. Email alerts ${mailFromSettings(settings) ? 'on' : 'off'}.`,
    );
    void currentReport(false).finally(() => arm(loadConfig().pollSeconds * 1000));
}

/** The next wait uses the saved interval, including a change made in Settings. */
export function applySchedule(): void {
    if (!startedFlag().started) return;
    arm(loadConfig().pollSeconds * 1000);
}

function arm(delayMs: number): void {
    const flag = startedFlag();
    if (flag.timer) clearTimeout(flag.timer);
    flag.timer = setTimeout(() => {
        flag.timer = null;
        void currentReport(false).finally(() => arm(loadConfig().pollSeconds * 1000));
    }, delayMs);
    flag.timer.unref?.();
}

export function currentReport(refresh: boolean): Promise<StatusReport> {
    return withLock(() => checkOnce(refresh));
}

/** Probe now and mail the board. Does not move the reminder clock. */
export async function sendStatusEmail(): Promise<{ ok: true; subject: string } | { ok: false; error: string }> {
    const settings = loadConfig();
    const mail = mailFromSettings(settings);
    if (!mail) return { ok: false, error: 'Email needs a recipient, an SMTP host, and a from address. Save them first.' };
    try {
        const subject = await withLock(async () => {
            const report: StatusReport = { ...(await collectStatus(settings)), alerts: 'on' };
            const history = appendHistory(readHistory(), report.services, report.checkedAt);
            writeHistory(history);
            const stored = readStore();
            writeStore({ at: Date.now(), body: report, previous: stored?.previous ?? null });
            const email = statusSnapshot(report);
            await sendAlertEmail(email, mail);
            console.log(`Status email sent: ${email.subject}`);
            return email.subject;
        });
        return { ok: true, subject };
    } catch (err) {
        const reason = err instanceof Error ? err.message : 'The status email could not be sent.';
        console.error(`Status email failed: ${reason}`);
        return { ok: false, error: 'The status email could not be sent.' };
    }
}

async function checkOnce(refresh: boolean): Promise<StatusReport> {
    const settings = loadConfig();
    const interval = settings.pollSeconds * 1000;
    const stored = readStore();
    if (!refresh && stored && Date.now() - stored.at < interval) return attachHistory(stored.body);

    const mail = mailFromSettings(settings);
    const report: StatusReport = {
        ...(await collectStatus(settings)),
        alerts: mail ? 'on' : 'off',
    };
    const history = appendHistory(readHistory(), report.services, report.checkedAt);
    writeHistory(history);
    const published = attachHistory(report, history);
    if (!mail) {
        const flag = startedFlag();
        if (!flag.warnedOff) {
            console.warn('Email alerts are off. Open Settings to add a recipient and SMTP host.');
            flag.warnedOff = true;
        }
        writeStore({ at: Date.now(), body: report, previous: null });
        return published;
    }

    const planned = planAlerts({
        previous: stored?.previous ? new Map(stored.previous) : null,
        report,
        now: Date.now(),
        remindMs: settings.remindMinutes * 60_000,
        alertOn: settings.alertOn,
    });
    let sent = true;
    for (const email of planned.emails) {
        try {
            await sendAlertEmail(email, mail);
            console.log(`Alert sent: ${email.subject}`);
        } catch (err) {
            sent = false;
            const reason = err instanceof Error ? err.message : 'send failed';
            console.error(`Alert failed: ${reason}`);
        }
    }
    writeStore({
        at: Date.now(),
        body: report,
        previous: sent ? [...planned.next] : (stored?.previous ?? null),
    });
    return published;
}

function readHistory(): History {
    try {
        const parsed = JSON.parse(fs.readFileSync(historyFile, 'utf8')) as History;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function writeHistory(history: History): void {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(historyFile, JSON.stringify(history));
}

function attachHistory(report: StatusReport, history = readHistory()): StatusReport {
    return { ...report, history };
}

function readStore(): Stored | null {
    try {
        return JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as Stored;
    } catch {
        return null;
    }
}

function writeStore(stored: Stored): void {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(stored));
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
    fs.mkdirSync(dir, { recursive: true });
    const deadline = Date.now() + 15_000;
    for (;;) {
        try {
            fs.mkdirSync(lockDir);
            break;
        } catch (err) {
            const code = err instanceof Error && 'code' in err ? err.code : undefined;
            if (code !== 'EEXIST') throw err;
            const stale = Date.now() - lockAge() > 15_000;
            if (stale || Date.now() > deadline) fs.rmSync(lockDir, { recursive: true, force: true });
            else await delay(40);
        }
    }
    try {
        return await fn();
    } finally {
        fs.rmSync(lockDir, { recursive: true, force: true });
    }
}

function lockAge(): number {
    try {
        return fs.statSync(lockDir).mtimeMs;
    } catch {
        return Date.now();
    }
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

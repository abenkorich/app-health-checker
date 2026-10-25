import nodemailer from 'nodemailer';
import type { AlertEmail, MailConfig } from './alerts';

export async function sendAlertEmail(message: AlertEmail, config: MailConfig): Promise<void> {
    const transport = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    });
    await transport.sendMail({
        from: config.from,
        to: config.to.join(', '),
        subject: message.subject,
        text: message.text,
    });
}

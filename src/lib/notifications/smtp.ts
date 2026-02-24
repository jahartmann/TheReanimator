import nodemailer from 'nodemailer';
import db from '@/lib/db';

export async function sendEmail(subject: string, html: string) {
    const settings = db.prepare('SELECT key, value FROM settings WHERE key LIKE "smtp_%"').all() as { key: string, value: string }[];
    const config = settings.reduce((acc, curr) => ({ ...acc, [curr.key]: curr.value }), {}) as any;

    if (!config.smtp_host || !config.smtp_user) {
        console.warn('SMTP not configured.');
        return false;
    }

    const transporter = nodemailer.createTransport({
        host: config.smtp_host,
        port: parseInt(config.smtp_port) || 587,
        secure: config.smtp_secure === 'true', // true for 465, false for other ports
        auth: {
            user: config.smtp_user,
            pass: config.smtp_password,
        },
    });

    try {
        await transporter.sendMail({
            from: config.smtp_from || config.smtp_user,
            to: config.smtp_to || config.smtp_user, // Default to self/admin
            subject: `[Reanimator AI] ${subject}`,
            html: html,
        });
        return true;
    } catch (error) {
        console.error('SMTP Send Error:', error);
        return false;
    }
}

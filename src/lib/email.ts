import nodemailer from 'nodemailer';
import { getNotificationSettings } from '@/lib/actions/settings';
import fs from 'fs';
import path from 'path';

const CONTACTS_FILE = path.resolve(process.cwd(), 'data', 'contacts.json');

// --- CONTACT MANAGEMENT ---

export interface Contact {
    name: string;
    email: string;
}

export function getContacts(): Contact[] {
    if (!fs.existsSync(CONTACTS_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf-8'));
    } catch {
        return [];
    }
}

export function saveContact(name: string, email: string) {
    const contacts = getContacts();
    const existing = contacts.findIndex(c => c.name.toLowerCase() === name.toLowerCase());

    if (existing >= 0) {
        contacts[existing] = { name, email };
    } else {
        contacts.push({ name, email });
    }

    fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts, null, 2));
}

export function deleteContact(name: string) {
    let contacts = getContacts();
    contacts = contacts.filter(c => c.name.toLowerCase() !== name.toLowerCase());
    fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts, null, 2));
}

// --- SMTP LOGIC ---

// Optional config override for testing
interface SMTPConfig {
    host: string;
    port: number;
    user: string;
    password?: string; // Optional if not auth
    from?: string;
}

export async function sendEmail(to: string, subject: string, html: string, configOverride?: SMTPConfig): Promise<{ success: boolean, error?: string }> {
    try {
        let settings;
        if (configOverride) {
            settings = { smtp: configOverride };
        } else {
            settings = await getNotificationSettings();
        }

        const { host, port, user, password, from } = settings.smtp;

        if (!host) throw new Error('SMTP Host nicht konfiguriert.');

        console.log(`[Email] Attempting to send to ${to} via ${host}:${port} (User: ${user || 'none'})`);

        // IONOS recommended: smtp.ionos.com, Port 587 (STARTTLS) or 465 (SSL)
        const isSecure = port === 465;

        const transporter = nodemailer.createTransport({
            host,
            port,
            secure: isSecure, // true for 465, false for other ports
            auth: user ? { user, pass: password } : undefined,
            tls: {
                rejectUnauthorized: false,
                minVersion: 'TLSv1.2',
            },
            requireTLS: port === 587,
            debug: true,
            logger: true
        });

        console.log(`[Email] Configured Transport: Host=${host} Port=${port} Secure=${isSecure}`);

        await transporter.verify();
        console.log('[Email] Transporter verified successfully');

        const info = await transporter.sendMail({
            from: from || user || 'copilot@reanimator.local',
            to,
            subject,
            html
        });

        console.log('[Email] Message sent:', info.messageId);

        return { success: true };
    } catch (e: any) {
        console.error('[Email] Send Error Detailed:', {
            message: e.message,
            code: e.code,
            command: e.command,
            response: e.response
        });
        return { success: false, error: `${e.message} (Code: ${e.code || 'UNKNOWN'})` };
    }
}

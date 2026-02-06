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

export async function sendEmail(to: string, subject: string, html: string): Promise<{ success: boolean, error?: string }> {
    try {
        const settings = await getNotificationSettings();
        const { host, port, user, password, from } = settings.smtp;

        if (!host) throw new Error('SMTP Host nicht konfiguriert.');

        const transporter = nodemailer.createTransport({
            host,
            port,
            secure: port === 465, // true for 465, false for other ports
            auth: user ? { user, pass: password } : undefined,
            tls: {
                rejectUnauthorized: false // Often needed for local/self-signed certs
            }
        });

        await transporter.verify();

        const info = await transporter.sendMail({
            from: from || user || 'copilot@reanimator.local',
            to,
            subject,
            html
        });

        return { success: true };
    } catch (e: any) {
        console.error('Email Send Error:', e);
        return { success: false, error: e.message };
    }
}

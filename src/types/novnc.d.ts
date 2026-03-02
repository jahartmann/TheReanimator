declare module '@novnc/novnc/lib/rfb.js' {
    interface RFBOptions {
        shared?: boolean;
        credentials?: { password?: string; target?: string; username?: string };
        repeaterID?: string;
        wsProtocols?: string[];
    }

    class RFB {
        constructor(target: HTMLElement, urlOrChannel: string | WebSocket, options?: RFBOptions);

        // Properties
        viewOnly: boolean;
        focusOnClick: boolean;
        clipViewport: boolean;
        dragViewport: boolean;
        scaleViewport: boolean;
        resizeSession: boolean;
        showDotCursor: boolean;
        background: string;
        qualityLevel: number;
        compressionLevel: number;
        capabilities: { power: boolean };

        // Methods
        disconnect(): void;
        sendCredentials(credentials: { password?: string; target?: string; username?: string }): void;
        sendKey(keysym: number, code: string | null, down?: boolean): void;
        sendCtrlAltDel(): void;
        focus(): void;
        blur(): void;
        machineShutdown(): void;
        machineReboot(): void;
        machineReset(): void;
        clipboardPasteFrom(text: string): void;
        getImageData(): ImageData;
        toDataURL(type?: string, encoderOptions?: number): string;
        toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;

        // Events
        addEventListener(type: 'connect', listener: (e: CustomEvent) => void): void;
        addEventListener(type: 'disconnect', listener: (e: CustomEvent<{ clean: boolean }>) => void): void;
        addEventListener(type: 'credentialsrequired', listener: (e: CustomEvent<{ types: string[] }>) => void): void;
        addEventListener(type: 'securityfailure', listener: (e: CustomEvent<{ status: number; reason: string }>) => void): void;
        addEventListener(type: 'clipboard', listener: (e: CustomEvent<{ text: string }>) => void): void;
        addEventListener(type: 'bell', listener: (e: CustomEvent) => void): void;
        addEventListener(type: 'desktopname', listener: (e: CustomEvent<{ name: string }>) => void): void;
        addEventListener(type: 'capabilities', listener: (e: CustomEvent<{ capabilities: RFB['capabilities'] }>) => void): void;
        addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
        removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
    }

    export default RFB;
}

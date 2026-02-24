
import packageJson from '../../package.json';

// Version is read directly from package.json so it always reflects the installed release.
export const APP_VERSION: string = packageJson.version;
export const IS_BETA: boolean = packageJson.version.includes('beta') || packageJson.version.includes('alpha');

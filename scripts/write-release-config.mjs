import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );
const outputPath = path.join( __dirname, '..', 'apps', 'studio', 'src', 'release-config.ts' );

const storageMode = process.env.STUDIO_RELEASE_STORAGE || 'appscdn';
const updaterBaseUrl = process.env.STUDIO_UPDATER_BASE_URL?.trim() || null;
const autoUpdatesOverride = process.env.STUDIO_AUTO_UPDATES_ENABLED?.trim();

if ( autoUpdatesOverride && autoUpdatesOverride !== 'true' && autoUpdatesOverride !== 'false' ) {
	console.error( 'STUDIO_AUTO_UPDATES_ENABLED must be either true or false when set.' );
	process.exit( 1 );
}

const autoUpdatesEnabled = autoUpdatesOverride
	? autoUpdatesOverride === 'true'
	: storageMode !== 'r2' || updaterBaseUrl !== null;

const fileContents = `const releaseConfig = {\n\tupdaterBaseUrl: ${ JSON.stringify(
	updaterBaseUrl
) } as string | null,\n\tautoUpdatesEnabled: ${ autoUpdatesEnabled },\n} as const;\n\nexport default releaseConfig;\n`;

await fs.writeFile( outputPath, fileContents );
console.log( `Wrote release config to ${ outputPath }` );

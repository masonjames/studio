import fs from 'fs';
import os from 'os';
import nodePath from 'node:path';
import { BrowserWindow } from 'electron';
import * as Sentry from '@sentry/electron/main';
import { parseCliError, errorMessageContains } from '@studio/common/lib/cli-error';
import { isWordPressDirectory } from '@studio/common/lib/fs-utils';
import {
	bumpStat,
	getImporterMetric,
	StatsGroup,
	StatsMetric,
} from 'src/lib/bump-stats';
import { defaultImporterOptions, importBackup } from 'src/lib/import-export/import/import-manager';
import type { BackupArchiveInfo } from 'src/lib/import-export/import/types';
import type { ImportExportEventData } from 'src/lib/import-export/handle-events';
import { sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import { SiteServer } from 'src/site-server';
import { setupWordPressFilesOnly } from 'src/lib/wordpress-setup';

const DEBUG_LOG_MAX_LINES = 50;
const PM2_HOME = nodePath.join( os.homedir(), '.studio', 'pm2' );

function readLastLines( filePath: string, maxLines: number ): string[] | undefined {
	try {
		if ( ! fs.existsSync( filePath ) ) {
			return undefined;
		}
		const content = fs.readFileSync( filePath, 'utf-8' );
		const lines = content.split( '\n' ).filter( ( line ) => line.trim() );
		return lines.slice( -maxLines );
	} catch {
		return undefined;
	}
}

function readWordPressDebugLog( sitePath: string ): string[] | undefined {
	const debugLogPath = nodePath.join( sitePath, 'wp-content', 'debug.log' );
	return readLastLines( debugLogPath, DEBUG_LOG_MAX_LINES );
}

function readPm2Logs( siteId: string ): { stdout?: string[]; stderr?: string[] } {
	const logsDir = nodePath.join( PM2_HOME, 'logs' );
	const stdoutPath = nodePath.join( logsDir, `studio-site-${ siteId }-out.log` );
	const stderrPath = nodePath.join( logsDir, `studio-site-${ siteId }-error.log` );

	return {
		stdout: readLastLines( stdoutPath, DEBUG_LOG_MAX_LINES ),
		stderr: readLastLines( stderrPath, DEBUG_LOG_MAX_LINES ),
	};
}

function getRendererWindow() {
	const windows = BrowserWindow.getAllWindows();
	return BrowserWindow.getFocusedWindow() || windows[ 0 ] || null;
}

export async function importSiteBackupInternal(
	siteId: string,
	backupFile: BackupArchiveInfo,
	onProgress?: ( data: ImportExportEventData ) => void
): Promise< SiteDetails > {
	const site = SiteServer.get( siteId );
	if ( ! site ) {
		throw new Error( 'Site not found.' );
	}

	try {
		if ( ! isWordPressDirectory( site.details.path ) ) {
			await setupWordPressFilesOnly( site.details.path );
		}

		const onEvent = ( data: ImportExportEventData ) => {
			onProgress?.( data );
			sendIpcEventToRendererWithWindow( getRendererWindow(), 'on-import', data, siteId );
		};
		const result = await importBackup( backupFile, site.details, onEvent, defaultImporterOptions );

		bumpStat( StatsGroup.STUDIO_IMPORT, getImporterMetric( result.importerType ) );

		if ( result?.meta?.phpVersion ) {
			site.details.phpVersion = result.meta.phpVersion;
		}

		// Clear blueprint so it doesn't overwrite imported data on first start
		site.meta.blueprint = undefined;

		return site.details;
	} catch ( error ) {
		bumpStat( StatsGroup.STUDIO_IMPORT, StatsMetric.FAILURE );
		if (
			! ( error instanceof Error ) ||
			( ! error.message.includes( 'No suitable importer found for the provided backup contents' ) &&
				! error.message.includes( 'No suitable backup handler found for the provided backup file' ) )
		) {
			Sentry.captureException( error );
		}
		throw error;
	}
}

export async function startSiteServerInternal( id: string ): Promise< void > {
	const server = SiteServer.get( id );
	if ( ! server ) {
		return;
	}

	try {
		await server.start();
	} catch ( error ) {
		if ( errorMessageContains( error, 'Cannot allocate Wasm memory for new instance' ) ) {
			throw new Error( 'WASM_ERROR_NOT_ENOUGH_MEMORY' );
		}

		const contexts: Record< string, Record< string, unknown > > = {
			server: {
				running: server.details.running,
				phpVersion: server.details.phpVersion,
				port: server.details.port,
				hasCustomDomain: !! server.details.customDomain,
				httpsEnabled: !! server.details.enableHttps,
			},
		};

		const cliError = parseCliError( error );
		if ( cliError?.cliArgs ) {
			contexts.startup = cliError.cliArgs;
		}

		const debugLog = readWordPressDebugLog( server.details.path );
		if ( debugLog && debugLog.length > 0 ) {
			contexts.debugLog = { entries: debugLog };
		}

		const pm2Logs = readPm2Logs( id );
		if ( pm2Logs.stdout && pm2Logs.stdout.length > 0 ) {
			contexts.playgroundLogs = { entries: pm2Logs.stdout };
		}
		if ( pm2Logs.stderr && pm2Logs.stderr.length > 0 ) {
			contexts.playgroundErrors = { entries: pm2Logs.stderr };
		}

		Sentry.captureException( error, {
			tags: {
				provider: 'cli',
			},
			contexts,
		} );

		if ( errorMessageContains( error, '"unreachable" WASM instruction executed' ) ) {
			throw new Error( 'Please try disabling plugins and themes that might be causing the issue.' );
		}
		throw error;
	}

	console.log( `Server started for '${ server.details.name }'` );
}

export async function stopSiteServerInternal( id: string ): Promise< void > {
	const server = SiteServer.get( id );
	if ( ! server ) {
		return;
	}

	await server.stop();
}

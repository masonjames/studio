const fs = require( 'fs' );
const path = require( 'path' );
const crypto = require( 'crypto' );
const { EventEmitter } = require( 'events' );
const Module = require( 'module' );

Object.defineProperty( process.versions, 'electron', { value: '41.0.2' } );

const artifactPath = process.argv[ 2 ] || process.env.WPREMOTE_IMPORT_ARTIFACT;
if ( ! artifactPath ) {
	console.error( 'Usage: ts-node scripts/validate-wpremote-import.ts <artifact-path>' );
	process.exit( 1 );
}

const runId = crypto.randomUUID();
const appDataPath = `/tmp/studio-import-appdata-${ runId }`;
const sitePath = `/tmp/studio-wpremote-import-validation-site-${ runId }`;
const siteName = process.env.WPREMOTE_IMPORT_SITE_NAME || 'WP Remote Import Validation';

fs.rmSync( appDataPath, { recursive: true, force: true } );
fs.rmSync( sitePath, { recursive: true, force: true } );
fs.mkdirSync( appDataPath, { recursive: true } );
fs.mkdirSync( sitePath, { recursive: true } );
process.env.DEV_APP_DATA_PATH = appDataPath;

const appEvents = new EventEmitter();
const appPath = path.resolve( __dirname, '..' );
const fakeWindow = {
	isDestroyed: () => false,
	webContents: {
		isDestroyed: () => false,
		send: ( _channel: string, ..._args: unknown[] ) => undefined,
	},
};
const fakeElectron = {
	app: {
		getAppPath: () => appPath,
		getVersion: () => '1.7.8-beta1',
		getName: () => 'WP Studio',
		getPath: ( name: string ) => {
			if ( name === 'appData' ) {
				return process.env.DEV_APP_DATA_PATH || appDataPath;
			}
			if ( name === 'home' ) {
				return '/tmp';
			}
			if ( name === 'exe' ) {
				return process.execPath;
			}
			return '/tmp';
		},
		whenReady: async () => undefined,
		quit: () => undefined,
		exit: ( _code?: number ) => undefined,
		on: ( ...args: Parameters< typeof appEvents.on > ) => appEvents.on( ...args ),
		off: ( ...args: Parameters< typeof appEvents.off > ) => appEvents.off( ...args ),
		once: ( ...args: Parameters< typeof appEvents.once > ) => appEvents.once( ...args ),
		emit: ( ...args: Parameters< typeof appEvents.emit > ) => appEvents.emit( ...args ),
	},
	shell: {
		trashItem: async ( _path: string ) => undefined,
	},
	BrowserWindow: {
		fromWebContents: () => fakeWindow,
		getAllWindows: () => [ fakeWindow ],
		getFocusedWindow: () => fakeWindow,
	},
};

const originalLoad = Module._load;
Module._load = function ( request: string, parent: unknown, isMain: boolean ) {
	if ( request === 'electron' ) {
		return fakeElectron;
	}

	return originalLoad.apply( this, arguments as any );
};

const { SiteServer } = require( '../src/site-server' );
const { importBackup, defaultImporterOptions } = require(
	'../src/lib/import-export/import/import-manager'
);

const events: unknown[] = [];
let server: any;
let summary = {
	success: false,
	runId,
	artifactPath,
	appDataPath,
	sitePath,
	sampledEvents: events,
} as Record< string, unknown >;

( async () => {
	const siteId = crypto.randomUUID();
	const createResult = await SiteServer.create(
		{
			path: sitePath,
			siteId,
			name: siteName,
			phpVersion: '8.2',
			noStart: false,
		},
		{}
	);
	server = createResult.server;
	summary.siteId = siteId;

	const currentUrlResult = await server.executeWpCliCommand( 'option get siteurl', {
		skipPluginsAndThemes: true,
	} );
	const currentUrl = ( currentUrlResult.stdout || '' ).trim();
	if ( currentUrl.startsWith( 'http://localhost:' ) ) {
		const port = Number( currentUrl.split( ':' ).pop() );
		if ( ! Number.isNaN( port ) ) {
			server.details.port = port;
		}
	} else if ( currentUrl ) {
		server.details.customDomain = currentUrl.replace( /^https?:\/\//, '' );
		server.details.enableHttps = currentUrl.startsWith( 'https://' );
	}

	await server.stop();

	const result = await importBackup(
		{ path: artifactPath, type: 'application/tar+gzip' },
		server.details,
		( data: unknown ) => {
			if ( events.length < 50 ) {
				events.push( data );
			}
		},
		defaultImporterOptions
	);

	await server.start();

	const [ postSiteUrl, homeOption, activeTheme, blogName ] = await Promise.all( [
		server.executeWpCliCommand( 'option get siteurl', { skipPluginsAndThemes: true } ),
		server.executeWpCliCommand( 'option get home', { skipPluginsAndThemes: true } ),
		server.executeWpCliCommand( 'theme list --status=active --field=name', {
			skipPluginsAndThemes: true,
		} ),
		server.executeWpCliCommand( 'option get blogname', { skipPluginsAndThemes: true } ),
	] );

	summary = {
		...summary,
		success: true,
		siteId,
		importerType: result.importerType,
		meta: result.meta,
		currentUrlBeforeImport: currentUrl,
		currentUrlAfterImport: ( postSiteUrl.stdout || '' ).trim(),
		currentHomeAfterImport: ( homeOption.stdout || '' ).trim(),
		activeTheme: ( activeTheme.stdout || '' ).trim(),
		blogName: ( blogName.stdout || '' ).trim(),
		sampledEvents: events,
	};
} )()
	.catch( ( error: unknown ) => {
		const normalizedError =
			error instanceof Error
				? {
						name: error.name,
						message: error.message,
						stack: error.stack,
				  }
				: { message: String( error ) };

		summary = {
			...summary,
			success: false,
			error: normalizedError,
			sampledEvents: events,
		};
		process.exitCode = 1;
	} )
	.finally( async () => {
		if ( server ) {
			try {
				await server.stop();
			} catch ( error ) {
				console.error( 'Failed to stop server:', error );
			}
		}

		console.log( JSON.stringify( summary, null, 2 ) );
	} );

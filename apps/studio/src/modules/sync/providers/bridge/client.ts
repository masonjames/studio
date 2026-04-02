import { app } from 'electron';
import fs from 'fs';
import nodePath from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getSyncBackupTempPath } from 'src/lib/get-sync-backup-temp-path';
import { resolveStudioPullAvailability } from 'src/modules/sync/providers/pull-activation';
import { getExternalRemoteProvider } from 'src/modules/sync/providers/registry';
import {
	buildRemoteSiteKey,
	type RemoteProviderAccount,
	type SyncSite,
	type TestRemoteProviderAccountInput,
} from 'src/modules/sync/types';
import {
	bridgeBackupsResponseSchema,
	bridgeHealthResponseSchema,
	bridgeJobResponseSchema,
	bridgeSitesResponseSchema,
	type BridgeBackupManifest,
	type BridgeHealthResponse,
	type BridgeJob,
	type PublicBridgeSite,
} from './schemas';

export type BridgeRequestError = Error & {
	code?: string;
	status?: number;
	siteId?: string;
	activeJobId?: string;
	activeJobType?: 'backup' | 'export' | 'import' | 'restore';
};

export type BridgeAccountConnectionResult = {
	normalized: ReturnType< typeof normalizeBridgeAccountInput >;
	health: BridgeHealthResponse;
};

function isAllowedInsecureHost( host: string ) {
	return host === 'localhost' || host === '127.0.0.1';
}

export function normalizeBridgeUrl( value: string ): string {
	const parsed = new URL( value.trim() );
	if (
		parsed.protocol !== 'https:' &&
		! ( parsed.protocol === 'http:' && isAllowedInsecureHost( parsed.hostname ) )
	) {
		throw new Error( 'Bridge URL must use HTTPS unless it targets localhost.' );
	}

	parsed.pathname = parsed.pathname.replace( /\/+$/, '' ) || '/';
	return parsed.toString().replace( /\/$/, '' );
}

export function normalizeBridgeAccountInput( input: TestRemoteProviderAccountInput ) {
	const bridgeUrl = normalizeBridgeUrl( input.bridgeUrl );
	const tokenMode = input.tokenMode ?? ( input.mutateToken ? 'split' : 'single' );
	const readToken = input.readToken.trim();
	const mutateToken = ( tokenMode === 'single' ? input.readToken : input.mutateToken ?? '' ).trim();

	if ( ! readToken ) {
		throw new Error( 'A read token is required.' );
	}

	if ( ! mutateToken ) {
		throw new Error( 'A write token is required.' );
	}

	return {
		bridgeUrl,
		tokenMode,
		readToken,
		mutateToken,
	};
}

async function parseResponse( response: Response ): Promise< unknown > {
	const contentType = response.headers.get( 'content-type' ) ?? '';
	if ( contentType.includes( 'application/json' ) ) {
		return response.json();
	}
	return response.text();
}

async function requestJson< T >(
	account: { bridgeUrl: string; readToken: string; mutateToken: string },
	options: {
		path: string;
		method?: 'GET' | 'POST';
		token?: 'read' | 'mutate';
		body?: unknown;
		signal?: AbortSignal;
	},
	schema: { parse: ( value: unknown ) => T }
): Promise< T > {
	const method = options.method ?? 'GET';
	const token = options.token === 'mutate' ? account.mutateToken : account.readToken;
	const response = await fetch( `${ account.bridgeUrl }${ options.path }`, {
		method,
		headers: {
			Authorization: `Bearer ${ token }`,
			Accept: 'application/json',
			...( options.body ? { 'Content-Type': 'application/json' } : {} ),
		},
		body: options.body ? JSON.stringify( options.body ) : undefined,
		signal: options.signal,
	} );
	const parsed = await parseResponse( response );

	if ( ! response.ok ) {
		const message =
			typeof parsed === 'object' &&
			parsed &&
			'message' in parsed &&
			typeof parsed.message === 'string'
				? parsed.message
				: `Bridge request failed with status ${ response.status }.`;
		const error: BridgeRequestError = new Error( message );
		error.status = response.status;
		if (
			typeof parsed === 'object' &&
			parsed &&
			'error' in parsed &&
			typeof parsed.error === 'string'
		) {
			error.code = parsed.error;
		}
		if ( typeof parsed === 'object' && parsed ) {
			if ( 'siteId' in parsed && typeof parsed.siteId === 'string' ) {
				error.siteId = parsed.siteId;
			}
			if ( 'activeJobId' in parsed && typeof parsed.activeJobId === 'string' ) {
				error.activeJobId = parsed.activeJobId;
			}
			if (
				'activeJobType' in parsed &&
				( parsed.activeJobType === 'backup' ||
					parsed.activeJobType === 'export' ||
					parsed.activeJobType === 'import' ||
					parsed.activeJobType === 'restore' )
			) {
				error.activeJobType = parsed.activeJobType;
			}
		}
		throw error;
	}

	return schema.parse( parsed );
}

function extractSiteId( value: { siteId?: string; site_id?: string } ) {
	return value.siteId ?? value.site_id ?? '';
}

function assertJobMatchesSite( job: BridgeJob, expectedSiteId: string ) {
	const actualSiteId = extractSiteId( job );
	if ( ! actualSiteId ) {
		throw new Error( 'The bridge returned a job payload without a site ID.' );
	}
	if ( actualSiteId !== expectedSiteId ) {
		throw new Error(
			`The bridge returned job data for site "${ actualSiteId }" while "${ expectedSiteId }" was expected.`
		);
	}
}

function assertBackupsMatchSite( backups: BridgeBackupManifest[], expectedSiteId: string ) {
	backups.forEach( ( backup ) => {
		const actualSiteId = extractSiteId( backup );
		if ( actualSiteId && actualSiteId !== expectedSiteId ) {
			throw new Error(
				`The bridge returned a backup for site "${ actualSiteId }" while "${ expectedSiteId }" was expected.`
			);
		}
	} );
}

const BRIDGE_PULL_ROUTE_DISABLED_MESSAGE =
	'This bridge can list sites, but it does not support the backup and export routes required for pull.';

function getProviderLabel( provider: RemoteProviderAccount[ 'provider' ] ) {
	return getExternalRemoteProvider( provider )?.providerLabel ?? provider;
}

function bridgeRoutesAllowPull( health: BridgeHealthResponse ) {
	if ( ! health.routeSupport ) {
		return true;
	}

	return Boolean( health.routeSupport.backupInventory && health.routeSupport.export );
}

function assertBridgeSupportsProvider(
	provider: TestRemoteProviderAccountInput[ 'provider' ],
	health: BridgeHealthResponse
) {
	const advertisedSupport = health.providerSupport?.[ provider ];

	if ( provider === 'mainwpBridge' ) {
		if ( advertisedSupport !== false ) {
			return;
		}
	} else if ( advertisedSupport === true ) {
		return;
	}

	throw new Error(
		`This bridge does not advertise support for ${ getProviderLabel( provider ) }.`
	);
}

function resolveBridgeSiteProvider( account: RemoteProviderAccount, site: PublicBridgeSite ) {
	if ( site.provider ) {
		return site.provider;
	}

	if ( account.provider === 'mainwpBridge' ) {
		return account.provider;
	}

	throw new Error(
		'Bridge site responses must include an explicit provider before non-MainWP providers can reuse this site mapping.'
	);
}

function bridgeSiteBelongsToAccount(
	account: RemoteProviderAccount,
	site: PublicBridgeSite
): boolean {
	if ( site.provider ) {
		return site.provider === account.provider;
	}

	return account.provider === 'mainwpBridge';
}

function toSyncSite(
	account: RemoteProviderAccount,
	site: PublicBridgeSite,
	health: BridgeHealthResponse
): SyncSite {
	const siteProvider = resolveBridgeSiteProvider( account, site );
	if ( siteProvider !== account.provider ) {
		throw new Error(
			`The bridge returned site "${ site.id }" for provider "${ siteProvider }" while "${ account.provider }" was expected.`
		);
	}

	const routeSupportAllowsPull = bridgeRoutesAllowPull( health );
	const bridgeCanPull = Boolean(
		site.capabilities.pull &&
			site.capabilities.backupCreate !== false &&
			site.capabilities.backupsRead !== false
	);
	const pullAvailability = resolveStudioPullAvailability( {
		provider: siteProvider,
		providerCanPull: bridgeCanPull && routeSupportAllowsPull,
		disabledReason:
			site.metadata?.notes ??
			( routeSupportAllowsPull ? undefined : BRIDGE_PULL_ROUTE_DISABLED_MESSAGE ),
	} );

	return {
		id: buildRemoteSiteKey( siteProvider, site.id ),
		remoteSiteId: site.id,
		provider: siteProvider,
		providerLabel: getProviderLabel( siteProvider ),
		providerAccountId: account.id,
		localSiteId: '',
		name: site.name,
		url: site.activeUrl,
		isStaging: false,
		isPressable: false,
		environmentType: null,
		syncSupport: pullAvailability.canPull ? 'syncable' : 'unsupported',
		syncDisabledReason: pullAvailability.disabledReason,
		capabilities: {
			pull: pullAvailability.canPull,
			push: false,
			backupCreate: site.capabilities.backupCreate,
			backupsRead: site.capabilities.backupsRead,
			importCreate: site.capabilities.importCreate,
			restoreCreate: site.capabilities.restoreCreate,
		},
		lastPullTimestamp: null,
		lastPushTimestamp: null,
	};
}

export async function testBridgeAccountConnection(
	input: TestRemoteProviderAccountInput
): Promise< BridgeAccountConnectionResult > {
	const normalized = normalizeBridgeAccountInput( input );
	const health = await requestJson(
		normalized,
		{ path: '/healthz', method: 'GET', token: 'read' },
		bridgeHealthResponseSchema
	);
	assertBridgeSupportsProvider( input.provider, health );
	await requestJson(
		normalized,
		{ path: '/v1/sites', method: 'GET', token: 'read' },
		bridgeSitesResponseSchema
	);
	return { normalized, health };
}

export async function listBridgeSites(
	account: RemoteProviderAccount
): Promise< { sites: SyncSite[]; health: BridgeHealthResponse } > {
	const health = await requestJson(
		account,
		{ path: '/healthz', method: 'GET', token: 'read' },
		bridgeHealthResponseSchema
	);
	assertBridgeSupportsProvider( account.provider, health );
	const response = await requestJson(
		account,
		{ path: '/v1/sites', method: 'GET', token: 'read' },
		bridgeSitesResponseSchema
	);
	return {
		health,
		sites: response.sites
			.filter( ( site ) => bridgeSiteBelongsToAccount( account, site ) )
			.map( ( site ) => toSyncSite( account, site, health ) ),
	};
}

export async function createBridgeBackupJob(
	account: RemoteProviderAccount,
	siteId: string,
	signal?: AbortSignal
) {
	const response = await requestJson(
		account,
		{
			path: `/v1/sites/${ siteId }/backup`,
			method: 'POST',
			token: 'mutate',
			body: {},
			signal,
		},
		bridgeJobResponseSchema
	);
	assertJobMatchesSite( response.job, siteId );
	return response.job;
}

export async function listBridgeBackups( account: RemoteProviderAccount, siteId: string ) {
	const response = await requestJson(
		account,
		{ path: `/v1/sites/${ siteId }/backups`, method: 'GET', token: 'read' },
		bridgeBackupsResponseSchema
	);
	assertBackupsMatchSite( response.backups, siteId );
	return response.backups;
}

export async function createBridgeExportJob(
	account: RemoteProviderAccount,
	siteId: string,
	backupId: string
) {
	const response = await requestJson(
		account,
		{
			path: `/v1/sites/${ siteId }/backups/${ backupId }/export`,
			method: 'POST',
			token: 'mutate',
			body: {},
		},
		bridgeJobResponseSchema
	);
	assertJobMatchesSite( response.job, siteId );
	return response.job;
}

export async function getBridgeJob(
	account: RemoteProviderAccount,
	jobId: string,
	expectedSiteId: string
) {
	const response = await requestJson(
		account,
		{ path: `/v1/jobs/${ jobId }`, method: 'GET', token: 'read' },
		bridgeJobResponseSchema
	);
	assertJobMatchesSite( response.job, expectedSiteId );
	return response.job;
}

export async function downloadBridgeJobArtifact(
	account: RemoteProviderAccount,
	jobId: string,
	operationId: string,
	signal?: AbortSignal
) {
	const tempDir = nodePath.join( app.getPath( 'temp' ), 'wp-studio-backups' );
	fs.mkdirSync( tempDir, { recursive: true } );
	const filePath = getSyncBackupTempPath( operationId );

	try {
		const response = await fetch( `${ account.bridgeUrl }/v1/jobs/${ jobId }/download`, {
			headers: {
				Authorization: `Bearer ${ account.readToken }`,
				Accept: 'application/octet-stream',
			},
			signal,
		} );

		if ( ! response.ok || ! response.body ) {
			const parsed = await parseResponse( response );
			const message =
				typeof parsed === 'object' &&
				parsed &&
				'message' in parsed &&
				typeof parsed.message === 'string'
					? parsed.message
					: `Bridge download failed with status ${ response.status }.`;
			throw new Error( message );
		}

		const responseBody = response.body as unknown as Parameters< typeof Readable.fromWeb >[ 0 ];
		await pipeline( Readable.fromWeb( responseBody ), fs.createWriteStream( filePath ) );
		const sizeBytes = Number.parseInt( response.headers.get( 'content-length' ) ?? '', 10 );

		return {
			filePath,
			sizeBytes: Number.isNaN( sizeBytes ) ? undefined : sizeBytes,
		};
	} catch ( error ) {
		fs.rmSync( filePath, { force: true } );
		throw error;
	}
}

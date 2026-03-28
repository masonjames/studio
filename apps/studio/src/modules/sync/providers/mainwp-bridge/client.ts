import fs from 'fs';
import nodePath from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { app } from 'electron';
import { getSyncBackupTempPath } from 'src/lib/get-sync-backup-temp-path';
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
	type BridgeJob,
	type BridgeHealthResponse,
	type PublicBridgeSite,
} from './schemas';

type MainwpBridgeAccount = Extract< RemoteProviderAccount, { provider: 'mainwpBridge' } >;

function isAllowedInsecureHost( host: string ) {
	return host === 'localhost' || host === '127.0.0.1';
}

export function normalizeBridgeUrl( value: string ): string {
	const parsed = new URL( value.trim() );
	if ( parsed.protocol !== 'https:' && !( parsed.protocol === 'http:' && isAllowedInsecureHost( parsed.hostname ) ) ) {
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

async function requestJson<T>(
	account: { bridgeUrl: string; readToken: string; mutateToken: string },
	options: {
		path: string;
		method?: 'GET' | 'POST';
		token?: 'read' | 'mutate';
		body?: unknown;
		signal?: AbortSignal;
	},
	schema: { parse: ( value: unknown ) => T }
): Promise<T> {
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
			typeof parsed === 'object' && parsed && 'message' in parsed && typeof parsed.message === 'string'
				? parsed.message
				: `Bridge request failed with status ${ response.status }.`;
		const error = new Error( message );
		( error as Error & { code?: string; status?: number } ).status = response.status;
		if ( typeof parsed === 'object' && parsed && 'error' in parsed && typeof parsed.error === 'string' ) {
			( error as Error & { code?: string } ).code = parsed.error;
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

function toSyncSite( account: MainwpBridgeAccount, site: PublicBridgeSite ): SyncSite {
	const canPull = Boolean(
		site.capabilities.pull && site.capabilities.backupCreate !== false && site.capabilities.backupsRead !== false
	);

	return {
		id: buildRemoteSiteKey( 'mainwpBridge', site.id ),
		remoteSiteId: site.id,
		provider: 'mainwpBridge',
		providerLabel: 'MainWP / Bridge',
		providerAccountId: account.id,
		localSiteId: '',
		name: site.name,
		url: site.activeUrl,
		isStaging: false,
		isPressable: false,
		environmentType: null,
		syncSupport: canPull ? 'syncable' : 'unsupported',
		capabilities: {
			pull: canPull,
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
): Promise<{ normalized: ReturnType<typeof normalizeBridgeAccountInput>; health: BridgeHealthResponse }> {
	const normalized = normalizeBridgeAccountInput( input );
	const health = await requestJson(
		normalized,
		{ path: '/healthz', method: 'GET', token: 'read' },
		bridgeHealthResponseSchema
	);
	await requestJson( normalized, { path: '/v1/sites', method: 'GET', token: 'read' }, bridgeSitesResponseSchema );
	return { normalized, health };
}

export async function listBridgeSites(
	account: MainwpBridgeAccount
): Promise<{ sites: SyncSite[]; health: BridgeHealthResponse }> {
	const health = await requestJson(
		account,
		{ path: '/healthz', method: 'GET', token: 'read' },
		bridgeHealthResponseSchema
	);
	const response = await requestJson(
		account,
		{ path: '/v1/sites', method: 'GET', token: 'read' },
		bridgeSitesResponseSchema
	);
	return {
		health,
		sites: response.sites.map( ( site ) => toSyncSite( account, site ) ),
	};
}

export async function createBridgeBackupJob( account: MainwpBridgeAccount, siteId: string ) {
	const response = await requestJson(
		account,
		{ path: `/v1/sites/${ siteId }/backup`, method: 'POST', token: 'mutate', body: {} },
		bridgeJobResponseSchema
	);
	assertJobMatchesSite( response.job, siteId );
	return response.job;
}

export async function listBridgeBackups( account: MainwpBridgeAccount, siteId: string ) {
	const response = await requestJson(
		account,
		{ path: `/v1/sites/${ siteId }/backups`, method: 'GET', token: 'read' },
		bridgeBackupsResponseSchema
	);
	assertBackupsMatchSite( response.backups, siteId );
	return response.backups;
}

export async function createBridgeExportJob(
	account: MainwpBridgeAccount,
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

export async function getBridgeJob( account: MainwpBridgeAccount, jobId: string, expectedSiteId: string ) {
	const response = await requestJson(
		account,
		{ path: `/v1/jobs/${ jobId }`, method: 'GET', token: 'read' },
		bridgeJobResponseSchema
	);
	assertJobMatchesSite( response.job, expectedSiteId );
	return response.job;
}

export async function downloadBridgeJobArtifact(
	account: MainwpBridgeAccount,
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
				typeof parsed === 'object' && parsed && 'message' in parsed && typeof parsed.message === 'string'
					? parsed.message
					: `Bridge download failed with status ${ response.status }.`;
			throw new Error( message );
		}

		await pipeline( Readable.fromWeb( response.body as any ), fs.createWriteStream( filePath ) );
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

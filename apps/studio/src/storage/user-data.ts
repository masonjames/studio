import fs from 'fs';
import nodePath from 'node:path';
import * as Sentry from '@sentry/electron/main';
import { LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from '@studio/common/constants';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import { getAppConfigLockFilePath } from '@studio/common/lib/well-known-paths';
import { readFile, writeFile } from 'atomically';
import { sanitizeUnstructuredData, sanitizeUserpath } from 'src/lib/sanitize-for-logging';
import { buildRemoteSiteKey, type SyncSite } from 'src/modules/sync/types';
import { getUserDataFilePath } from 'src/storage/paths';
import { EMPTY_USER_DATA, type UserData, type WindowBounds } from 'src/storage/storage-types';

function getDefaultCapabilities(): SyncSite[ 'capabilities' ] {
	return {
		pull: true,
		push: true,
		backupCreate: true,
		backupsRead: true,
		importCreate: true,
		restoreCreate: true,
	};
}

type LegacyWpcomSite = Partial< SyncSite > & {
	id?: string | number;
	legacyNumericId?: string | number;
	remoteSiteId?: string | number;
	providerLabel?: string;
	wpcomUserId?: number;
	localSiteId?: string;
	name?: string;
	url?: string;
	isStaging?: boolean;
	isPressable?: boolean;
	environmentType?: string | null;
	syncSupport?: SyncSite[ 'syncSupport' ];
	capabilities?: SyncSite[ 'capabilities' ];
	lastPullTimestamp?: string | null;
	lastPushTimestamp?: string | null;
};

type LegacyUserData = Partial< UserData > & {
	connectedWpcomSites?: Record< string, LegacyWpcomSite[] >;
};

function normalizeLegacyWpcomSite( site: LegacyWpcomSite | undefined, userId: number ): SyncSite {
	const remoteSiteId = String( site?.legacyNumericId ?? site?.remoteSiteId ?? site?.id ?? '' );
	const syncSupport = site?.syncSupport ?? 'already-connected';

	return {
		id: buildRemoteSiteKey( 'wpcom', remoteSiteId ),
		remoteSiteId,
		provider: 'wpcom',
		providerLabel: site?.providerLabel ?? 'WordPress.com',
		legacyNumericId:
			typeof site?.legacyNumericId === 'number'
				? site.legacyNumericId
				: Number.parseInt( remoteSiteId, 10 ),
		wpcomUserId: site?.wpcomUserId ?? userId,
		localSiteId: site?.localSiteId ?? '',
		name: site?.name ?? '',
		url: site?.url ?? '',
		isStaging: Boolean( site?.isStaging ),
		isPressable: Boolean( site?.isPressable ),
		environmentType: site?.environmentType ?? null,
		syncSupport,
		capabilities: site?.capabilities ?? getDefaultCapabilities(),
		lastPullTimestamp: site?.lastPullTimestamp ?? null,
		lastPushTimestamp: site?.lastPushTimestamp ?? null,
	};
}

function normalizeUserData( parsed: unknown ): UserData {
	const {
		siteMetadata,
		connectedRemoteSites,
		connectedWpcomSites,
		remoteProviderAccounts,
		providerPullOperations,
		...data
	} = ( parsed ?? {} ) as LegacyUserData;

	const canonicalConnectedSites = Array.isArray( connectedRemoteSites )
		? connectedRemoteSites
		: Object.entries( connectedWpcomSites ?? {} ).flatMap( ( [ rawUserId, sites ] ) => {
				const userId = Number.parseInt( rawUserId, 10 );
				if ( ! Array.isArray( sites ) ) {
					return [];
				}
				return sites.map( ( site ) => normalizeLegacyWpcomSite( site, userId ) );
		  } );

	return {
		...EMPTY_USER_DATA,
		...data,
		version: 2,
		siteMetadata: siteMetadata ?? {},
		connectedRemoteSites: canonicalConnectedSites,
		connectedWpcomSites,
		remoteProviderAccounts: Array.isArray( remoteProviderAccounts ) ? remoteProviderAccounts : [],
		providerPullOperations:
			typeof providerPullOperations === 'object' && providerPullOperations
				? providerPullOperations
				: {},
	};
}

export async function loadUserData(): Promise< UserData > {
	const filePath = getUserDataFilePath();

	try {
		const asString = await readFile( filePath, 'utf-8' );
		try {
			const parsed = JSON.parse( asString );
			return normalizeUserData( parsed );
		} catch ( err ) {
			if ( err instanceof SyntaxError ) {
				Sentry.addBreadcrumb( {
					data: {
						fileContents: sanitizeUnstructuredData( asString ),
						filePath: sanitizeUserpath( filePath ),
					},
				} );
			}
			throw err;
		}
	} catch ( err ) {
		if ( isErrnoException( err ) && err.code === 'ENOENT' ) {
			return EMPTY_USER_DATA;
		}
		console.error( `Failed to load file ${ sanitizeUserpath( filePath ) }: ${ err }` );
		throw err;
	}
}

export async function saveUserData( data: UserData ): Promise< void > {
	const filePath = getUserDataFilePath();
	const persisted: UserData = { ...data };
	const asString = JSON.stringify( persisted, null, 2 ) + '\n';
	await writeFile( filePath, asString, 'utf-8' );
}

const LOCKFILE_PATH = getAppConfigLockFilePath();

export async function lockAppdata() {
	const dir = nodePath.dirname( LOCKFILE_PATH );
	if ( ! fs.existsSync( dir ) ) {
		fs.mkdirSync( dir, { recursive: true } );
	}
	return lockFileAsync( LOCKFILE_PATH, { stale: LOCKFILE_STALE_TIME, wait: LOCKFILE_WAIT_TIME } );
}

export async function unlockAppdata() {
	return unlockFileAsync( LOCKFILE_PATH );
}

type UserDataSafeKeys =
	| 'devToolsOpen'
	| 'windowBounds'
	| 'onboardingCompleted'
	| 'promptWindowsSpeedUpResult'
	| 'stopSitesOnQuit'
	| 'sentryUserId'
	| 'lastSeenVersion'
	| 'preferredTerminal'
	| 'preferredEditor'
	| 'betaFeatures'
	| 'colorScheme'
	| 'sitesDirectoryPath'
	| 'useSiteNameAsFolder';

type PartialUserDataWithSafeKeysToUpdate = Partial< Pick< UserData, UserDataSafeKeys > >;

// Sometimes, we need to update the config file with a known value (i.e., not one that's derived
// from the current user config). This function should be used in those cases.
export async function updateAppdata(
	update: PartialUserDataWithSafeKeysToUpdate
): Promise< void > {
	try {
		await lockAppdata();
		const userData = await loadUserData();
		const updated = { ...userData, ...update };
		await saveUserData( updated );
	} finally {
		await unlockAppdata();
	}
}

export async function saveWindowBounds( bounds: WindowBounds ): Promise< void > {
	await updateAppdata( { windowBounds: bounds } );
}

export async function loadWindowBounds(): Promise< WindowBounds | undefined > {
	const userData = await loadUserData();
	return userData.windowBounds;
}

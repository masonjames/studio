export type RawDirectoryEntry = {
	name: string;
	isDirectory: boolean;
	path: string;
	children?: RawDirectoryEntry[];
};

export type SyncModalMode = 'push' | 'pull' | 'connect';

export type SyncSupport =
	| 'unsupported'
	| 'syncable'
	| 'needs-transfer'
	| 'already-connected'
	| 'needs-upgrade'
	| 'deleted'
	| 'missing-permissions';

export type RemoteProvider = 'wpcom' | 'mainwpBridge' | 'hetzner' | 'digitalocean';

export type RemoteSiteCapabilities = {
	pull: boolean;
	push: boolean;
	backupCreate?: boolean;
	backupsRead?: boolean;
	importCreate?: boolean;
	restoreCreate?: boolean;
};

export type SyncSite = {
	id: string;
	remoteSiteId: string;
	provider: RemoteProvider;
	providerLabel: string;
	providerAccountId?: string;
	legacyNumericId?: number;
	wpcomUserId?: number;
	localSiteId: string;
	name: string;
	url: string;
	isStaging: boolean;
	isPressable: boolean;
	environmentType?: string | null;
	syncSupport: SyncSupport;
	capabilities: RemoteSiteCapabilities;
	lastPullTimestamp: string | null;
	lastPushTimestamp: string | null;
};

export type RemoteProviderAccount = {
	id: string;
	provider: 'mainwpBridge';
	label: string;
	bridgeUrl: string;
	tokenMode: 'single' | 'split';
	readToken: string;
	mutateToken: string;
	createdAt: string;
	updatedAt: string;
};

export type TestRemoteProviderAccountInput = {
	provider: 'mainwpBridge';
	bridgeUrl: string;
	readToken: string;
	mutateToken?: string;
	tokenMode?: 'single' | 'split';
};

export type TestRemoteProviderAccountResult = {
	ok: boolean;
	message?: string;
	routeSupport?: {
		backupInventory: boolean;
		backupDetail: boolean;
		export: boolean;
		restore: boolean;
	};
};

export type UpsertRemoteProviderAccountInput = {
	id?: string;
	provider: 'mainwpBridge';
	label: string;
	bridgeUrl: string;
	readToken: string;
	mutateToken?: string;
	tokenMode?: 'single' | 'split';
};

export type RemoteProviderSiteListResult = {
	account: RemoteProviderAccount;
	sites: SyncSite[];
	routeSupport?: TestRemoteProviderAccountResult['routeSupport'];
};

export type MainwpBridgePullOperation = {
	provider: 'mainwpBridge';
	providerAccountId: string;
	remoteSiteId: string;
	stage: 'backup' | 'backupManifestLookup' | 'export';
	backupJobId: string;
	backupId?: string;
	exportJobId?: string;
	manifestLookupAttempts?: number;
};

export type RemotePullOperation = MainwpBridgePullOperation;

export type RemotePullUpdate =
	| {
			kind: 'running';
			operation: RemotePullOperation;
			progress: number;
			message: string;
		}
	| {
			kind: 'artifact-ready';
			operation: RemotePullOperation;
			progress: number;
			message: string;
			artifactSizeBytes?: number;
		}
	| {
			kind: 'failed';
			operation: RemotePullOperation;
			message: string;
			errorCode?: string;
			retryable?: boolean;
		};

export const buildRemoteSiteKey = ( provider: RemoteProvider, remoteSiteId: string ): string =>
	`${ provider }:${ remoteSiteId }`;

export const isWpcomSyncSite = ( site: Pick< SyncSite, 'provider' > | undefined | null ): boolean =>
	Boolean( site && site.provider === 'wpcom' );

export const isExternalHostingSyncSite = (
	site: Pick< SyncSite, 'provider' > | undefined | null
): boolean => Boolean( site && site.provider !== 'wpcom' );

export const getWpcomNumericSiteId = (
	site: Pick< SyncSite, 'provider' | 'legacyNumericId' | 'remoteSiteId' >
): number | undefined => {
	if ( site.provider !== 'wpcom' ) {
		return undefined;
	}

	if ( typeof site.legacyNumericId === 'number' ) {
		return site.legacyNumericId;
	}

	const parsed = Number.parseInt( site.remoteSiteId, 10 );
	return Number.isNaN( parsed ) ? undefined : parsed;
};

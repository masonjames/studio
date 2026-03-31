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

export type BridgeBackedRemoteProvider = 'mainwpBridge' | 'wpRemote' | 'flywheel' | 'wpEngine';

export type RemoteProvider = 'wpcom' | BridgeBackedRemoteProvider;

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
	provider: BridgeBackedRemoteProvider;
	label: string;
	bridgeUrl: string;
	tokenMode: 'single' | 'split';
	readToken: string;
	mutateToken: string;
	supportedProviders?: BridgeBackedRemoteProvider[];
	lastValidatedAt?: string;
	createdAt: string;
	updatedAt: string;
};

export type TestRemoteProviderAccountInput = {
	provider: BridgeBackedRemoteProvider;
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
	provider: BridgeBackedRemoteProvider;
	label: string;
	bridgeUrl: string;
	readToken: string;
	mutateToken?: string;
	tokenMode?: 'single' | 'split';
};

export type RemoteProviderSiteListResult = {
	account: RemoteProviderAccount;
	sites: SyncSite[];
	routeSupport?: TestRemoteProviderAccountResult[ 'routeSupport' ];
};

export type BridgePullOperation = {
	kind: 'bridge';
	provider: BridgeBackedRemoteProvider;
	providerAccountId: string;
	remoteSiteId: string;
	stage: 'backup' | 'backupManifestLookup' | 'export';
	backupJobId: string;
	backupId?: string;
	exportJobId?: string;
	manifestLookupAttempts?: number;
};

export type RemotePullOperation = BridgePullOperation;

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

export const isBridgeBackedRemoteProvider = (
	provider: RemoteProvider | undefined | null
): provider is BridgeBackedRemoteProvider => Boolean( provider && provider !== 'wpcom' );

export const isExternalHostingSyncSite = (
	site: Pick< SyncSite, 'provider' > | undefined | null
): boolean => Boolean( site && isBridgeBackedRemoteProvider( site.provider ) );

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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersistedProviderPullRecord } from 'src/modules/sync/types';
import { ProviderPullManager } from './provider-pull-manager';

vi.mock( 'electron', () => ( {
	BrowserWindow: {
		getAllWindows: () => [],
		getFocusedWindow: () => null,
	},
	dialog: {
		showMessageBox: vi.fn(),
	},
} ) );

vi.mock( '@sentry/electron/main', () => ( {
	captureException: vi.fn(),
} ) );

vi.mock( 'src/storage/user-data', () => ( {
	loadUserData: vi.fn( async () => ( {
		providerPullOperations: {},
		connectedRemoteSites: [],
		remoteProviderAccounts: [],
	} ) ),
	lockAppdata: vi.fn(),
	saveUserData: vi.fn(),
	unlockAppdata: vi.fn(),
} ) );

vi.mock( 'src/site-server', () => ( {
	SiteServer: {
		get: vi.fn(),
	},
} ) );

vi.mock( 'src/ipc-utils', () => ( {
	sendIpcEventToRendererWithWindow: vi.fn(),
} ) );

vi.mock( 'src/lib/active-sync-operations', () => ( {
	ACTIVE_SYNC_OPERATIONS: new Map(),
} ) );

vi.mock( './provider-clients', () => ( {
	getRemoteProviderClient: vi.fn(),
} ) );

vi.mock( './local-site-operations', () => ( {
	importSiteBackupInternal: vi.fn(),
	startSiteServerInternal: vi.fn(),
	stopSiteServerInternal: vi.fn(),
} ) );

function buildRecord( overrides: Partial< PersistedProviderPullRecord > = {} ): PersistedProviderPullRecord {
	return {
		id: 'local-site-1-remote-site-1',
		localSiteId: 'local-site-1',
		connectedSiteId: 'remote-site-1',
		remoteSiteId: 'provider-site-1',
		provider: 'wpRemote',
		providerAccountId: 'account-1',
		remoteSiteName: 'Remote Site',
		remoteSiteUrl: 'https://example.com',
		localSiteName: 'Local Site',
		pullOptions: { optionsToSync: [ 'all' ] },
		phase: 'pollingRemotePull',
		progress: {
			key: 'in-progress',
			progress: 30,
			message: 'Initializing remote backup…',
		},
		sequence: 0,
		createdAt: '2026-04-02T00:00:00.000Z',
		updatedAt: '2026-04-02T00:00:00.000Z',
		...overrides,
	};
}

describe( 'ProviderPullManager.cancelPull', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'refuses cancellation once local import has started', async () => {
		const manager = new ProviderPullManager();
		( manager as any ).records.set(
			'local-site-1-remote-site-1',
			buildRecord( {
				phase: 'importingBackup',
				progress: {
					key: 'importing',
					progress: 80,
					message: 'Importing backup…',
				},
			} )
		);

		await expect( manager.cancelPull( 'local-site-1-remote-site-1' ) ).resolves.toEqual( {
			accepted: false,
			message: 'This pull is already importing into the local site and can no longer be cancelled.',
		} );
	} );
} );

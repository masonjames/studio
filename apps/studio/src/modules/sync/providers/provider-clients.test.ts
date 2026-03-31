import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBridgeBackupJob, getBridgeJob } from './bridge/client';
import { getRemoteProviderClient } from './provider-clients';
import type { RemoteProviderAccount, RemotePullOperation } from 'src/modules/sync/types';

vi.mock( './bridge/client', () => ( {
	createBridgeBackupJob: vi.fn(),
	createBridgeExportJob: vi.fn(),
	downloadBridgeJobArtifact: vi.fn(),
	getBridgeJob: vi.fn(),
	listBridgeBackups: vi.fn(),
	listBridgeSites: vi.fn(),
	testBridgeAccountConnection: vi.fn(),
} ) );

const mainwpAccount: RemoteProviderAccount = {
	id: 'account-1',
	provider: 'mainwpBridge',
	label: 'Primary bridge',
	bridgeUrl: 'https://bridge.example.com',
	tokenMode: 'single',
	readToken: 'read-token',
	mutateToken: 'read-token',
	createdAt: '2026-03-31T00:00:00.000Z',
	updatedAt: '2026-03-31T00:00:00.000Z',
};

describe( 'getRemoteProviderClient', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'returns the shared bridge client for MainWP', () => {
		const client = getRemoteProviderClient( 'mainwpBridge' );

		expect( client ).toMatchObject( {
			testAccount: expect.any( Function ),
			listSites: expect.any( Function ),
			startPull: expect.any( Function ),
			pollPull: expect.any( Function ),
			downloadPullArtifact: expect.any( Function ),
		} );
	} );

	it( 'creates a bridge pull operation for MainWP', async () => {
		vi.mocked( createBridgeBackupJob ).mockResolvedValue( {
			id: 'job-1',
		} as Awaited< ReturnType< typeof createBridgeBackupJob > > );

		const operation = await getRemoteProviderClient( 'mainwpBridge' ).startPull(
			mainwpAccount,
			'site-1'
		);

		expect( operation ).toEqual( {
			kind: 'bridge',
			provider: 'mainwpBridge',
			providerAccountId: 'account-1',
			remoteSiteId: 'site-1',
			stage: 'backup',
			backupJobId: 'job-1',
		} );
	} );

	it( 'keeps a running backup operation in progress while the bridge job is still running', async () => {
		vi.mocked( getBridgeJob ).mockResolvedValue( {
			id: 'job-1',
			siteId: 'site-1',
			status: 'running',
			progress: {
				percent: 50,
				message: 'Preparing remote backup…',
			},
		} as Awaited< ReturnType< typeof getBridgeJob > > );

		const operation: RemotePullOperation = {
			kind: 'bridge',
			provider: 'mainwpBridge',
			providerAccountId: 'account-1',
			remoteSiteId: 'site-1',
			stage: 'backup',
			backupJobId: 'job-1',
		};

		await expect(
			getRemoteProviderClient( 'mainwpBridge' ).pollPull( mainwpAccount, operation )
		).resolves.toMatchObject( {
			kind: 'running',
			operation,
			message: 'Preparing remote backup…',
		} );
	} );

	it( 'rejects poll operations that do not match the selected provider account', async () => {
		const mismatchedOperation: RemotePullOperation = {
			kind: 'bridge',
			provider: 'mainwpBridge',
			providerAccountId: 'different-account',
			remoteSiteId: 'site-1',
			stage: 'backup',
			backupJobId: 'job-1',
		};

		await expect(
			getRemoteProviderClient( 'mainwpBridge' ).pollPull( mainwpAccount, mismatchedOperation )
		).rejects.toThrow( 'Remote pull operation does not match the selected provider account.' );
	} );

	it( 'throws for unsupported providers until their adapters exist', () => {
		expect( () => getRemoteProviderClient( 'wpRemote' ) ).toThrow(
			'This remote provider is not supported yet.'
		);
	} );
} );

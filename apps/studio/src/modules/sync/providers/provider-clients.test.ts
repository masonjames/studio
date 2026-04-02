import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBridgeBackupJob, downloadBridgeJobArtifact, getBridgeJob } from './bridge/client';
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

const wpRemoteAccount: RemoteProviderAccount = {
	...mainwpAccount,
	id: 'account-2',
	provider: 'wpRemote',
	label: 'WP Remote bridge',
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

	it( 'returns the shared bridge client for WP Remote', () => {
		const client = getRemoteProviderClient( 'wpRemote' );

		expect( client ).toMatchObject( {
			testAccount: expect.any( Function ),
			listSites: expect.any( Function ),
			startPull: expect.any( Function ),
			pollPull: expect.any( Function ),
			downloadPullArtifact: expect.any( Function ),
		} );
	} );

	it( 'creates a bridge pull operation for WP Remote', async () => {
		vi.mocked( createBridgeBackupJob ).mockResolvedValue( {
			id: 'job-2',
		} as Awaited< ReturnType< typeof createBridgeBackupJob > > );

		const operation = await getRemoteProviderClient( 'wpRemote' ).startPull(
			wpRemoteAccount,
			'site-2'
		);

		expect( operation ).toEqual( {
			kind: 'bridge',
			provider: 'wpRemote',
			providerAccountId: 'account-2',
			remoteSiteId: 'site-2',
			stage: 'backup',
			backupJobId: 'job-2',
		} );
	} );

	it( 'reconciles a locked bridge backup job when startPull resumes after interruption', async () => {
		const lockedError = Object.assign( new Error( 'A backup is already running for this site.' ), {
			code: 'site_job_locked',
			activeJobId: 'job-locked',
			activeJobType: 'backup',
		} );
		vi.mocked( createBridgeBackupJob ).mockRejectedValue( lockedError );

		await expect(
			getRemoteProviderClient( 'wpRemote' ).startPull( wpRemoteAccount, 'site-2' )
		).resolves.toEqual( {
			kind: 'bridge',
			provider: 'wpRemote',
			providerAccountId: 'account-2',
			remoteSiteId: 'site-2',
			stage: 'backup',
			backupJobId: 'job-locked',
		} );
	} );

	it( 'polls WP Remote pull operations through the shared bridge client', async () => {
		vi.mocked( getBridgeJob ).mockResolvedValue( {
			id: 'job-2',
			siteId: 'site-2',
			status: 'running',
			progress: {
				percent: 40,
				message: 'Preparing remote backup…',
			},
		} as Awaited< ReturnType< typeof getBridgeJob > > );

		const operation: RemotePullOperation = {
			kind: 'bridge',
			provider: 'wpRemote',
			providerAccountId: 'account-2',
			remoteSiteId: 'site-2',
			stage: 'backup',
			backupJobId: 'job-2',
		};

		await expect(
			getRemoteProviderClient( 'wpRemote' ).pollPull( wpRemoteAccount, operation )
		).resolves.toMatchObject( {
			kind: 'running',
			operation,
			message: 'Preparing remote backup…',
		} );
	} );

	it( 'downloads WP Remote artifacts through the shared bridge client', async () => {
		vi.mocked( downloadBridgeJobArtifact ).mockResolvedValue( {
			filePath: '/tmp/wpremote-export.tgz',
			sizeBytes: 123,
		} );

		await expect(
			getRemoteProviderClient( 'wpRemote' ).downloadPullArtifact(
				wpRemoteAccount,
				'job-2',
				'operation-2'
			)
		).resolves.toEqual( {
			filePath: '/tmp/wpremote-export.tgz',
			sizeBytes: 123,
		} );
		expect( downloadBridgeJobArtifact ).toHaveBeenCalledWith(
			wpRemoteAccount,
			'job-2',
			'operation-2',
			undefined
		);
	} );
} );

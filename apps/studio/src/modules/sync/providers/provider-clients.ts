import {
	createBridgeBackupJob,
	createBridgeExportJob,
	downloadBridgeJobArtifact,
	getBridgeJob,
	listBridgeBackups,
	listBridgeSites,
	testBridgeAccountConnection,
	type BridgeAccountConnectionResult,
} from './bridge/client';
import { hasRemoteProviderClient, type SupportedRemoteProviderClient } from './supported-providers';
import type { BridgeHealthResponse } from './bridge/schemas';
import type {
	BridgeBackedRemoteProvider,
	BridgePullOperation,
	RemoteProviderAccount,
	RemotePullOperation,
	RemotePullUpdate,
	SyncSite,
	TestRemoteProviderAccountInput,
} from 'src/modules/sync/types';

export interface RemoteProviderClient {
	testAccount( input: TestRemoteProviderAccountInput ): Promise< BridgeAccountConnectionResult >;
	listSites(
		account: RemoteProviderAccount
	): Promise< { sites: SyncSite[]; health: BridgeHealthResponse } >;
	startPull( account: RemoteProviderAccount, remoteSiteId: string ): Promise< RemotePullOperation >;
	pollPull(
		account: RemoteProviderAccount,
		operation: RemotePullOperation
	): Promise< RemotePullUpdate >;
	downloadPullArtifact(
		account: RemoteProviderAccount,
		jobId: string,
		operationId: string
	): Promise< { filePath: string; sizeBytes?: number } >;
}

function getBridgeRunningProgress( stage: BridgePullOperation[ 'stage' ], percent?: number ) {
	if ( stage === 'backup' ) {
		return 30 + ( ( percent ?? 0 ) / 100 ) * 18;
	}
	if ( stage === 'backupManifestLookup' ) {
		return 50;
	}
	return 55 + ( ( percent ?? 0 ) / 100 ) * 5;
}

const mainwpBridgeClient: RemoteProviderClient = {
	testAccount: testBridgeAccountConnection,
	listSites: listBridgeSites,
	async startPull( account, remoteSiteId ) {
		const backupJob = await createBridgeBackupJob( account, remoteSiteId );

		return {
			kind: 'bridge',
			provider: account.provider,
			providerAccountId: account.id,
			remoteSiteId,
			stage: 'backup',
			backupJobId: backupJob.id,
		};
	},
	async pollPull( account, operation ) {
		if ( operation.kind !== 'bridge' ) {
			throw new Error( 'Unsupported remote pull operation.' );
		}

		if ( operation.provider !== account.provider || operation.providerAccountId !== account.id ) {
			throw new Error( 'Remote pull operation does not match the selected provider account.' );
		}

		if ( operation.stage === 'backup' || operation.stage === 'backupManifestLookup' ) {
			const backupJob = await getBridgeJob(
				account,
				operation.backupJobId,
				operation.remoteSiteId
			);
			if ( backupJob.status === 'failed' ) {
				return {
					kind: 'failed',
					operation,
					message: backupJob.error?.message ?? 'Remote backup failed.',
					errorCode: backupJob.error?.code,
				};
			}

			if ( backupJob.status !== 'completed' ) {
				return {
					kind: 'running',
					operation,
					progress: getBridgeRunningProgress( operation.stage, backupJob.progress?.percent ),
					message: backupJob.progress?.message ?? 'Preparing remote backup…',
				};
			}

			const backups = await listBridgeBackups( account, operation.remoteSiteId );
			const backupManifest = backups.find(
				( backup ) => backup.sourceJobId === operation.backupJobId
			);
			if ( ! backupManifest ) {
				const attempts = ( operation.manifestLookupAttempts ?? 0 ) + 1;
				if ( attempts >= 20 ) {
					return {
						kind: 'failed',
						operation,
						message: 'The remote backup finished but its manifest was not available yet.',
						retryable: true,
					};
				}
				return {
					kind: 'running',
					operation: {
						...operation,
						stage: 'backupManifestLookup',
						manifestLookupAttempts: attempts,
					},
					progress: 50,
					message: 'Finalizing backup metadata…',
				};
			}

			const exportJob = await createBridgeExportJob(
				account,
				operation.remoteSiteId,
				backupManifest.id
			);
			return {
				kind: 'running',
				operation: {
					...operation,
					stage: 'export',
					backupId: backupManifest.id,
					exportJobId: exportJob.id,
				},
				progress: 55,
				message: 'Preparing backup export…',
			};
		}

		if ( ! operation.exportJobId ) {
			return {
				kind: 'failed',
				operation,
				message: 'The remote export job is missing.',
			};
		}

		const exportJob = await getBridgeJob( account, operation.exportJobId, operation.remoteSiteId );
		if ( exportJob.status === 'failed' ) {
			return {
				kind: 'failed',
				operation,
				message: exportJob.error?.message ?? 'Remote export failed.',
				errorCode: exportJob.error?.code,
			};
		}

		if ( exportJob.status !== 'completed' ) {
			return {
				kind: 'running',
				operation,
				progress: getBridgeRunningProgress( 'export', exportJob.progress?.percent ),
				message: exportJob.progress?.message ?? 'Exporting backup…',
			};
		}

		if ( ! exportJob.artifactAvailable ) {
			return {
				kind: 'failed',
				operation,
				message: 'The remote export completed without a downloadable artifact.',
				retryable: true,
			};
		}

		return {
			kind: 'artifact-ready',
			operation,
			progress: 60,
			message: 'Backup export is ready to download.',
			artifactSizeBytes: exportJob.artifact?.sizeBytes,
		};
	},
	downloadPullArtifact: downloadBridgeJobArtifact,
};

const REMOTE_PROVIDER_CLIENTS: Record< SupportedRemoteProviderClient, RemoteProviderClient > = {
	mainwpBridge: mainwpBridgeClient,
};

export function getRemoteProviderClient(
	provider: BridgeBackedRemoteProvider
): RemoteProviderClient {
	if ( ! hasRemoteProviderClient( provider ) ) {
		throw new Error( 'This remote provider is not supported yet.' );
	}

	return REMOTE_PROVIDER_CLIENTS[ provider ];
}

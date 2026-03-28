import { randomUUID } from 'node:crypto';
import { type IpcMainInvokeEvent } from 'electron';
import {
	loadUserData,
	lockAppdata,
	saveUserData,
	unlockAppdata,
} from 'src/storage/user-data';
import {
	type MainwpBridgePullOperation,
	type RemoteProvider,
	type RemoteProviderAccount,
	type RemotePullOperation,
	type RemotePullUpdate,
	type RemoteProviderSiteListResult,
	type TestRemoteProviderAccountInput,
	type TestRemoteProviderAccountResult,
	type UpsertRemoteProviderAccountInput,
} from 'src/modules/sync/types';
import {
	createBridgeBackupJob,
	createBridgeExportJob,
	downloadBridgeJobArtifact,
	getBridgeJob,
	listBridgeBackups,
	listBridgeSites,
	testBridgeAccountConnection,
} from './mainwp-bridge/client';

function ensureProviderAccounts( userData: Awaited< ReturnType< typeof loadUserData > > ) {
	userData.remoteProviderAccounts = userData.remoteProviderAccounts || [];
	return userData.remoteProviderAccounts;
}

function requireMainwpBridgeAccount(
	accounts: RemoteProviderAccount[],
	accountId: string
): Extract< RemoteProviderAccount, { provider: 'mainwpBridge' } > {
	const account = accounts.find(
		candidate => candidate.id === accountId && candidate.provider === 'mainwpBridge'
	) as Extract< RemoteProviderAccount, { provider: 'mainwpBridge' } > | undefined;

	if ( ! account ) {
		throw new Error( 'Remote provider account not found.' );
	}

	return account;
}

export async function listRemoteProviderAccounts(
	_event: IpcMainInvokeEvent,
	provider?: RemoteProvider
): Promise< RemoteProviderAccount[] > {
	const userData = await loadUserData();
	const accounts = ensureProviderAccounts( userData );
	if ( ! provider ) {
		return accounts;
	}
	return accounts.filter( account => account.provider === provider );
}

export async function testRemoteProviderAccount(
	_event: IpcMainInvokeEvent,
	input: TestRemoteProviderAccountInput
): Promise< TestRemoteProviderAccountResult > {
	try {
		const { health } = await testBridgeAccountConnection( input );
		return {
			ok: true,
			routeSupport: {
				backupInventory: health.routeSupport?.backupInventory ?? false,
				backupDetail: health.routeSupport?.backupDetail ?? false,
				export: health.routeSupport?.export ?? false,
				restore: health.routeSupport?.restore ?? false,
			},
		};
	} catch ( error ) {
		return {
			ok: false,
			message: error instanceof Error ? error.message : 'Unable to validate provider account.',
		};
	}
}

export async function upsertRemoteProviderAccount(
	_event: IpcMainInvokeEvent,
	input: UpsertRemoteProviderAccountInput
): Promise< RemoteProviderAccount > {
	const { normalized } = await testBridgeAccountConnection( input );
	const now = new Date().toISOString();

	try {
		await lockAppdata();
		const userData = await loadUserData();
		const accounts = ensureProviderAccounts( userData );
		const nextAccount: RemoteProviderAccount = {
			id: input.id ?? randomUUID(),
			provider: 'mainwpBridge',
			label: input.label.trim(),
			bridgeUrl: normalized.bridgeUrl,
			readToken: normalized.readToken,
			mutateToken: normalized.mutateToken,
			tokenMode: normalized.tokenMode,
			createdAt: accounts.find( account => account.id === input.id )?.createdAt ?? now,
			updatedAt: now,
		};
		const existingIndex = accounts.findIndex( account => account.id === nextAccount.id );
		if ( existingIndex === -1 ) {
			accounts.push( nextAccount );
		} else {
			accounts[ existingIndex ] = nextAccount;
		}
		await saveUserData( userData );
		return nextAccount;
	} finally {
		await unlockAppdata();
	}
}

export async function deleteRemoteProviderAccount(
	_event: IpcMainInvokeEvent,
	accountId: string
): Promise< void > {
	try {
		await lockAppdata();
		const userData = await loadUserData();
		userData.remoteProviderAccounts = ensureProviderAccounts( userData ).filter(
			account => account.id !== accountId
		);
		await saveUserData( userData );
	} finally {
		await unlockAppdata();
	}
}

export async function listRemoteProviderSites(
	_event: IpcMainInvokeEvent,
	accountId: string
): Promise< RemoteProviderSiteListResult > {
	const userData = await loadUserData();
	const account = requireMainwpBridgeAccount( ensureProviderAccounts( userData ), accountId );
	const { sites, health } = await listBridgeSites( account );
	return {
		account,
		sites,
		routeSupport: {
			backupInventory: health.routeSupport?.backupInventory ?? false,
			backupDetail: health.routeSupport?.backupDetail ?? false,
			export: health.routeSupport?.export ?? false,
			restore: health.routeSupport?.restore ?? false,
		},
	};
}

export async function startRemotePull(
	_event: IpcMainInvokeEvent,
	accountId: string,
	remoteSiteId: string
): Promise< RemotePullOperation > {
	const userData = await loadUserData();
	const account = requireMainwpBridgeAccount( ensureProviderAccounts( userData ), accountId );
	const backupJob = await createBridgeBackupJob( account, remoteSiteId );

	return {
		provider: 'mainwpBridge',
		providerAccountId: account.id,
		remoteSiteId,
		stage: 'backup',
		backupJobId: backupJob.id,
	};
}

function getBridgeRunningProgress( stage: MainwpBridgePullOperation['stage'], percent?: number ) {
	if ( stage === 'backup' ) {
		return 30 + ( ( percent ?? 0 ) / 100 ) * 18;
	}
	if ( stage === 'backupManifestLookup' ) {
		return 50;
	}
	return 55 + ( ( percent ?? 0 ) / 100 ) * 5;
}

export async function pollRemotePull(
	_event: IpcMainInvokeEvent,
	accountId: string,
	operation: RemotePullOperation
): Promise< RemotePullUpdate > {
	const userData = await loadUserData();
	const account = requireMainwpBridgeAccount( ensureProviderAccounts( userData ), accountId );

	if ( operation.provider !== 'mainwpBridge' ) {
		throw new Error( 'Unsupported remote pull provider.' );
	}

	if ( operation.stage === 'backup' || operation.stage === 'backupManifestLookup' ) {
		const backupJob = await getBridgeJob( account, operation.backupJobId, operation.remoteSiteId );
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
		const backupManifest = backups.find( backup => backup.sourceJobId === operation.backupJobId );
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

		const exportJob = await createBridgeExportJob( account, operation.remoteSiteId, backupManifest.id );
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
}

export async function downloadRemotePullArtifact(
	_event: IpcMainInvokeEvent,
	accountId: string,
	jobId: string,
	operationId: string
): Promise<{ filePath: string; sizeBytes?: number }> {
	const userData = await loadUserData();
	const account = requireMainwpBridgeAccount( ensureProviderAccounts( userData ), accountId );
	return downloadBridgeJobArtifact( account, jobId, operationId );
}

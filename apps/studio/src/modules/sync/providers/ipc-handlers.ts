import { type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import {
	type RemoteProvider,
	type RemoteProviderAccount,
	type RemoteProviderSiteListResult,
	type RemotePullOperation,
	type RemotePullUpdate,
	type TestRemoteProviderAccountInput,
	type TestRemoteProviderAccountResult,
	type UpsertRemoteProviderAccountInput,
} from 'src/modules/sync/types';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import { getRemoteProviderClient } from './provider-clients';

function ensureProviderAccounts( userData: Awaited< ReturnType< typeof loadUserData > > ) {
	userData.remoteProviderAccounts = userData.remoteProviderAccounts || [];
	return userData.remoteProviderAccounts;
}

function requireRemoteProviderAccount(
	accounts: RemoteProviderAccount[],
	accountId: string
): RemoteProviderAccount {
	const account = accounts.find( ( candidate ) => candidate.id === accountId );

	if ( ! account ) {
		throw new Error( 'Remote provider account not found.' );
	}

	return account;
}

function normalizeRouteSupport( routeSupport?: {
	backupInventory?: boolean;
	backupDetail?: boolean;
	export?: boolean;
	restore?: boolean;
} ): NonNullable< TestRemoteProviderAccountResult[ 'routeSupport' ] > {
	return {
		backupInventory: routeSupport?.backupInventory ?? false,
		backupDetail: routeSupport?.backupDetail ?? false,
		export: routeSupport?.export ?? false,
		restore: routeSupport?.restore ?? false,
	};
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
	return accounts.filter( ( account ) => account.provider === provider );
}

export async function testRemoteProviderAccount(
	_event: IpcMainInvokeEvent,
	input: TestRemoteProviderAccountInput
): Promise< TestRemoteProviderAccountResult > {
	try {
		const client = getRemoteProviderClient( input.provider );
		const { health } = await client.testAccount( input );
		return {
			ok: true,
			routeSupport: normalizeRouteSupport( health.routeSupport ),
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
	const client = getRemoteProviderClient( input.provider );
	const { normalized } = await client.testAccount( input );
	const now = new Date().toISOString();

	try {
		await lockAppdata();
		const userData = await loadUserData();
		const accounts = ensureProviderAccounts( userData );
		const existingAccount = accounts.find( ( account ) => account.id === input.id );
		const nextAccount: RemoteProviderAccount = {
			id: input.id ?? randomUUID(),
			provider: input.provider,
			label: input.label.trim(),
			bridgeUrl: normalized.bridgeUrl,
			readToken: normalized.readToken,
			mutateToken: normalized.mutateToken,
			tokenMode: normalized.tokenMode,
			...( normalized.tokenMode === 'single' ? { lastValidatedAt: now } : {} ),
			...( existingAccount?.supportedProviders
				? { supportedProviders: existingAccount.supportedProviders }
				: {} ),
			createdAt: existingAccount?.createdAt ?? now,
			updatedAt: now,
		};
		const existingIndex = accounts.findIndex( ( account ) => account.id === nextAccount.id );
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
			( account ) => account.id !== accountId
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
	const account = requireRemoteProviderAccount( ensureProviderAccounts( userData ), accountId );
	const client = getRemoteProviderClient( account.provider );
	const { sites, health } = await client.listSites( account );
	return {
		account,
		sites,
		routeSupport: normalizeRouteSupport( health.routeSupport ),
	};
}

export async function startRemotePull(
	_event: IpcMainInvokeEvent,
	accountId: string,
	remoteSiteId: string
): Promise< RemotePullOperation > {
	const userData = await loadUserData();
	const account = requireRemoteProviderAccount( ensureProviderAccounts( userData ), accountId );
	const client = getRemoteProviderClient( account.provider );
	return client.startPull( account, remoteSiteId );
}

export async function pollRemotePull(
	_event: IpcMainInvokeEvent,
	accountId: string,
	operation: RemotePullOperation
): Promise< RemotePullUpdate > {
	const userData = await loadUserData();
	const account = requireRemoteProviderAccount( ensureProviderAccounts( userData ), accountId );
	const client = getRemoteProviderClient( account.provider );
	return client.pollPull( account, operation );
}

export async function downloadRemotePullArtifact(
	_event: IpcMainInvokeEvent,
	accountId: string,
	jobId: string,
	operationId: string
): Promise< { filePath: string; sizeBytes?: number } > {
	const userData = await loadUserData();
	const account = requireRemoteProviderAccount( ensureProviderAccounts( userData ), accountId );
	const client = getRemoteProviderClient( account.provider );
	return client.downloadPullArtifact( account, jobId, operationId );
}

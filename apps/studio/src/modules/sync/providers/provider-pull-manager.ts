import fs from 'fs';
import fsPromises from 'fs/promises';
import { BrowserWindow, dialog } from 'electron';
import * as Sentry from '@sentry/electron/main';
import { __, sprintf } from '@wordpress/i18n';
import { SYNC_PUSH_SIZE_LIMIT_BYTES, SYNC_PUSH_SIZE_LIMIT_GB } from 'src/constants';
import { ACTIVE_SYNC_OPERATIONS } from 'src/lib/active-sync-operations';
import { sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import { SiteServer } from 'src/site-server';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import type { PullStateProgressInfo } from 'src/hooks/use-sync-states-progress-info';
import type {
	CancelSyncOperationResult,
	PersistedProviderPullRecord,
	ProviderPullLifecycleSnapshot,
	PullSiteOptions,
	RemoteProviderAccount,
	RemotePullOperation,
	RemotePullUpdate,
	SyncSite,
} from 'src/modules/sync/types';
import { isBridgeBackedRemoteProvider } from 'src/modules/sync/types';
import { getRemoteProviderClient } from './provider-clients';
import {
	importSiteBackupInternal,
	startSiteServerInternal,
	stopSiteServerInternal,
} from './local-site-operations';

const PROVIDER_PULL_POLLING_INTERVAL = 3_000;

function getProviderPullOperationId( localSiteId: string, connectedSiteId: string ) {
	return `${ localSiteId }-${ connectedSiteId }`;
}

function getRendererWindow() {
	const windows = BrowserWindow.getAllWindows();
	return BrowserWindow.getFocusedWindow() || windows[ 0 ] || null;
}

function getInitialPullProgress(): PullStateProgressInfo {
	return {
		key: 'in-progress',
		progress: 30,
		message: __( 'Initializing remote backup…' ),
	};
}

type ProviderPullRuntime = {
	abortController: AbortController;
	task: Promise< void >;
};

export class ProviderPullManager {
	private records = new Map< string, PersistedProviderPullRecord >();
	private runtimes = new Map< string, ProviderPullRuntime >();
	private cancelledOperations = new Set< string >();
	private isInitialized = false;
	private isShuttingDown = false;

	async initialize(): Promise< void > {
		if ( this.isInitialized ) {
			return;
		}

		this.isInitialized = true;
		this.isShuttingDown = false;
		const userData = await loadUserData();
		const persistedRecords = Object.values( userData.providerPullOperations ?? {} );
		persistedRecords.forEach( ( record ) => {
			this.records.set( record.id, record );
			ACTIVE_SYNC_OPERATIONS.set( record.id, record.progress );
			this.ensureRuntime( record.id );
		} );
	}

	async shutdown(): Promise< void > {
		this.isShuttingDown = true;
		for ( const runtime of this.runtimes.values() ) {
			runtime.abortController.abort();
		}
	}

	hasActivePull( operationId: string ): boolean {
		return this.records.has( operationId );
	}

	async startPull( input: {
		connectedSite: SyncSite;
		selectedSite: SiteDetails;
		pullOptions: PullSiteOptions;
	} ): Promise< ProviderPullLifecycleSnapshot > {
		await this.initialize();

		const { connectedSite, selectedSite, pullOptions } = input;
		if ( ! connectedSite.providerAccountId ) {
			throw new Error( 'A provider account is required to start this pull.' );
		}

		const operationId = getProviderPullOperationId( selectedSite.id, connectedSite.id );
		const existingRecord = this.records.get( operationId );
		if ( existingRecord ) {
			this.ensureRuntime( operationId );
			return this.toSnapshot( existingRecord, selectedSite );
		}

		if ( ! isBridgeBackedRemoteProvider( connectedSite.provider ) ) {
			throw new Error( 'Provider pull manager can only orchestrate bridge-backed providers.' );
		}

		const now = new Date().toISOString();
		const record: PersistedProviderPullRecord = {
			id: operationId,
			localSiteId: selectedSite.id,
			connectedSiteId: connectedSite.id,
			remoteSiteId: connectedSite.remoteSiteId,
			provider: connectedSite.provider,
			providerAccountId: connectedSite.providerAccountId,
			remoteSiteName: connectedSite.name,
			remoteSiteUrl: connectedSite.url,
			localSiteName: selectedSite.name,
			pullOptions,
			phase: 'startingRemotePull',
			progress: getInitialPullProgress(),
			sequence: 0,
			createdAt: now,
			updatedAt: now,
		};

		await this.persistRecord( record );
		ACTIVE_SYNC_OPERATIONS.set( operationId, record.progress );
		this.emitSnapshot( this.toSnapshot( record, selectedSite ) );
		this.ensureRuntime( operationId );
		return this.toSnapshot( record, selectedSite );
	}

	async listActivePulls(): Promise< ProviderPullLifecycleSnapshot[] > {
		await this.initialize();
		return Array.from( this.records.values() )
			.map( ( record ) => {
				const selectedSite = SiteServer.get( record.localSiteId )?.details;
				if ( ! selectedSite ) {
					return undefined;
				}
				return this.toSnapshot( record, selectedSite );
			} )
			.filter( Boolean ) as ProviderPullLifecycleSnapshot[];
	}

	async cancelPull( operationId: string ): Promise< CancelSyncOperationResult > {
		const record = this.records.get( operationId );
		if ( ! record ) {
			return { accepted: false, message: __( 'This pull is no longer active.' ) };
		}

		if ( record.phase === 'importingBackup' || record.progress.key === 'importing' ) {
			return {
				accepted: false,
				message: __(
					'This pull is already importing into the local site and can no longer be cancelled.'
				),
			};
		}

		this.cancelledOperations.add( operationId );
		this.runtimes.get( operationId )?.abortController.abort();
		ACTIVE_SYNC_OPERATIONS.delete( operationId );
		await this.removeRecord( operationId );
		await this.removeDownloadFile( record.downloadFilePath );
		const selectedSite = SiteServer.get( record.localSiteId )?.details;
		if ( selectedSite ) {
			this.emitSnapshot( {
				operationId,
				selectedSiteId: record.localSiteId,
				remoteSiteId: record.connectedSiteId,
				executionModel: 'main',
				sequence: record.sequence + 1,
				selectedSite,
				remoteSiteUrl: record.remoteSiteUrl,
				providerOperation: record.providerOperation,
				pullOptions: record.pullOptions,
				status: {
					key: 'cancelled',
					progress: 0,
					message: __( 'Cancelled' ),
				},
			} );
		}
		return { accepted: true };
	}

	private ensureRuntime( operationId: string ) {
		if ( this.isShuttingDown || this.runtimes.has( operationId ) ) {
			return;
		}

		const abortController = new AbortController();
		const task = this.processRecord( operationId, abortController.signal ).finally( () => {
			const runtime = this.runtimes.get( operationId );
			if ( runtime?.abortController === abortController ) {
				this.runtimes.delete( operationId );
			}
			this.cancelledOperations.delete( operationId );
		} );
		this.runtimes.set( operationId, { abortController, task } );
	}

	private async processRecord( operationId: string, signal: AbortSignal ): Promise< void > {
		try {
			while ( ! signal.aborted ) {
				const record = this.records.get( operationId );
				if ( ! record ) {
					return;
				}

				const selectedSite = SiteServer.get( record.localSiteId )?.details;
				if ( ! selectedSite ) {
					throw new Error( `Local site not found for pull ${ operationId }.` );
				}

				const account = await this.requireProviderAccount( record.providerAccountId );
				await this.assertConnectedSiteStillExists( record );
				const client = getRemoteProviderClient( account.provider );

				if ( record.phase === 'startingRemotePull' ) {
					const providerOperation = await client.startPull(
						account,
						record.remoteSiteId,
						signal
					);
					await this.updateRecord( operationId, ( currentRecord ) => ( {
						...currentRecord,
						phase: 'pollingRemotePull',
						providerOperation,
						progress: getInitialPullProgress(),
					} ) );
					continue;
				}

				if ( record.phase === 'pollingRemotePull' ) {
					if ( ! record.providerOperation ) {
						throw new Error( 'The persisted provider pull operation is missing remote job state.' );
					}

					const update = await client.pollPull( account, record.providerOperation );
					signal.throwIfAborted();
					const nextRecord = await this.applyRemoteUpdate( operationId, update );
					if ( nextRecord?.phase === 'pollingRemotePull' ) {
						await this.sleep( PROVIDER_PULL_POLLING_INTERVAL, signal );
					}
					continue;
				}

				if ( record.phase === 'downloadingArtifact' ) {
					if ( record.downloadFilePath && fs.existsSync( record.downloadFilePath ) ) {
						await this.updateRecord( operationId, ( currentRecord ) => ( {
							...currentRecord,
							phase: 'importingBackup',
							progress: this.getImportingStatus(),
						} ) );
						continue;
					}

					const exportJobId = record.providerOperation?.exportJobId;
					if ( ! exportJobId ) {
						throw new Error( 'The remote export job is missing.' );
					}

					const download = await client.downloadPullArtifact(
						account,
						exportJobId,
						operationId,
						signal
					);
					signal.throwIfAborted();
					await this.updateRecord( operationId, ( currentRecord ) => ( {
						...currentRecord,
						downloadFilePath: download.filePath,
						artifactSizeBytes: download.sizeBytes ?? currentRecord.artifactSizeBytes,
						phase: 'importingBackup',
						progress: this.getImportingStatus(),
					} ) );
					continue;
				}

				if ( record.phase === 'importingBackup' ) {
					if ( ! record.downloadFilePath || ! fs.existsSync( record.downloadFilePath ) ) {
						await this.updateRecord( operationId, ( currentRecord ) => ( {
							...currentRecord,
							phase: 'downloadingArtifact',
							progress: this.getDownloadingStatus(),
						} ) );
						continue;
					}

					await stopSiteServerInternal( record.localSiteId );
					await importSiteBackupInternal( record.localSiteId, {
						path: record.downloadFilePath,
						type: 'application/tar+gzip',
					} );
					signal.throwIfAborted();
					await startSiteServerInternal( record.localSiteId );
					signal.throwIfAborted();
					await this.updateConnectedSitePullTimestamp( record );
					await this.finishSuccessfully( operationId );
					return;
				}
			}
		} catch ( error ) {
			if ( this.cancelledOperations.has( operationId ) ) {
				return;
			}
			if ( signal.aborted || this.isShuttingDown ) {
				return;
			}
			await this.failOperation( operationId, error );
		}
	}

	private async applyRemoteUpdate(
		operationId: string,
		update: RemotePullUpdate
	): Promise< PersistedProviderPullRecord | undefined > {
		if ( update.kind === 'failed' ) {
			await this.failOperation( operationId, new Error( update.message ) );
			return undefined;
		}

		if ( update.kind === 'running' ) {
			return this.updateRecord( operationId, ( currentRecord ) => ( {
				...currentRecord,
				phase: 'pollingRemotePull',
				providerOperation: update.operation,
				progress: {
					key: 'in-progress',
					progress: update.progress,
					message: update.message,
				},
			} ) );
		}

		if (
			typeof update.artifactSizeBytes === 'number' &&
			! ( await this.confirmLargeBackupPull( update.artifactSizeBytes ) )
		) {
			await this.cancelPull( operationId );
			return undefined;
		}

		return this.updateRecord( operationId, ( currentRecord ) => ( {
			...currentRecord,
			phase: 'downloadingArtifact',
			providerOperation: update.operation,
			artifactSizeBytes: update.artifactSizeBytes ?? currentRecord.artifactSizeBytes,
			progress: this.getDownloadingStatus(),
		} ) );
	}

	private async finishSuccessfully( operationId: string ): Promise< void > {
		const record = this.records.get( operationId );
		if ( ! record ) {
			return;
		}

		const selectedSite = SiteServer.get( record.localSiteId )?.details;
		ACTIVE_SYNC_OPERATIONS.delete( operationId );
		await this.removeRecord( operationId );
		await this.removeDownloadFile( record.downloadFilePath );
		if ( selectedSite ) {
			this.emitSnapshot( {
				operationId,
				selectedSiteId: record.localSiteId,
				remoteSiteId: record.connectedSiteId,
				executionModel: 'main',
				sequence: record.sequence + 1,
				selectedSite,
				remoteSiteUrl: record.remoteSiteUrl,
				providerOperation: undefined,
				pullOptions: record.pullOptions,
				status: {
					key: 'finished',
					progress: 100,
					message: __( 'Pull complete' ),
				},
			} );
		}
	}

	private async failOperation( operationId: string, error: unknown ): Promise< void > {
		const record = this.records.get( operationId );
		if ( ! record ) {
			return;
		}

		const selectedSite = SiteServer.get( record.localSiteId )?.details;
		ACTIVE_SYNC_OPERATIONS.delete( operationId );
		await this.removeRecord( operationId );
		await this.removeDownloadFile( record.downloadFilePath );
		Sentry.captureException( error, {
			tags: {
				provider: record.provider,
			},
		} );
		if ( selectedSite ) {
			this.emitSnapshot( {
				operationId,
				selectedSiteId: record.localSiteId,
				remoteSiteId: record.connectedSiteId,
				executionModel: 'main',
				sequence: record.sequence + 1,
				selectedSite,
				remoteSiteUrl: record.remoteSiteUrl,
				providerOperation: record.providerOperation,
				pullOptions: record.pullOptions,
				status: {
					key: 'failed',
					progress: 100,
					message:
						error instanceof Error ? error.message : __( 'Error pulling changes' ),
				},
			} );
		}
	}

	private toSnapshot(
		record: PersistedProviderPullRecord,
		selectedSite?: SiteDetails
	): ProviderPullLifecycleSnapshot {
		const snapshotSite = selectedSite ?? SiteServer.get( record.localSiteId )?.details;
		if ( ! snapshotSite ) {
			throw new Error( `Local site not found for pull ${ record.id }.` );
		}

		return {
			operationId: record.id,
			selectedSiteId: record.localSiteId,
			remoteSiteId: record.connectedSiteId,
			executionModel: 'main',
			sequence: record.sequence,
			selectedSite: snapshotSite,
			remoteSiteUrl: record.remoteSiteUrl,
			providerOperation: record.providerOperation,
			pullOptions: record.pullOptions,
			status: record.progress,
		};
	}

	private emitSnapshot( snapshot: ProviderPullLifecycleSnapshot ) {
		sendIpcEventToRendererWithWindow(
			getRendererWindow(),
			'provider-pull-state-changed',
			snapshot
		);
	}

	private async requireProviderAccount( accountId: string ): Promise< RemoteProviderAccount > {
		const userData = await loadUserData();
		const accounts = userData.remoteProviderAccounts ?? [];
		const account = accounts.find( ( candidate ) => candidate.id === accountId );
		if ( ! account ) {
			throw new Error( 'Remote provider account not found.' );
		}
		return account;
	}

	private async assertConnectedSiteStillExists( record: PersistedProviderPullRecord ) {
		const userData = await loadUserData();
		const connectedSite = ( userData.connectedRemoteSites ?? [] ).find(
			( site ) => site.id === record.connectedSiteId && site.localSiteId === record.localSiteId
		);
		if ( ! connectedSite ) {
			throw new Error( 'The connected remote site is no longer available.' );
		}
	}

	private async updateConnectedSitePullTimestamp( record: PersistedProviderPullRecord ) {
		try {
			await lockAppdata();
			const userData = await loadUserData();
			userData.connectedRemoteSites = userData.connectedRemoteSites || [];
			const index = userData.connectedRemoteSites.findIndex(
				( site ) => site.id === record.connectedSiteId && site.localSiteId === record.localSiteId
			);
			if ( index === -1 ) {
				throw new Error( 'Connected remote site not found while writing the pull timestamp.' );
			}
			const currentSite = userData.connectedRemoteSites[ index ];
			userData.connectedRemoteSites[ index ] = {
				...currentSite,
				lastPullTimestamp: new Date().toISOString(),
			};
			await saveUserData( userData );
		} finally {
			await unlockAppdata();
		}
	}

	private async persistRecord( record: PersistedProviderPullRecord ) {
		this.records.set( record.id, record );
		await this.writeRecordToAppdata( record );
	}

	private async removeRecord( operationId: string ) {
		this.records.delete( operationId );
		try {
			await lockAppdata();
			const userData = await loadUserData();
			userData.providerPullOperations = userData.providerPullOperations || {};
			delete userData.providerPullOperations[ operationId ];
			await saveUserData( userData );
		} finally {
			await unlockAppdata();
		}
	}

	private async updateRecord(
		operationId: string,
		updater: ( currentRecord: PersistedProviderPullRecord ) => PersistedProviderPullRecord
	): Promise< PersistedProviderPullRecord | undefined > {
		const currentRecord = this.records.get( operationId );
		if ( ! currentRecord ) {
			return undefined;
		}

		const nextRecord = {
			...updater( currentRecord ),
			sequence: currentRecord.sequence + 1,
			updatedAt: new Date().toISOString(),
		};
		await this.persistRecord( nextRecord );
		ACTIVE_SYNC_OPERATIONS.set( operationId, nextRecord.progress );
		const selectedSite = SiteServer.get( nextRecord.localSiteId )?.details;
		if ( selectedSite ) {
			this.emitSnapshot( this.toSnapshot( nextRecord, selectedSite ) );
		}
		return nextRecord;
	}

	private async writeRecordToAppdata( record: PersistedProviderPullRecord ) {
		try {
			await lockAppdata();
			const userData = await loadUserData();
			userData.providerPullOperations = userData.providerPullOperations || {};
			userData.providerPullOperations[ record.id ] = record;
			await saveUserData( userData );
		} finally {
			await unlockAppdata();
		}
	}

	private async removeDownloadFile( filePath?: string ) {
		if ( ! filePath ) {
			return;
		}
		await fsPromises.rm( filePath, { force: true } ).catch( () => undefined );
	}

	private async confirmLargeBackupPull( fileSize: number ) {
		if ( fileSize <= SYNC_PUSH_SIZE_LIMIT_BYTES ) {
			return true;
		}

		const CANCEL_ID = 1;
		const { response: userChoice } = await dialog.showMessageBox( {
			type: 'warning',
			message: __( "Large site's backup" ),
			detail: sprintf(
				__(
					"Your site's backup exceeds %d GB. Pulling it will prevent you from pushing the site back.\n\nDo you want to continue?"
				),
				SYNC_PUSH_SIZE_LIMIT_GB
			),
			buttons: [ __( 'Continue' ), __( 'Cancel' ) ],
			defaultId: 0,
			cancelId: CANCEL_ID,
		} );

		return userChoice !== CANCEL_ID;
	}

	private getDownloadingStatus(): PullStateProgressInfo {
		return {
			key: 'downloading',
			progress: 60,
			message: __( 'Downloading backup…' ),
		};
	}

	private getImportingStatus(): PullStateProgressInfo {
		return {
			key: 'importing',
			progress: 80,
			message: __( 'Importing backup…' ),
		};
	}

	private async sleep( durationMs: number, signal: AbortSignal ) {
		await new Promise< void >( ( resolve, reject ) => {
			const timeout = setTimeout( () => {
				signal.removeEventListener( 'abort', onAbort );
				resolve();
			}, durationMs );
			const onAbort = () => {
				clearTimeout( timeout );
				reject( new Error( 'Provider pull sleep aborted.' ) );
			};
			signal.addEventListener( 'abort', onAbort, { once: true } );
		} );
	}
}

export const providerPullManager = new ProviderPullManager();

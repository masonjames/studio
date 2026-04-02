import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import * as Sentry from '@sentry/electron/renderer';
import { __, sprintf } from '@wordpress/i18n';
import { z } from 'zod';
import { SYNC_PUSH_SIZE_LIMIT_BYTES, SYNC_PUSH_SIZE_LIMIT_GB } from 'src/constants';
import { generateStateId } from 'src/hooks/sync-sites/use-pull-push-states';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getHostnameFromUrl } from 'src/lib/url-utils';
import {
	canStudioPullSite,
	getStudioPullDisabledMessage,
} from 'src/modules/sync/providers/pull-activation';
import { hasRemoteProviderClient } from 'src/modules/sync/providers/supported-providers';
import {
	getWpcomNumericSiteId,
	isWpcomSyncSite,
	type ProviderPullLifecycleSnapshot,
	type PullSiteOptions,
	type RemotePullOperation,
	SyncSite,
} from 'src/modules/sync/types';
import { store } from 'src/stores';
import { connectedSitesApi } from 'src/stores/sync/connected-sites';
import { getWpcomClient } from 'src/stores/wpcom-api';
import type {
	PullStateProgressInfo,
	PushStateProgressInfo,
} from 'src/hooks/use-sync-states-progress-info';
import type { AppDispatch, RootState } from 'src/stores';
import type { SyncOption } from 'src/types';

async function updateSiteTimestamp( {
	siteId,
	localSiteId,
	type,
}: {
	siteId: string;
	localSiteId: string;
	type: 'pull' | 'push';
} ) {
	const connectedSites = await getIpcApi().getConnectedRemoteSites( localSiteId );
	const connectedSite = connectedSites.find(
		( { id, localSiteId: siteLocalId } ) => siteId === id && localSiteId === siteLocalId
	);

	if ( ! connectedSite ) {
		return;
	}

	const timestampKey = type === 'pull' ? 'lastPullTimestamp' : 'lastPushTimestamp';
	await getIpcApi().updateConnectedRemoteSites( [
		{
			...connectedSite,
			[ timestampKey ]: new Date().toISOString(),
		},
	] );
}

export type SyncBackupState = {
	remoteSiteId: string;
	legacyRemoteSiteId?: number;
	backupId: number | null;
	providerOperation?: RemotePullOperation;
	pullOptions?: PullSiteOptions;
	executionModel?: 'renderer' | 'main';
	orchestrationSequence?: number;
	status: PullStateProgressInfo;
	downloadUrl: string | null;
	selectedSite: SiteDetails;
	remoteSiteUrl: string;
};

export type PullStates = Record< string, SyncBackupState >;

export type SyncPushState = {
	remoteSiteId: string;
	legacyRemoteSiteId?: number;
	status: PushStateProgressInfo;
	selectedSite: SiteDetails;
	remoteSiteUrl: string;
	uploadProgress?: number;
};

export type PushStates = Record< string, SyncPushState >;

// Factory functions for progress info (canonical definitions, also used by useSyncStatesProgressInfo hook)
export function getPushStatesProgressInfo(): Record<
	PushStateProgressInfo[ 'key' ],
	PushStateProgressInfo
> {
	return {
		creatingBackup: { key: 'creatingBackup', progress: 20, message: __( 'Creating backup…' ) },
		uploading: { key: 'uploading', progress: 40, message: __( 'Uploading site…' ) },
		uploadingPaused: { key: 'uploadingPaused', progress: 45, message: __( 'Uploading paused' ) },
		uploadingManuallyPaused: {
			key: 'uploadingManuallyPaused',
			progress: 45,
			message: __( 'Uploading paused' ),
		},
		creatingRemoteBackup: {
			key: 'creatingRemoteBackup',
			progress: 50,
			message: __( 'Backing up remote site…' ),
		},
		applyingChanges: { key: 'applyingChanges', progress: 60, message: __( 'Applying changes…' ) },
		finishing: { key: 'finishing', progress: 99, message: __( 'Almost there…' ) },
		finished: { key: 'finished', progress: 100, message: __( 'Push complete' ) },
		failed: { key: 'failed', progress: 100, message: __( 'Error pushing changes' ) },
		cancelled: { key: 'cancelled', progress: 0, message: __( 'Cancelled' ) },
	};
}

export function getPullStatesProgressInfo(): Record<
	PullStateProgressInfo[ 'key' ],
	PullStateProgressInfo
> {
	return {
		'in-progress': {
			key: 'in-progress',
			progress: 30,
			message: __( 'Initializing remote backup…' ),
		},
		downloading: { key: 'downloading', progress: 60, message: __( 'Downloading backup…' ) },
		importing: { key: 'importing', progress: 80, message: __( 'Importing backup…' ) },
		finished: { key: 'finished', progress: 100, message: __( 'Pull complete' ) },
		failed: { key: 'failed', progress: 100, message: __( 'Error pulling changes' ) },
		cancelled: { key: 'cancelled', progress: 0, message: __( 'Cancelled' ) },
	};
}

type SyncOperationsState = {
	pullStates: PullStates;
	pushStates: PushStates;
};

const initialState: SyncOperationsState = {
	pullStates: {},
	pushStates: {},
};

type UpdatePullStatePayload = {
	selectedSiteId: string;
	remoteSiteId: string;
	state: Partial< SyncBackupState >;
};

type UpdatePushStatePayload = {
	selectedSiteId: string;
	remoteSiteId: string;
	state: Partial< SyncPushState >;
};

type ClearStatePayload = {
	selectedSiteId: string;
	remoteSiteId: string;
};

const syncOperationsSlice = createSlice( {
	name: 'syncOperations',
	initialState,
	reducers: {
		updatePullState: ( state, action: PayloadAction< UpdatePullStatePayload > ) => {
			const { selectedSiteId, remoteSiteId, state: updateState } = action.payload;
			const stateId = generateStateId( selectedSiteId, remoteSiteId );

			state.pullStates[ stateId ] = {
				...state.pullStates[ stateId ],
				...updateState,
				remoteSiteId,
			};
		},

		clearPullState: ( state, action: PayloadAction< ClearStatePayload > ) => {
			const { selectedSiteId, remoteSiteId } = action.payload;
			const stateId = generateStateId( selectedSiteId, remoteSiteId );
			delete state.pullStates[ stateId ];
		},

		updatePushState: ( state, action: PayloadAction< UpdatePushStatePayload > ) => {
			const { selectedSiteId, remoteSiteId, state: updateState } = action.payload;
			const stateId = generateStateId( selectedSiteId, remoteSiteId );

			state.pushStates[ stateId ] = {
				...state.pushStates[ stateId ],
				...updateState,
				remoteSiteId,
			};
		},

		clearPushState: ( state, action: PayloadAction< ClearStatePayload > ) => {
			const { selectedSiteId, remoteSiteId } = action.payload;
			const stateId = generateStateId( selectedSiteId, remoteSiteId );
			delete state.pushStates[ stateId ];
		},
	},
	extraReducers: ( builder ) => {
		builder
			.addCase( pushSiteThunk.rejected, ( state, action ) => {
				const { connectedSite, selectedSite } = action.meta.arg;
				const stateId = generateStateId( selectedSite.id, connectedSite.id );
				if ( ! action.meta.aborted && state.pushStates[ stateId ] ) {
					state.pushStates[ stateId ].status = getPushStatesProgressInfo().failed;
				}
			} )
			.addCase( pollPushProgressThunk.rejected, ( state, action ) => {
				const { remoteSiteId, selectedSiteId } = action.meta.arg;
				const stateId = generateStateId( selectedSiteId, remoteSiteId );
				if ( ! action.meta.aborted && state.pushStates[ stateId ] ) {
					state.pushStates[ stateId ].status = getPushStatesProgressInfo().failed;
				}
			} )
			.addCase( pullSiteThunk.rejected, ( state, action ) => {
				const { connectedSite, selectedSite } = action.meta.arg;
				const stateId = generateStateId( selectedSite.id, connectedSite.id );
				if ( ! action.meta.aborted && state.pullStates[ stateId ] ) {
					state.pullStates[ stateId ].status = getPullStatesProgressInfo().failed;
				}
			} )
			.addCase( pollPullBackupThunk.rejected, ( state, action ) => {
				const { remoteSiteId, selectedSiteId } = action.meta.arg;
				const stateId = generateStateId( selectedSiteId, remoteSiteId );
				if ( ! action.meta.aborted && state.pullStates[ stateId ] ) {
					state.pullStates[ stateId ].status = getPullStatesProgressInfo().failed;
				}
			} );
	},
} );

export const syncOperationsActions = syncOperationsSlice.actions;
export const syncOperationsReducer = syncOperationsSlice.reducer;

/**
 * Keep upload progress in sync with the renderer store.
 *
 * The main process emits upload progress via IPC while streaming the push backup
 * to WordPress.com (TUS). The UI expects `pushState.uploadProgress` to be updated
 * so it can render "Uploading site (%d%)…" and, optionally, a smoother progress
 * bar during the upload phase.
 */
const UPLOADING_BASE_PROGRESS = 40;
const CREATING_REMOTE_BACKUP_PROGRESS = 50;

window.ipcListener.subscribe( 'sync-upload-network-paused', ( _event, payload ) => {
	store.dispatch(
		syncOperationsActions.updatePushState( {
			selectedSiteId: payload.selectedSiteId,
			remoteSiteId: payload.remoteSiteId,
			state: {
				status: getPushStatesProgressInfo().uploadingPaused,
			},
		} )
	);
} );

window.ipcListener.subscribe( 'sync-upload-manually-paused', ( _event, payload ) => {
	store.dispatch(
		syncOperationsActions.updatePushState( {
			selectedSiteId: payload.selectedSiteId,
			remoteSiteId: payload.remoteSiteId,
			state: {
				status: getPushStatesProgressInfo().uploadingManuallyPaused,
			},
		} )
	);
} );

window.ipcListener.subscribe( 'sync-upload-progress', ( _event, payload ) => {
	const uploadProgress = Math.max( 0, Math.min( 100, payload.progress ) );
	const uploadRange = CREATING_REMOTE_BACKUP_PROGRESS - UPLOADING_BASE_PROGRESS; // 10
	const overallProgress = UPLOADING_BASE_PROGRESS + ( uploadProgress / 100 ) * uploadRange;

	store.dispatch(
		syncOperationsActions.updatePushState( {
			selectedSiteId: payload.selectedSiteId,
			remoteSiteId: payload.remoteSiteId,
			state: {
				uploadProgress,
				status: {
					...getPushStatesProgressInfo().uploading,
					progress: overallProgress,
				},
			},
		} )
	);
} );

window.ipcListener.subscribe( 'sync-upload-resumed', ( _event, payload ) => {
	store.dispatch(
		syncOperationsActions.updatePushState( {
			selectedSiteId: payload.selectedSiteId,
			remoteSiteId: payload.remoteSiteId,
			state: {
				status: getPushStatesProgressInfo().uploading,
			},
		} )
	);
} );

function applyProviderPullLifecycleSnapshot( snapshot: ProviderPullLifecycleSnapshot ) {
	const currentState = syncOperationsSelectors.selectPullState(
		snapshot.selectedSiteId,
		snapshot.remoteSiteId
	)( store.getState() );
	if (
		currentState?.executionModel === 'main' &&
		typeof currentState.orchestrationSequence === 'number' &&
		currentState.orchestrationSequence > snapshot.sequence
	) {
		return;
	}

	store.dispatch(
		syncOperationsActions.updatePullState( {
			selectedSiteId: snapshot.selectedSiteId,
			remoteSiteId: snapshot.remoteSiteId,
			state: {
				backupId: null,
				providerOperation: snapshot.providerOperation,
				pullOptions: snapshot.pullOptions,
				executionModel: snapshot.executionModel,
				orchestrationSequence: snapshot.sequence,
				status: snapshot.status,
				downloadUrl: null,
				remoteSiteUrl: snapshot.remoteSiteUrl,
				selectedSite: snapshot.selectedSite,
			},
		} )
	);

	if ( snapshot.status.key === 'finished' ) {
		void store.dispatch( connectedSitesApi.util.invalidateTags( [ 'ConnectedSites' ] ) );
	}
}

window.ipcListener.subscribe( 'provider-pull-state-changed', ( _event, snapshot ) => {
	applyProviderPullLifecycleSnapshot( snapshot );
} );

const createTypedAsyncThunk = createAsyncThunk.withTypes< {
	state: RootState;
	dispatch: AppDispatch;
	rejectValue: {
		title: string;
		message: string;
		showOpenLogs?: boolean;
		error?: unknown;
	};
} >();

type CancelOperationPayload = {
	selectedSiteId: string;
	remoteSiteId: string;
};

const cancelPushThunk = createTypedAsyncThunk(
	'syncOperations/cancelPush',
	async ( { selectedSiteId, remoteSiteId }: CancelOperationPayload, { dispatch } ) => {
		const operationId = generateStateId( selectedSiteId, remoteSiteId );
		const abortCallback = PUSH_SITE_ABORT_CALLBACKS.get( operationId );

		abortCallback?.();
		const cancellation = await getIpcApi().cancelSyncOperation( operationId );
		if ( ! cancellation.accepted ) {
			if ( cancellation.message ) {
				getIpcApi().showNotification( {
					title: __( 'Unable to cancel push' ),
					body: cancellation.message,
				} );
			}
			return;
		}

		dispatch(
			syncOperationsActions.updatePushState( {
				selectedSiteId,
				remoteSiteId,
				state: { status: getPushStatesProgressInfo().cancelled },
			} )
		);

		getIpcApi().showNotification( {
			title: __( 'Push cancelled' ),
			body: __( 'The push operation has been cancelled.' ),
		} );
	}
);

const cancelPullThunk = createTypedAsyncThunk(
	'syncOperations/cancelPull',
	async ( { selectedSiteId, remoteSiteId }: CancelOperationPayload, { dispatch } ) => {
		const operationId = generateStateId( selectedSiteId, remoteSiteId );
		const cancellation = await getIpcApi().cancelSyncOperation( operationId );
		if ( ! cancellation.accepted ) {
			if ( cancellation.message ) {
				getIpcApi().showNotification( {
					title: __( 'Unable to cancel pull' ),
					body: cancellation.message,
				} );
			}
			return;
		}

		dispatch(
			syncOperationsActions.updatePullState( {
				selectedSiteId,
				remoteSiteId,
				state: { status: getPullStatesProgressInfo().cancelled },
			} )
		);

		getIpcApi()
			.removeSyncBackup( operationId )
			.catch( () => {
				// Ignore errors if file doesn't exist
			} );

		getIpcApi().showNotification( {
			title: __( 'Pull cancelled' ),
			body: __( 'The pull operation has been cancelled.' ),
		} );
	}
);

const getErrorFromResponse = ( error: unknown ): string => {
	if (
		typeof error === 'object' &&
		error !== null &&
		'error' in error &&
		typeof error.error === 'string'
	) {
		return error.error;
	}
	return __( 'Studio was unable to connect to WP.com. Please try again.' );
};

const PUSH_SITE_ABORT_CALLBACKS: Map< string, ( reason?: string | undefined ) => void > = new Map();

type PushSitePayload = {
	connectedSite: SyncSite;
	selectedSite: SiteDetails;
	options?: {
		optionsToSync?: SyncOption[];
		specificSelectionPaths?: string[];
	};
};

const pushSiteThunk = createTypedAsyncThunk< void, PushSitePayload >(
	'syncOperations/pushSite',
	async (
		{ connectedSite, selectedSite, options },
		{ abort, dispatch, signal, rejectWithValue }
	) => {
		const pushStatesProgressInfo = getPushStatesProgressInfo();
		const remoteSiteId = connectedSite.id;
		const remoteSiteUrl = connectedSite.url;
		const operationId = generateStateId( selectedSite.id, remoteSiteId );
		const wpcomRemoteSiteId = getWpcomNumericSiteId( connectedSite );

		if (
			! connectedSite.capabilities.push ||
			! isWpcomSyncSite( connectedSite ) ||
			! wpcomRemoteSiteId
		) {
			return rejectWithValue( {
				title: sprintf( __( 'Error pushing to %s' ), connectedSite.name ),
				message: __( 'Push is not available for this provider yet.' ),
			} );
		}

		try {
			PUSH_SITE_ABORT_CALLBACKS.set( operationId, abort );

			dispatch(
				syncOperationsActions.updatePushState( {
					selectedSiteId: selectedSite.id,
					remoteSiteId,
					state: {
						legacyRemoteSiteId: wpcomRemoteSiteId,
						status: pushStatesProgressInfo.creatingBackup,
						selectedSite,
						remoteSiteUrl,
					},
				} )
			);

			const { archivePath, archiveSizeInBytes } = await getIpcApi().exportSiteForPush(
				selectedSite.id,
				operationId,
				{
					optionsToSync: options?.optionsToSync,
					specificSelectionPaths: options?.specificSelectionPaths,
				}
			);

			if ( archiveSizeInBytes > SYNC_PUSH_SIZE_LIMIT_BYTES ) {
				return rejectWithValue( {
					title: sprintf( __( 'Error pushing to %s' ), connectedSite.name ),
					message: __(
						'The site is too large to push. Please reduce the size of the site and try again.'
					),
				} );
			}

			dispatch(
				syncOperationsActions.updatePushState( {
					selectedSiteId: selectedSite.id,
					remoteSiteId,
					state: { status: pushStatesProgressInfo.uploading },
				} )
			);

			const response = await getIpcApi().pushArchive(
				selectedSite.id,
				remoteSiteId,
				archivePath,
				options?.optionsToSync,
				options?.specificSelectionPaths,
				wpcomRemoteSiteId
			);

			if ( response.success ) {
				dispatch(
					syncOperationsActions.updatePushState( {
						selectedSiteId: selectedSite.id,
						remoteSiteId,
						state: {
							legacyRemoteSiteId: wpcomRemoteSiteId,
							status: pushStatesProgressInfo.creatingRemoteBackup,
							selectedSite,
							remoteSiteUrl,
						},
					} )
				);
			} else {
				return rejectWithValue( {
					title: sprintf( __( 'Error pushing to %s' ), connectedSite.name ),
					message: getErrorFromResponse( response ),
				} );
			}
		} catch ( error ) {
			if ( signal.aborted ) {
				return;
			}
			Sentry.captureException( error );
			return rejectWithValue( {
				title: sprintf( __( 'Error pushing to %s' ), connectedSite.name ),
				message: getErrorFromResponse( error ),
			} );
		} finally {
			PUSH_SITE_ABORT_CALLBACKS.delete( operationId );
		}
	}
);

// Thunk for pull operation
type PullSitePayload = {
	connectedSite: SyncSite;
	selectedSite: SiteDetails;
	options: {
		optionsToSync: SyncOption[];
		include_path_list?: string[];
	};
};

type PullSiteResult = {
	backupId?: number;
	providerOperation?: RemotePullOperation;
	remoteSiteId: string;
};

const pullSiteResponseSchema = z.object( {
	success: z.boolean(),
	backup_id: z.number(),
} );

const importFailedResponseSchema = z.object( {
	status: z.literal( 'failed' ),
	success: z.boolean(),
	error: z.string(),
	error_data: z
		.object( {
			vp_restore_status: z.string().nullable(),
			vp_restore_message: z.string().nullable(),
			vp_rewind_id: z.string().nullable(),
		} )
		.nullable(),
} );

const importWorkingResponseSchema = z.object( {
	status: z.enum( [
		'started',
		'initial_backup_started',
		'initial_backup_finished',
		'archive_import_started',
		'archive_import_finished',
		'finished',
	] ),
	success: z.boolean(),
	backup_progress: z.number().nullable(),
	import_progress: z.number().nullable(),
} );

const importResponseSchema = z.discriminatedUnion( 'status', [
	importWorkingResponseSchema,
	importFailedResponseSchema,
] );

const syncBackupResponseSchema = z.object( {
	status: z.enum( [ 'in-progress', 'finished', 'failed' ] ),
	download_url: z.string().nullable().optional(),
	percent: z.number(),
} );

export const pullSiteThunk = createTypedAsyncThunk< PullSiteResult, PullSitePayload >(
	'syncOperations/pullSite',
	async ( { connectedSite, selectedSite, options }, { dispatch, rejectWithValue } ) => {
		const pullStatesProgressInfo = getPullStatesProgressInfo();
		const remoteSiteId = connectedSite.id;
		const remoteSiteUrl = connectedSite.url;
		const wpcomRemoteSiteId = getWpcomNumericSiteId( connectedSite );
		const isMainOwnedProviderPull =
			hasRemoteProviderClient( connectedSite.provider ) && Boolean( connectedSite.providerAccountId );
		const pullOptions: PullSiteOptions = {
			optionsToSync: [ ...options.optionsToSync ],
			include_path_list: options.include_path_list ? [ ...options.include_path_list ] : undefined,
		};

		if ( ! canStudioPullSite( connectedSite ) ) {
			return rejectWithValue( {
				title: sprintf( __( 'Error pulling from %s' ), connectedSite.name ),
				message: getStudioPullDisabledMessage( connectedSite ),
			} );
		}

		dispatch(
			syncOperationsActions.updatePullState( {
				selectedSiteId: selectedSite.id,
				remoteSiteId,
				state: {
					backupId: null,
					providerOperation: undefined,
					pullOptions,
					executionModel: isMainOwnedProviderPull ? 'main' : 'renderer',
					legacyRemoteSiteId: wpcomRemoteSiteId,
					status: pullStatesProgressInfo[ 'in-progress' ],
					downloadUrl: null,
					remoteSiteUrl,
					selectedSite,
				},
			} )
		);

		try {
			if ( isWpcomSyncSite( connectedSite ) ) {
				const client = getWpcomClient();
				if ( ! client || ! wpcomRemoteSiteId ) {
					return rejectWithValue( {
						title: sprintf( __( 'Error pulling from %s' ), connectedSite.name ),
						message: __( 'Studio was unable to connect to WordPress.com. Please try again.' ),
					} );
				}

				const requestBody: {
					options: SyncOption[];
					include_path_list?: string[];
				} = {
					options: pullOptions.optionsToSync,
					include_path_list: pullOptions.include_path_list,
				};

				const rawResponse = await client.req.post( {
					path: `/sites/${ wpcomRemoteSiteId }/studio-app/sync/backup`,
					apiNamespace: 'wpcom/v2',
					body: requestBody,
				} );
				const response = pullSiteResponseSchema.parse( rawResponse );

				if ( response.success ) {
					dispatch(
						syncOperationsActions.updatePullState( {
							selectedSiteId: selectedSite.id,
							remoteSiteId,
							state: {
								backupId: response.backup_id,
								legacyRemoteSiteId: wpcomRemoteSiteId,
							},
						} )
					);

					return {
						backupId: response.backup_id,
						remoteSiteId,
					};
				}

				throw new Error( 'Pull request failed' );
			}

			if ( hasRemoteProviderClient( connectedSite.provider ) && connectedSite.providerAccountId ) {
				const lifecycle = await getIpcApi().startProviderPullLifecycle( {
					connectedSite,
					selectedSite,
					pullOptions,
				} );
				applyProviderPullLifecycleSnapshot( lifecycle );

				return {
					providerOperation: lifecycle.providerOperation,
					remoteSiteId,
				};
			}

			return rejectWithValue( {
				title: sprintf( __( 'Error pulling from %s' ), connectedSite.name ),
				message: __( 'This provider is not supported yet.' ),
			} );
		} catch ( error ) {
			Sentry.captureException( error );
			return rejectWithValue( {
				title: sprintf( __( 'Error pulling from %s' ), connectedSite.name ),
				message:
					error instanceof Error
						? error.message
						: __( 'Studio was unable to connect to the remote host. Please try again.' ),
			} );
		}
	}
);

// Thunk for polling push progress
type PollPushProgressPayload = {
	selectedSiteId: string;
	signal: AbortSignal;
	remoteSiteId: string;
};

type ImportResponse = z.infer< typeof importResponseSchema >;

const pollPushProgressThunk = createTypedAsyncThunk(
	'syncOperations/pollPushProgress',
	async (
		{ selectedSiteId, signal, remoteSiteId }: PollPushProgressPayload,
		{ dispatch, getState, rejectWithValue }
	) => {
		const pushStatesProgressInfo = getPushStatesProgressInfo();
		// condition guarantees currentPushState exists and is not cancelled
		const currentPushState = syncOperationsSelectors.selectPushState(
			selectedSiteId,
			remoteSiteId
		)( getState() );
		if ( ! currentPushState ) {
			return;
		}

		const client = getWpcomClient();
		const wpcomRemoteSiteId = currentPushState.legacyRemoteSiteId;
		if ( ! client || ! wpcomRemoteSiteId ) {
			return rejectWithValue( {
				title: sprintf( __( 'Error pushing from %s' ), currentPushState.selectedSite.name ),
				message: __( 'Studio was unable to connect to WordPress.com. Please try again.' ),
			} );
		}

		try {
			const rawResponse = await client.req.get(
				`/sites/${ wpcomRemoteSiteId }/studio-app/sync/import`,
				{
					apiNamespace: 'wpcom/v2',
				}
			);
			const response = importResponseSchema.parse( rawResponse );

			signal.throwIfAborted();

			if ( ! response.success ) {
				return rejectWithValue( {
					title: sprintf( __( 'Error pushing to %s' ), currentPushState.selectedSite.name ),
					message: __(
						'An error occurred while pushing the site. If this problem persists, please contact support.'
					),
				} );
			}

			let status: PushStateProgressInfo;
			switch ( response.status ) {
				case 'finished':
					status = pushStatesProgressInfo.finished;
					await updateSiteTimestamp( {
						siteId: remoteSiteId,
						localSiteId: selectedSiteId,
						type: 'push',
					} );
					void dispatch( connectedSitesApi.util.invalidateTags( [ 'ConnectedSites' ] ) );
					getIpcApi().showNotification( {
						title: currentPushState.selectedSite.name,
						body: sprintf(
							// translators: %s is the site url without the protocol.
							__( '%s has been updated' ),
							getHostnameFromUrl( currentPushState.remoteSiteUrl )
						),
					} );
					break;
				case 'failed': {
					console.error( 'Push import failed:', {
						remoteSiteId: currentPushState.remoteSiteId,
						error: response.error,
						error_data: response.error_data,
					} );
					// If the import fails due to a SQL import error, show a more specific message
					const restoreMessage = response.error_data?.vp_restore_message || '';
					const isSqlImportFailure = /importing sql dump/i.test( restoreMessage );
					const isImportTimedOut = response.error === 'Import timed out';
					let message: string;
					if ( isSqlImportFailure ) {
						message = __(
							'Database import failed on the remote site. Please review your database and try again or contact support and provide details from the logs below.'
						);
					} else if ( isImportTimedOut ) {
						message = __(
							"A timeout error occurred while pushing the site, likely due to its large size. Please try reducing the site's content or files and try again. If this problem persists, please contact support."
						);
					} else {
						message = __(
							'An error occurred while pushing the site. If this problem persists, please contact support.'
						);
					}
					return rejectWithValue( {
						title: sprintf( __( 'Error pushing to %s' ), currentPushState.selectedSite.name ),
						message,
						showOpenLogs: true,
					} );
				}
				case 'started':
				case 'initial_backup_started':
				case 'initial_backup_finished':
					status = pushStatesProgressInfo.creatingRemoteBackup;
					if ( response.backup_progress ) {
						const progressRange = pushStatesProgressInfo.applyingChanges.progress - status.progress;
						status.progress = status.progress + progressRange * ( response.backup_progress / 100 );
					}
					break;
				case 'archive_import_started':
					status = pushStatesProgressInfo.applyingChanges;
					if ( response.import_progress ) {
						const progressRange = pushStatesProgressInfo.finishing.progress - status.progress;
						status.progress = status.progress + progressRange * ( response.import_progress / 100 );
					}
					break;
				case 'archive_import_finished':
					status = pushStatesProgressInfo.finishing;
					break;
			}

			dispatch(
				syncOperationsActions.updatePushState( {
					selectedSiteId,
					remoteSiteId,
					state: { status },
				} )
			);
		} catch ( error ) {
			if ( signal.aborted ) {
				return;
			}

			Sentry.captureException( error );
			return rejectWithValue( {
				title: sprintf( __( 'Error pushing from %s' ), currentPushState.selectedSite.name ),
				message: __( 'Failed to check backup file size. Please try again.' ),
			} );
		}
	}
);

// Constants for pull progress calculation (from useSyncStatesProgressInfo)
const IN_PROGRESS_INITIAL_VALUE = 30;
const DOWNLOADING_INITIAL_VALUE = 60;
const IN_PROGRESS_TO_DOWNLOADING_STEP = DOWNLOADING_INITIAL_VALUE - IN_PROGRESS_INITIAL_VALUE;

// Thunk for polling pull backup status
type PollPullBackupPayload = {
	selectedSiteId: string;
	signal: AbortSignal;
	remoteSiteId: string;
};

const pollPullBackupThunk = createTypedAsyncThunk(
	'syncOperations/pollPullBackup',
	async (
		{ selectedSiteId, remoteSiteId, signal }: PollPullBackupPayload,
		{ dispatch, getState, rejectWithValue }
	) => {
		const pullStatesProgressInfo = getPullStatesProgressInfo();
		const currentPullState = syncOperationsSelectors.selectPullState(
			selectedSiteId,
			remoteSiteId
		)( getState() );

		if ( ! currentPullState ) {
			return;
		}

		if ( currentPullState.executionModel === 'main' ) {
			return;
		}

		const operationId = generateStateId( selectedSiteId, remoteSiteId );

		const confirmLargeBackupPull = async ( fileSize: number ) => {
			if ( fileSize <= SYNC_PUSH_SIZE_LIMIT_BYTES ) {
				return true;
			}

			const CANCEL_ID = 1;
			const { response: userChoice } = await getIpcApi().showMessageBox( {
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

			if ( userChoice !== CANCEL_ID ) {
				return true;
			}

			dispatch(
				syncOperationsActions.updatePullState( {
					selectedSiteId,
					remoteSiteId,
					state: {
						status: pullStatesProgressInfo.cancelled,
					},
				} )
			);
			void dispatch( syncOperationsActions.clearPullState( { selectedSiteId, remoteSiteId } ) );
			return false;
		};

		const importDownloadedBackup = async ( filePath: string ) => {
			await getIpcApi().stopServer( selectedSiteId );
			await getIpcApi().importSite( {
				id: selectedSiteId,
				backupFile: {
					path: filePath,
					type: 'application/tar+gzip',
				},
			} );
			await getIpcApi().startServer( selectedSiteId );
		};

		const importDownloadedBackupAndCleanup = async ( filePath: string ) => {
			try {
				await importDownloadedBackup( filePath );
			} finally {
				await getIpcApi()
					.removeSyncBackup( operationId )
					.catch( () => undefined );
			}
		};

		try {
			if ( currentPullState.providerOperation ) {
				const providerAccountId = currentPullState.providerOperation.providerAccountId;
				const update = await getIpcApi().pollRemotePull(
					providerAccountId,
					currentPullState.providerOperation
				);

				signal.throwIfAborted();

				if ( update.kind === 'failed' ) {
					return rejectWithValue( {
						title: sprintf( __( 'Error pulling from %s' ), currentPullState.selectedSite.name ),
						message: update.message,
					} );
				}

				if ( update.kind === 'running' ) {
					dispatch(
						syncOperationsActions.updatePullState( {
							selectedSiteId,
							remoteSiteId,
							state: {
								providerOperation: update.operation,
								status: {
									...pullStatesProgressInfo[ 'in-progress' ],
									progress: update.progress,
									message: update.message,
								},
							},
						} )
					);
					return;
				}

				const exportJobId = update.operation.exportJobId;
				if ( ! exportJobId ) {
					return rejectWithValue( {
						title: sprintf( __( 'Error pulling from %s' ), currentPullState.selectedSite.name ),
						message: __( 'The remote export job is missing.' ),
					} );
				}

				if (
					typeof update.artifactSizeBytes === 'number' &&
					! ( await confirmLargeBackupPull( update.artifactSizeBytes ) )
				) {
					return;
				}

				dispatch(
					syncOperationsActions.updatePullState( {
						selectedSiteId,
						remoteSiteId,
						state: {
							providerOperation: update.operation,
							status: pullStatesProgressInfo.downloading,
						},
					} )
				);

				const { filePath } = await getIpcApi().downloadRemotePullArtifact(
					providerAccountId,
					exportJobId,
					operationId
				);

				dispatch(
					syncOperationsActions.updatePullState( {
						selectedSiteId,
						remoteSiteId,
						state: {
							providerOperation: update.operation,
							status: pullStatesProgressInfo.importing,
						},
					} )
				);

				await importDownloadedBackupAndCleanup( filePath );

				await updateSiteTimestamp( {
					siteId: remoteSiteId,
					localSiteId: selectedSiteId,
					type: 'pull',
				} );
				void dispatch( connectedSitesApi.util.invalidateTags( [ 'ConnectedSites' ] ) );

				dispatch(
					syncOperationsActions.updatePullState( {
						selectedSiteId,
						remoteSiteId,
						state: {
							providerOperation: undefined,
							status: pullStatesProgressInfo.finished,
						},
					} )
				);

				getIpcApi().showNotification( {
					title: currentPullState.selectedSite.name,
					body: sprintf(
						__( 'Studio site has been updated from %s' ),
						getHostnameFromUrl( currentPullState.remoteSiteUrl )
					),
				} );
				return;
			}

			const backupId = currentPullState.backupId;
			const client = getWpcomClient();
			const wpcomRemoteSiteId = currentPullState.legacyRemoteSiteId;
			if ( ! backupId || ! client || ! wpcomRemoteSiteId ) {
				console.error( 'No WordPress.com backup state found' );
				return;
			}

			const rawResponse = await client.req.get(
				`/sites/${ wpcomRemoteSiteId }/studio-app/sync/backup`,
				{
					apiNamespace: 'wpcom/v2',
					backup_id: backupId,
				}
			);
			const response = syncBackupResponseSchema.parse( rawResponse );

			signal.throwIfAborted();

			if ( ! response.status ) {
				throw new Error( 'Unexpected backup response: missing status' );
			}

			const hasBackupCompleted = response.status === 'finished';
			const downloadUrl = hasBackupCompleted ? response.download_url : null;

			if ( downloadUrl ) {
				const fileSize = await getIpcApi().checkSyncBackupSize( downloadUrl );
				if ( ! ( await confirmLargeBackupPull( fileSize ) ) ) {
					return;
				}

				dispatch(
					syncOperationsActions.updatePullState( {
						selectedSiteId,
						remoteSiteId,
						state: {
							status: pullStatesProgressInfo.downloading,
							downloadUrl,
						},
					} )
				);

				const filePath = await getIpcApi().downloadSyncBackup(
					remoteSiteId,
					downloadUrl,
					operationId
				);

				dispatch(
					syncOperationsActions.updatePullState( {
						selectedSiteId,
						remoteSiteId,
						state: {
							status: pullStatesProgressInfo.importing,
						},
					} )
				);

				await importDownloadedBackupAndCleanup( filePath );

				await updateSiteTimestamp( {
					siteId: remoteSiteId,
					localSiteId: selectedSiteId,
					type: 'pull',
				} );
				void dispatch( connectedSitesApi.util.invalidateTags( [ 'ConnectedSites' ] ) );

				dispatch(
					syncOperationsActions.updatePullState( {
						selectedSiteId,
						remoteSiteId,
						state: {
							status: pullStatesProgressInfo.finished,
						},
					} )
				);

				getIpcApi().showNotification( {
					title: currentPullState.selectedSite.name,
					body: sprintf(
						__( 'Studio site has been updated from %s' ),
						getHostnameFromUrl( currentPullState.remoteSiteUrl )
					),
				} );
				return;
			}

			const frontendStatus = hasBackupCompleted
				? pullStatesProgressInfo.downloading.key
				: response.status;
			let statusWithProgress = pullStatesProgressInfo[ frontendStatus ];
			if ( response.status === 'in-progress' ) {
				statusWithProgress = {
					...pullStatesProgressInfo[ frontendStatus ],
					progress:
						IN_PROGRESS_INITIAL_VALUE +
						IN_PROGRESS_TO_DOWNLOADING_STEP * ( response.percent / 100 ),
				};
			}

			dispatch(
				syncOperationsActions.updatePullState( {
					selectedSiteId,
					remoteSiteId,
					state: {
						status: statusWithProgress,
					},
				} )
			);
		} catch ( error ) {
			if ( signal.aborted ) {
				return;
			}

			Sentry.captureException( error );
			return rejectWithValue( {
				title: sprintf( __( 'Error pulling from %s' ), currentPullState.selectedSite.name ),
				message:
					error instanceof Error
						? error.message
						: __( 'Failed to check backup file size. Please try again.' ),
			} );
		}
	}
);

/**
 * Maps an ImportResponse status to a PushStateProgressInfo object.
 * Returns null if the operation is not in progress or unknown.
 */
function mapImportResponseToPushState( response: ImportResponse ): PushStateProgressInfo | null {
	const pushStatesProgressInfo = getPushStatesProgressInfo();
	switch ( response.status ) {
		case 'initial_backup_started':
			return pushStatesProgressInfo.creatingRemoteBackup;
		case 'archive_import_started':
			return pushStatesProgressInfo.applyingChanges;
		case 'archive_import_finished':
			return pushStatesProgressInfo.finishing;
		default:
			return null;
	}
}

// Thunk to initialize push states from in-progress server operations on mount
export const initializeSyncStatesThunk = createTypedAsyncThunk(
	'syncOperations/initializeSyncStates',
	async ( _unused, { dispatch } ) => {
		const allSites = await getIpcApi().getSiteDetails();
		const activeProviderPulls = await getIpcApi().getActiveProviderPullLifecycles();
		activeProviderPulls.forEach( ( snapshot ) => {
			applyProviderPullLifecycleSnapshot( snapshot );
		} );

		const client = getWpcomClient();
		if ( ! client ) {
			return;
		}
		const allConnectedSites = await getIpcApi().getConnectedRemoteSites();

		for ( const connectedSite of allConnectedSites ) {
			try {
				if ( ! isWpcomSyncSite( connectedSite ) ) {
					continue;
				}

				const localSite = allSites.find( ( site ) => site.id === connectedSite.localSiteId );
				const hasConnectionErrors = connectedSite?.syncSupport !== 'already-connected';
				const wpcomRemoteSiteId = getWpcomNumericSiteId( connectedSite );

				if ( ! localSite || hasConnectionErrors || ! wpcomRemoteSiteId ) {
					continue;
				}

				const rawResponse = await client.req.get(
					`/sites/${ wpcomRemoteSiteId }/studio-app/sync/import`,
					{ apiNamespace: 'wpcom/v2' }
				);
				const response = importResponseSchema.parse( rawResponse );

				const status = mapImportResponseToPushState( response );

				// Only restore the pushStates if the operation is still in progress
				if ( status ) {
					dispatch(
						syncOperationsActions.updatePushState( {
							selectedSiteId: connectedSite.localSiteId,
							remoteSiteId: connectedSite.id,
							state: {
								legacyRemoteSiteId: wpcomRemoteSiteId,
								status,
								selectedSite: localSite,
								remoteSiteUrl: connectedSite.url,
							},
						} )
					);
				}
			} catch ( error ) {
				// Continue checking other sites even if one fails
				console.error( `Failed to check push progress for site ${ connectedSite.id }:`, error );
			}
		}
	}
);

// Export thunks object for convenience (must be after all thunk declarations)
export const syncOperationsThunks = {
	cancelPush: cancelPushThunk,
	cancelPull: cancelPullThunk,
	pushSite: pushSiteThunk,
	pullSite: pullSiteThunk,
	pollPushProgress: pollPushProgressThunk,
	pollPullBackup: pollPullBackupThunk,
	initializeSyncStates: initializeSyncStatesThunk,
};

// Helper functions for checking state keys (matching useSyncStatesProgressInfo logic)
const isKeyPulling = ( key?: PullStateProgressInfo[ 'key' ] ): boolean => {
	if ( ! key ) {
		return false;
	}
	const pullingStateKeys = [ 'in-progress', 'downloading', 'importing' ];
	return pullingStateKeys.includes( key );
};

const isKeyPushing = ( key?: PushStateProgressInfo[ 'key' ] ): boolean => {
	if ( ! key ) {
		return false;
	}
	const pushingStateKeys = [
		'creatingBackup',
		'uploading',
		'creatingRemoteBackup',
		'applyingChanges',
		'finishing',
	];
	return pushingStateKeys.includes( key );
};

export const syncOperationsSelectors = {
	selectPullStates: ( state: { syncOperations: SyncOperationsState } ) =>
		state.syncOperations.pullStates,
	selectPushStates: ( state: { syncOperations: SyncOperationsState } ) =>
		state.syncOperations.pushStates,
	selectPullState:
		( selectedSiteId: string, remoteSiteId: string ) =>
		( state: { syncOperations: SyncOperationsState } ): SyncBackupState | undefined => {
			const stateId = generateStateId( selectedSiteId, remoteSiteId );
			return state.syncOperations.pullStates[ stateId ] as SyncBackupState | undefined;
		},
	selectPushState:
		( selectedSiteId: string, remoteSiteId: string ) =>
		( state: { syncOperations: SyncOperationsState } ): SyncPushState | undefined => {
			const stateId = generateStateId( selectedSiteId, remoteSiteId );
			return state.syncOperations.pushStates[ stateId ] as SyncPushState | undefined;
		},
	selectIsAnySitePulling: ( state: { syncOperations: SyncOperationsState } ): boolean => {
		return Object.values( state.syncOperations.pullStates ).some( ( pullState ) =>
			isKeyPulling( pullState.status.key )
		);
	},
	selectIsSiteIdPulling:
		( selectedSiteId: string, remoteSiteId?: string ) =>
		( state: { syncOperations: SyncOperationsState } ): boolean => {
			return Object.values( state.syncOperations.pullStates ).some( ( pullState ) => {
				if ( ! pullState.selectedSite ) {
					return false;
				}
				if ( pullState.selectedSite.id !== selectedSiteId ) {
					return false;
				}
				if ( remoteSiteId !== undefined ) {
					return isKeyPulling( pullState.status.key ) && pullState.remoteSiteId === remoteSiteId;
				}
				return pullState.status && isKeyPulling( pullState.status.key );
			} );
		},
	selectIsAnySitePushing: ( state: { syncOperations: SyncOperationsState } ): boolean => {
		return Object.values( state.syncOperations.pushStates ).some( ( pushState ) =>
			isKeyPushing( pushState.status.key )
		);
	},
	selectIsSiteIdPushing:
		( selectedSiteId: string, remoteSiteId?: string ) =>
		( state: { syncOperations: SyncOperationsState } ): boolean => {
			return Object.values( state.syncOperations.pushStates ).some( ( pushState ) => {
				if ( ! pushState.selectedSite ) {
					return false;
				}
				if ( pushState.selectedSite.id !== selectedSiteId ) {
					return false;
				}
				if ( remoteSiteId !== undefined ) {
					return isKeyPushing( pushState.status.key ) && pushState.remoteSiteId === remoteSiteId;
				}
				return isKeyPushing( pushState.status.key );
			} );
		},
};

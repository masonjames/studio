import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { RootState } from 'src/stores';
import type { SyncSite, SyncModalMode } from 'src/modules/sync/types';

type ConnectedSitesState = {
	isModalOpen: boolean;
	modalMode: SyncModalMode | null;
	selectedRemoteSiteId: string | null;
	selectedLocalSiteId: string | null;
	loadingSiteIds: Record< string, boolean >;
};

function getInitialState(): ConnectedSitesState {
	return {
		isModalOpen: false,
		modalMode: null,
		selectedRemoteSiteId: null,
		selectedLocalSiteId: null,
		loadingSiteIds: {},
	};
}

const connectedSitesSlice = createSlice( {
	name: 'connectedSites',
	initialState: getInitialState(),
	reducers: {
		openModal: ( state, action: PayloadAction< SyncModalMode | undefined > ) => {
			state.isModalOpen = true;
			if ( action.payload ) {
				state.modalMode = action.payload;
			}
		},

		closeModal: ( state ) => {
			state.isModalOpen = false;
			state.selectedRemoteSiteId = null;
			state.selectedLocalSiteId = null;
		},

		setSelectedRemoteSiteId: (
			state,
			action: PayloadAction< { remoteSiteId: string; localSiteId: string } >
		) => {
			state.selectedRemoteSiteId = action.payload.remoteSiteId;
			state.selectedLocalSiteId = action.payload.localSiteId;
		},

		clearSelectedRemoteSiteId: ( state ) => {
			state.selectedRemoteSiteId = null;
			state.selectedLocalSiteId = null;
		},

		addLoadingSiteId: ( state, action: PayloadAction< string > ) => {
			state.loadingSiteIds[ action.payload ] = true;
		},

		removeLoadingSiteId: ( state, action: PayloadAction< string > ) => {
			delete state.loadingSiteIds[ action.payload ];
		},
	},
} );

export const connectedSitesActions = connectedSitesSlice.actions;
export const connectedSitesReducer = connectedSitesSlice.reducer;
export const connectedSitesSelectors = {
	selectIsModalOpen: ( state: RootState ) => state.connectedSites.isModalOpen,
	selectModalMode: ( state: RootState ) => state.connectedSites.modalMode,
	selectSelectedRemoteSiteId: ( state: RootState ) => state.connectedSites.selectedRemoteSiteId,
	selectSelectedLocalSiteId: ( state: RootState ) => state.connectedSites.selectedLocalSiteId,
	selectIsLoadingSiteId: ( id: string ) => ( state: RootState ) =>
		Boolean( state.connectedSites.loadingSiteIds[ id ] ),
};

export const connectedSitesApi = createApi( {
	reducerPath: 'connectedSitesApi',
	baseQuery: fetchBaseQuery(),
	tagTypes: [ 'ConnectedSites' ],
	endpoints: ( builder ) => ( {
		getConnectedSitesForLocalSite: builder.query<
			SyncSite[],
			{ localSiteId?: string; userId?: number }
		>( {
			queryFn: async ( { localSiteId } ) => {
				if ( ! localSiteId ) {
					return { data: [] };
				}

				const sites = await getIpcApi().getConnectedRemoteSites( localSiteId );
				return { data: sites };
			},
			providesTags: ( result, error, arg ) => [
				{ type: 'ConnectedSites', localSiteId: arg.localSiteId, userId: arg.userId },
			],
		} ),

		connectSite: builder.mutation< SyncSite[], { site: SyncSite; localSiteId: string } >( {
			queryFn: async ( { site, localSiteId } ) => {
				await getIpcApi().connectRemoteSites( [
					{
						sites: [ site ],
						localSiteId,
					},
				] );

				const actualConnectedSites = await getIpcApi().getConnectedRemoteSites( localSiteId );

				return { data: actualConnectedSites };
			},
			invalidatesTags: ( result, error, { localSiteId } ) => [
				{ type: 'ConnectedSites', localSiteId },
			],
		} ),

		disconnectSite: builder.mutation< SyncSite[], { siteId: string; localSiteId: string } >( {
			queryFn: async ( { siteId, localSiteId } ) => {
				await getIpcApi().disconnectRemoteSites( [
					{
						siteIds: [ siteId ],
						localSiteId,
					},
				] );

				const actualConnectedSites = await getIpcApi().getConnectedRemoteSites( localSiteId );

				return { data: actualConnectedSites };
			},
			invalidatesTags: ( result, error, { localSiteId } ) => [
				{ type: 'ConnectedSites', localSiteId },
			],
		} ),
	} ),
} );

export const {
	useGetConnectedSitesForLocalSiteQuery,
	useConnectSiteMutation,
	useDisconnectSiteMutation,
} = connectedSitesApi;

import {
	Notice,
	__experimentalHeading as Heading,
	__experimentalHStack as HStack,
	__experimentalText as Text,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Button from 'src/components/button';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { SitesListContent } from 'src/modules/sync/components/sync-sites-modal-selector';
import BridgeAccountForm, {
	bridgeAccountToFormValues,
	createDefaultBridgeAccountFormValues,
} from '../bridge/account-form';
import type {
	RemoteProviderAccount,
	RemoteProviderSiteListResult,
	SyncSite,
	UpsertRemoteProviderAccountInput,
} from 'src/modules/sync/types';

interface MainwpBridgeSiteSelectorProps {
	selectedRemoteSite?: SyncSite;
	setSelectedRemoteSite: ( site?: SyncSite ) => void;
}

export default function MainwpBridgeSiteSelector( {
	selectedRemoteSite,
	setSelectedRemoteSite,
}: MainwpBridgeSiteSelectorProps ) {
	const { __ } = useI18n();
	const [ accounts, setAccounts ] = useState< RemoteProviderAccount[] >( [] );
	const [ selectedAccountId, setSelectedAccountId ] = useState< string | undefined >();
	const [ sites, setSites ] = useState< SyncSite[] >( [] );
	const [ sitesError, setSitesError ] = useState< string | undefined >();
	const [ accountError, setAccountError ] = useState< string | undefined >();
	const [ isSavingAccount, setIsSavingAccount ] = useState( false );
	const [ isLoadingSites, setIsLoadingSites ] = useState( false );
	const [ routeSupport, setRouteSupport ] = useState<
		RemoteProviderSiteListResult[ 'routeSupport' ] | undefined
	>();
	const [ formValues, setFormValues ] = useState( createDefaultBridgeAccountFormValues() );

	const selectedAccount = useMemo(
		() => accounts.find( ( account ) => account.id === selectedAccountId ),
		[ accounts, selectedAccountId ]
	);

	const loadAccounts = useCallback( async () => {
		const nextAccounts = await getIpcApi().listRemoteProviderAccounts( 'mainwpBridge' );
		setAccounts( nextAccounts );
		setSelectedAccountId( ( current ) => current ?? nextAccounts[ 0 ]?.id );
	}, [] );

	useEffect( () => {
		void loadAccounts();
	}, [ loadAccounts ] );

	useEffect( () => {
		if ( selectedAccount ) {
			setFormValues( bridgeAccountToFormValues( selectedAccount ) );
			return;
		}
		setFormValues( createDefaultBridgeAccountFormValues() );
	}, [ selectedAccount ] );

	useEffect( () => {
		if ( ! selectedAccountId ) {
			setSites( [] );
			setSitesError( undefined );
			setRouteSupport( undefined );
			return;
		}

		let cancelled = false;
		const loadSites = async () => {
			setIsLoadingSites( true );
			setSitesError( undefined );
			try {
				const result = await getIpcApi().listRemoteProviderSites( selectedAccountId );
				if ( cancelled ) {
					return;
				}

				setRouteSupport( result.routeSupport );
				const canUseBridgePull = Boolean(
					result.routeSupport?.backupInventory && result.routeSupport?.export
				);
				const normalizedSites = result.sites.map( ( site ) => ( {
					...site,
					providerAccountId: selectedAccountId,
					capabilities: {
						...site.capabilities,
						pull: site.capabilities.pull && canUseBridgePull,
						push: false,
					},
					syncSupport:
						site.capabilities.pull && canUseBridgePull ? site.syncSupport : 'unsupported',
				} ) );
				setSites( normalizedSites );
				if (
					selectedRemoteSite?.providerAccountId !== selectedAccountId ||
					! normalizedSites.some( ( site ) => site.id === selectedRemoteSite?.id )
				) {
					setSelectedRemoteSite( undefined );
				}
			} catch ( error ) {
				if ( cancelled ) {
					return;
				}
				setSites( [] );
				setSelectedRemoteSite( undefined );
				setSitesError(
					error instanceof Error ? error.message : __( 'Unable to load remote sites.' )
				);
			}
			setIsLoadingSites( false );
		};

		void loadSites();
		return () => {
			cancelled = true;
		};
	}, [
		__,
		selectedAccountId,
		selectedRemoteSite?.id,
		selectedRemoteSite?.providerAccountId,
		setSelectedRemoteSite,
	] );

	const handleSaveAccount = useCallback(
		async ( input: UpsertRemoteProviderAccountInput ) => {
			setIsSavingAccount( true );
			setAccountError( undefined );
			try {
				const nextAccount = await getIpcApi().upsertRemoteProviderAccount( input );
				await loadAccounts();
				setSelectedAccountId( nextAccount.id );
			} catch ( error ) {
				setAccountError(
					error instanceof Error ? error.message : __( 'Unable to save the bridge account.' )
				);
			} finally {
				setIsSavingAccount( false );
			}
		},
		[ __, loadAccounts ]
	);

	const handleDeleteAccount = useCallback(
		async ( accountId: string ) => {
			setIsSavingAccount( true );
			setAccountError( undefined );
			try {
				await getIpcApi().deleteRemoteProviderAccount( accountId );
				if ( selectedRemoteSite?.providerAccountId === accountId ) {
					setSelectedRemoteSite( undefined );
				}
				setSelectedAccountId( undefined );
				await loadAccounts();
			} catch ( error ) {
				setAccountError(
					error instanceof Error ? error.message : __( 'Unable to delete the bridge account.' )
				);
			} finally {
				setIsSavingAccount( false );
			}
		},
		[ __, loadAccounts, selectedRemoteSite?.providerAccountId, setSelectedRemoteSite ]
	);

	const handleSiteSelect = useCallback(
		( siteId: string ) => {
			const site = sites.find( ( candidate ) => candidate.id === siteId );
			setSelectedRemoteSite( site );
		},
		[ setSelectedRemoteSite, sites ]
	);

	return (
		<VStack className="w-full max-w-[900px]" alignment="top" spacing={ 4 }>
			<Heading className="text-center text-[32px] text-frame-text" weight={ 500 }>
				{ __( 'Pull from MainWP' ) }
			</Heading>
			<Text className="text-center text-frame-text-secondary max-w-2xl mx-auto">
				{ __(
					'Connect a MainWP-hosted bridge account, choose a managed WordPress site, and pull it into Studio.'
				) }
			</Text>
			<HStack alignment="top" spacing={ 6 } className="w-full">
				<VStack className="min-w-[320px] max-w-[360px]" alignment="top" spacing={ 4 }>
					<VStack alignment="top" spacing={ 2 }>
						<Text className="text-sm font-medium text-frame-text">
							{ __( 'Saved bridge accounts' ) }
						</Text>
						{ accounts.length === 0 ? (
							<Text className="text-frame-text-secondary text-sm">
								{ __( 'Save a bridge account to list your remotely managed sites.' ) }
							</Text>
						) : (
							accounts.map( ( account ) => (
								<Button
									key={ account.id }
									variant={ account.id === selectedAccountId ? 'primary' : 'secondary' }
									onClick={ () => {
										setSelectedAccountId( account.id );
										setSelectedRemoteSite( undefined );
									} }
									className="justify-start"
								>
									{ account.label }
								</Button>
							) )
						) }
					</VStack>
					<BridgeAccountForm
						provider="mainwpBridge"
						value={ formValues }
						onChange={ setFormValues }
						onSave={ handleSaveAccount }
						onDelete={ selectedAccount ? handleDeleteAccount : undefined }
						onReset={ () => {
							setAccountError( undefined );
							setSelectedAccountId( undefined );
							setFormValues( createDefaultBridgeAccountFormValues() );
							setSelectedRemoteSite( undefined );
						} }
						isSaving={ isSavingAccount }
						error={ accountError }
						selectedAccount={ selectedAccount }
						strings={ {
							addHeading: __( 'Add MainWP bridge account' ),
							editHeading: __( 'Edit MainWP bridge account' ),
							labelPlaceholder: __( 'Production MainWP bridge' ),
						} }
					/>
				</VStack>
				<VStack className="flex-1 min-w-0" alignment="top" spacing={ 3 }>
					{ routeSupport && ! ( routeSupport.backupInventory && routeSupport.export ) && (
						<Notice status="warning" isDismissible={ false }>
							{ __(
								'This bridge is reachable, but backup inventory/export support is not enabled yet. Pulling from it is currently unavailable.'
							) }
						</Notice>
					) }
					{ sitesError && (
						<Notice status="error" isDismissible={ false }>
							{ sitesError }
						</Notice>
					) }
					<div className="rounded-xl border border-frame-border overflow-hidden w-full bg-frame-surface">
						<SitesListContent
							isLoading={ isLoadingSites }
							syncSites={ sites }
							selectedSiteId={ selectedRemoteSite?.id || null }
							onSelectSite={ handleSiteSelect }
						/>
					</div>
				</VStack>
			</HStack>
		</VStack>
	);
}

import {
	Notice,
	SelectControl,
	TextControl,
	__experimentalHStack as HStack,
	__experimentalText as Text,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import Button from 'src/components/button';
import type {
	BridgeBackedRemoteProvider,
	RemoteProviderAccount,
	UpsertRemoteProviderAccountInput,
} from 'src/modules/sync/types';

export type BridgeAccountFormValues = {
	id?: string;
	label: string;
	bridgeUrl: string;
	tokenMode: 'single' | 'split';
	readToken: string;
	mutateToken: string;
};

type BridgeAccountFormStrings = {
	addHeading?: string;
	editHeading?: string;
	labelPlaceholder?: string;
	bridgeUrlPlaceholder?: string;
	saveLabel?: string;
	saveChangesLabel?: string;
	resetLabel?: string;
	deleteLabel?: string;
};

interface BridgeAccountFormProps {
	provider: BridgeBackedRemoteProvider;
	value: BridgeAccountFormValues;
	onChange: ( value: BridgeAccountFormValues ) => void;
	onSave: ( input: UpsertRemoteProviderAccountInput ) => Promise< void > | void;
	onDelete?: ( accountId: string ) => Promise< void > | void;
	onReset: () => void;
	isSaving?: boolean;
	error?: string;
	selectedAccount?: RemoteProviderAccount;
	strings?: BridgeAccountFormStrings;
}

export function buildBridgeAccountInput(
	provider: BridgeBackedRemoteProvider,
	value: BridgeAccountFormValues
): UpsertRemoteProviderAccountInput {
	return {
		id: value.id,
		provider,
		label: value.label,
		bridgeUrl: value.bridgeUrl,
		readToken: value.readToken,
		mutateToken: value.tokenMode === 'single' ? value.readToken : value.mutateToken,
		tokenMode: value.tokenMode,
	};
}

export function createDefaultBridgeAccountFormValues(): BridgeAccountFormValues {
	return {
		label: '',
		bridgeUrl: '',
		tokenMode: 'single',
		readToken: '',
		mutateToken: '',
	};
}

export function bridgeAccountToFormValues(
	account: RemoteProviderAccount
): BridgeAccountFormValues {
	return {
		id: account.id,
		label: account.label,
		bridgeUrl: account.bridgeUrl,
		tokenMode: account.tokenMode,
		readToken: account.readToken,
		mutateToken: account.tokenMode === 'single' ? '' : account.mutateToken,
	};
}

export default function BridgeAccountForm( {
	provider,
	value,
	onChange,
	onSave,
	onDelete,
	onReset,
	isSaving = false,
	error,
	selectedAccount,
	strings,
}: BridgeAccountFormProps ) {
	const { __ } = useI18n();
	const copy = {
		addHeading: strings?.addHeading ?? __( 'Add bridge account' ),
		editHeading: strings?.editHeading ?? __( 'Edit bridge account' ),
		labelPlaceholder: strings?.labelPlaceholder ?? __( 'Production bridge' ),
		bridgeUrlPlaceholder: strings?.bridgeUrlPlaceholder ?? 'https://wp-manager.masonjames.com',
		saveLabel: strings?.saveLabel ?? __( 'Save account' ),
		saveChangesLabel: strings?.saveChangesLabel ?? __( 'Save changes' ),
		resetLabel: strings?.resetLabel ?? __( 'Reset' ),
		deleteLabel: strings?.deleteLabel ?? __( 'Delete account' ),
	};

	return (
		<VStack spacing={ 3 } alignment="top">
			<Text className="text-sm font-medium text-frame-text">
				{ selectedAccount ? copy.editHeading : copy.addHeading }
			</Text>
			{ error && (
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
			) }
			<TextControl
				label={ __( 'Label' ) }
				value={ value.label }
				onChange={ ( label ) => onChange( { ...value, label } ) }
				placeholder={ copy.labelPlaceholder }
			/>
			<TextControl
				label={ __( 'Bridge URL' ) }
				value={ value.bridgeUrl }
				onChange={ ( bridgeUrl ) => onChange( { ...value, bridgeUrl } ) }
				placeholder={ copy.bridgeUrlPlaceholder }
			/>
			<SelectControl
				label={ __( 'Token mode' ) }
				value={ value.tokenMode }
				options={ [
					{ label: __( 'Use one token for read and write' ), value: 'single' },
					{ label: __( 'Use separate read and write tokens' ), value: 'split' },
				] }
				onChange={ ( nextValue ) =>
					onChange( {
						...value,
						tokenMode: nextValue as 'single' | 'split',
						mutateToken: nextValue === 'single' ? value.readToken : value.mutateToken,
					} )
				}
				__next40pxDefaultSize
				__nextHasNoMarginBottom
			/>
			<TextControl
				label={ __( 'Read token' ) }
				value={ value.readToken }
				onChange={ ( readToken ) =>
					onChange( {
						...value,
						readToken,
						mutateToken: value.tokenMode === 'single' ? readToken : value.mutateToken,
					} )
				}
				type="password"
			/>
			{ value.tokenMode === 'split' && (
				<TextControl
					label={ __( 'Write token' ) }
					value={ value.mutateToken }
					onChange={ ( mutateToken ) => onChange( { ...value, mutateToken } ) }
					type="password"
				/>
			) }
			<HStack spacing={ 3 } alignment="left">
				<Button
					variant="primary"
					onClick={ () => onSave( buildBridgeAccountInput( provider, value ) ) }
					disabled={
						isSaving ||
						! value.label.trim() ||
						! value.bridgeUrl.trim() ||
						! value.readToken.trim() ||
						( value.tokenMode === 'split' && ! value.mutateToken.trim() )
					}
				>
					{ selectedAccount ? copy.saveChangesLabel : copy.saveLabel }
				</Button>
				<Button variant="tertiary" onClick={ onReset } disabled={ isSaving }>
					{ copy.resetLabel }
				</Button>
				{ selectedAccount?.id && onDelete && (
					<Button
						variant="link"
						onClick={ () => onDelete( selectedAccount.id ) }
						disabled={ isSaving }
					>
						{ copy.deleteLabel }
					</Button>
				) }
			</HStack>
		</VStack>
	);
}

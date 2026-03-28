import {
	Notice,
	SelectControl,
	TextControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalText as Text,
} from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import Button from 'src/components/button';
import type { RemoteProviderAccount, UpsertRemoteProviderAccountInput } from 'src/modules/sync/types';

type MainwpBridgeAccountFormValues = {
	id?: string;
	label: string;
	bridgeUrl: string;
	tokenMode: 'single' | 'split';
	readToken: string;
	mutateToken: string;
};

interface MainwpBridgeAccountFormProps {
	value: MainwpBridgeAccountFormValues;
	onChange: ( value: MainwpBridgeAccountFormValues ) => void;
	onSave: ( input: UpsertRemoteProviderAccountInput ) => Promise< void > | void;
	onDelete?: ( accountId: string ) => Promise< void > | void;
	onReset: () => void;
	isSaving?: boolean;
	error?: string;
	selectedAccount?: RemoteProviderAccount;
}

export function buildBridgeAccountInput(
	value: MainwpBridgeAccountFormValues
): UpsertRemoteProviderAccountInput {
	return {
		id: value.id,
		provider: 'mainwpBridge',
		label: value.label,
		bridgeUrl: value.bridgeUrl,
		readToken: value.readToken,
		mutateToken: value.tokenMode === 'single' ? value.readToken : value.mutateToken,
		tokenMode: value.tokenMode,
	};
}

export function createDefaultBridgeAccountFormValues(): MainwpBridgeAccountFormValues {
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
): MainwpBridgeAccountFormValues {
	return {
		id: account.id,
		label: account.label,
		bridgeUrl: account.bridgeUrl,
		tokenMode: account.tokenMode,
		readToken: account.readToken,
		mutateToken: account.tokenMode === 'single' ? '' : account.mutateToken,
	};
}

export default function MainwpBridgeAccountForm( {
	value,
	onChange,
	onSave,
	onDelete,
	onReset,
	isSaving = false,
	error,
	selectedAccount,
}: MainwpBridgeAccountFormProps ) {
	const { __ } = useI18n();

	return (
		<VStack spacing={ 3 } alignment="top">
			<Text className="text-sm font-medium text-frame-text">
				{ selectedAccount ? __( 'Edit bridge account' ) : __( 'Add bridge account' ) }
			</Text>
			{ error && (
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
			) }
			<TextControl
				label={ __( 'Label' ) }
				value={ value.label }
				onChange={ label => onChange( { ...value, label } ) }
				placeholder={ __( 'Production bridge' ) }
			/>
			<TextControl
				label={ __( 'Bridge URL' ) }
				value={ value.bridgeUrl }
				onChange={ bridgeUrl => onChange( { ...value, bridgeUrl } ) }
				placeholder="https://wp-manager.masonjames.com"
			/>
			<SelectControl
				label={ __( 'Token mode' ) }
				value={ value.tokenMode }
				options={ [
					{ label: __( 'Use one token for read and write' ), value: 'single' },
					{ label: __( 'Use separate read and write tokens' ), value: 'split' },
				] }
				onChange={ nextValue =>
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
				onChange={ readToken =>
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
					onChange={ mutateToken => onChange( { ...value, mutateToken } ) }
					type="password"
				/>
			) }
			<HStack spacing={ 3 } alignment="left">
				<Button
					variant="primary"
					onClick={ () => onSave( buildBridgeAccountInput( value ) ) }
					disabled={
						isSaving ||
						! value.label.trim() ||
						! value.bridgeUrl.trim() ||
						! value.readToken.trim() ||
						( value.tokenMode === 'split' && ! value.mutateToken.trim() )
					}
				>
					{ selectedAccount ? __( 'Save changes' ) : __( 'Save account' ) }
				</Button>
				<Button variant="tertiary" onClick={ onReset } disabled={ isSaving }>
					{ __( 'Reset' ) }
				</Button>
				{ selectedAccount?.id && onDelete && (
					<Button
						variant="link"
						onClick={ () => onDelete( selectedAccount.id ) }
						disabled={ isSaving }
					>
						{ __( 'Delete account' ) }
					</Button>
				) }
			</HStack>
		</VStack>
	);
}

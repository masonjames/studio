import {
	Icon,
	__experimentalHeading as Heading,
	__experimentalHStack as HStack,
	__experimentalText as Text,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { cloud, chevronRight, chevronLeft } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { Tooltip } from 'src/components/tooltip';
import { cx } from 'src/lib/cx';
import {
	getExternalRemoteProviders,
	type RemoteProviderDefinition,
} from 'src/modules/sync/providers/registry';
import type { RemoteProvider } from 'src/modules/sync/types';

interface SelectRemoteProviderProps {
	selectedProvider?: RemoteProvider;
	onSelectProvider: ( provider: RemoteProvider ) => void;
}

function ProviderButton( {
	provider,
	selected,
	onSelect,
}: {
	provider: RemoteProviderDefinition;
	selected: boolean;
	onSelect: ( provider: RemoteProvider ) => void;
} ) {
	const { isRTL } = useI18n();
	const chevron = isRTL() ? chevronLeft : chevronRight;
	const isSelectable = provider.availability === 'available' && provider.siteSelector !== 'none';

	return (
		<Tooltip
			text={ isSelectable ? undefined : provider.availabilityLabel }
			disabled={ isSelectable }
			className="w-full max-w-[520px]"
		>
			<HStack
				as="button"
				className={ cx(
					'w-full p-4 border rounded-xl text-left rtl:text-right transition-colors',
					selected
						? 'border-frame-theme bg-frame-surface'
						: 'border-frame-border hover:border-frame-text-secondary hover:bg-frame-surface',
					! isSelectable && 'opacity-60 cursor-not-allowed'
				) }
				alignment="top"
				onClick={ () => isSelectable && onSelect( provider.id ) }
				disabled={ ! isSelectable }
				spacing={ 5 }
			>
				<Icon icon={ cloud } size={ 24 } fill="var(--color-frame-theme)" />
				<VStack className="flex-1 gap-1.5">
					<HStack alignment="left" spacing={ 2 }>
						<Heading className="text-[15px]" weight="500">
							{ provider.label }
						</Heading>
						{ ! isSelectable && provider.availabilityLabel && (
							<Text className="text-xs text-frame-text-secondary">
								{ provider.availabilityLabel }
							</Text>
						) }
					</HStack>
					<Text className="text-[13px] text-frame-text-secondary" weight="400">
						{ provider.description }
					</Text>
				</VStack>
				<Icon
					className="mt-0.5 text-frame-text-secondary"
					icon={ chevron }
					size={ 24 }
					fill="currentColor"
				/>
			</HStack>
		</Tooltip>
	);
}

export default function SelectRemoteProvider( {
	selectedProvider,
	onSelectProvider,
}: SelectRemoteProviderProps ) {
	const { __ } = useI18n();
	const providers = getExternalRemoteProviders();

	return (
		<VStack className="w-full" alignment="top" spacing={ 4 }>
			<Heading className="text-center text-[32px] text-frame-text" weight={ 500 }>
				{ __( 'Choose a hosting provider' ) }
			</Heading>
			<Text className="text-center text-[15px] font-light text-frame-text-secondary max-w-xl mx-auto">
				{ __(
					'Choose from our planned provider integrations and continue with the providers that are ready in Studio today.'
				) }
			</Text>
			<VStack className="w-full items-center" spacing={ 3 }>
				{ providers.map( ( provider ) => (
					<ProviderButton
						key={ provider.id }
						provider={ provider }
						selected={ provider.id === selectedProvider }
						onSelect={ onSelectProvider }
					/>
				) ) }
			</VStack>
		</VStack>
	);
}

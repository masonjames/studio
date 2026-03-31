import type { BridgeBackedRemoteProvider, RemoteProvider } from 'src/modules/sync/types';

export const SUPPORTED_REMOTE_PROVIDER_CLIENTS = [
	'mainwpBridge',
	'wpRemote',
] as const satisfies readonly BridgeBackedRemoteProvider[];

export type SupportedRemoteProviderClient = ( typeof SUPPORTED_REMOTE_PROVIDER_CLIENTS )[ number ];

export function hasRemoteProviderClient(
	provider: RemoteProvider | undefined | null
): provider is SupportedRemoteProviderClient {
	return Boolean(
		provider &&
			SUPPORTED_REMOTE_PROVIDER_CLIENTS.includes( provider as SupportedRemoteProviderClient )
	);
}

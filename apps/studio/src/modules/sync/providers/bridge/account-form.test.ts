import { describe, expect, it } from 'vitest';
import {
	bridgeAccountToFormValues,
	buildBridgeAccountInput,
	createDefaultBridgeAccountFormValues,
} from './account-form';
import type { RemoteProviderAccount } from 'src/modules/sync/types';

describe( 'bridge account form helpers', () => {
	it( 'creates empty default form values', () => {
		expect( createDefaultBridgeAccountFormValues() ).toEqual( {
			label: '',
			bridgeUrl: '',
			tokenMode: 'single',
			readToken: '',
			mutateToken: '',
		} );
	} );

	it( 'builds a provider-specific bridge account input', () => {
		expect(
			buildBridgeAccountInput( 'mainwpBridge', {
				id: 'account-1',
				label: 'Primary bridge',
				bridgeUrl: 'https://bridge.example.com',
				tokenMode: 'split',
				readToken: 'read-token',
				mutateToken: 'write-token',
			} )
		).toEqual( {
			id: 'account-1',
			provider: 'mainwpBridge',
			label: 'Primary bridge',
			bridgeUrl: 'https://bridge.example.com',
			readToken: 'read-token',
			mutateToken: 'write-token',
			tokenMode: 'split',
		} );
	} );

	it( 'maps a saved account back into editable form values', () => {
		const account: RemoteProviderAccount = {
			id: 'account-1',
			provider: 'mainwpBridge',
			label: 'Primary bridge',
			bridgeUrl: 'https://bridge.example.com',
			tokenMode: 'single',
			readToken: 'read-token',
			mutateToken: 'read-token',
			supportedProviders: [ 'mainwpBridge' ],
			lastValidatedAt: '2026-03-31T00:00:00.000Z',
			createdAt: '2026-03-31T00:00:00.000Z',
			updatedAt: '2026-03-31T00:00:00.000Z',
		};

		expect( bridgeAccountToFormValues( account ) ).toEqual( {
			id: 'account-1',
			label: 'Primary bridge',
			bridgeUrl: 'https://bridge.example.com',
			tokenMode: 'single',
			readToken: 'read-token',
			mutateToken: '',
		} );
	} );
} );

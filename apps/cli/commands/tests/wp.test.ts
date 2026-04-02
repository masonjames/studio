import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockConnectToDaemon,
	mockDisconnectFromDaemon,
	mockRunWpCliCommand,
	mockRunGlobalWpCliCommand,
	mockValidatePhpVersion,
	mockGetSiteByFolder,
	mockIsServerRunning,
	mockSendWpCliCommand,
	mockReportError,
} = vi.hoisted( () => ( {
	mockConnectToDaemon: vi.fn().mockResolvedValue( undefined ),
	mockDisconnectFromDaemon: vi.fn().mockResolvedValue( undefined ),
	mockRunWpCliCommand: vi.fn(),
	mockRunGlobalWpCliCommand: vi.fn(),
	mockValidatePhpVersion: vi.fn( ( version: string ) => version ),
	mockGetSiteByFolder: vi.fn(),
	mockIsServerRunning: vi.fn().mockResolvedValue( true ),
	mockSendWpCliCommand: vi.fn(),
	mockReportError: vi.fn(),
} ) );

vi.mock( '@wordpress/i18n', () => ( {
	__: ( value: string ) => value,
} ) );
vi.mock( 'cli/lib/cli-config/sites', () => ( {
	getSiteByFolder: mockGetSiteByFolder,
} ) );
vi.mock( 'cli/lib/daemon-client', () => ( {
	connectToDaemon: mockConnectToDaemon,
	disconnectFromDaemon: mockDisconnectFromDaemon,
} ) );
vi.mock( 'cli/lib/run-wp-cli-command', () => ( {
	runWpCliCommand: mockRunWpCliCommand,
	runGlobalWpCliCommand: mockRunGlobalWpCliCommand,
} ) );
vi.mock( 'cli/lib/utils', () => ( {
	validatePhpVersion: mockValidatePhpVersion,
} ) );
vi.mock( 'cli/lib/wordpress-server-manager', () => ( {
	isServerRunning: mockIsServerRunning,
	sendWpCliCommand: mockSendWpCliCommand,
} ) );
vi.mock( 'cli/logger', () => {
	class MockLogger {
		reportError = mockReportError;
	}

	class MockLoggerError extends Error {}

	return {
		Logger: MockLogger,
		LoggerError: MockLoggerError,
	};
} );

import { commandHandler } from '../wp';

const originalArgv = process.argv.slice();

function createPhpResponse() {
	const encoder = new TextEncoder();
	const emptyStdout = new ReadableStream( {
		start( controller ) {
			controller.enqueue( encoder.encode( '' ) );
			controller.close();
		},
	} );
	const emptyStderr = new ReadableStream( {
		start( controller ) {
			controller.close();
		},
	} );

	return {
		stdout: emptyStdout,
		stderr: emptyStderr,
		exitCode: Promise.resolve( 0 ),
	};
}

describe( 'CLI: wp command', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		mockGetSiteByFolder.mockResolvedValue( {
			id: 'site-1',
			path: '/test/site',
			phpVersion: '8.1',
		} );
		mockRunWpCliCommand.mockResolvedValue( [ createPhpResponse(), vi.fn() ] );
		mockRunGlobalWpCliCommand.mockResolvedValue( [ createPhpResponse(), vi.fn() ] );
		vi.spyOn( process.stdout, 'write' ).mockImplementation( () => true );
		vi.spyOn( process.stderr, 'write' ).mockImplementation( () => true );
		vi.spyOn( process, 'exit' ).mockImplementation( () => undefined as never );
	} );

	afterEach( () => {
		process.argv = originalArgv.slice();
		vi.restoreAllMocks();
	} );

	it( 'strips the internal memory-limit flag and forwards it to runWpCliCommand', async () => {
		process.argv = [
			'node',
			'studio',
			'wp',
			'--path',
			'/test/site',
			'--php-version',
			'8.3',
			'option',
			'get',
			'siteurl',
			'--studio-php-memory-limit',
			'2048M',
		];
		mockIsServerRunning.mockResolvedValue( false );

		await commandHandler( {
			path: '/test/site',
			studioNoPath: false,
		} as any );

		expect( mockRunWpCliCommand ).toHaveBeenCalledWith(
			'/test/site',
			'8.3',
			[ 'option', 'get', 'siteurl' ],
			{ phpMemoryLimit: '2048M' }
		);
	} );

	it( 'bypasses the daemon path when a custom memory limit is requested', async () => {
		process.argv = [
			'node',
			'studio',
			'wp',
			'--path',
			'/test/site',
			'option',
			'get',
			'siteurl',
			'--studio-php-memory-limit',
			'2048M',
		];
		mockIsServerRunning.mockResolvedValue( true );

		await commandHandler( {
			path: '/test/site',
			studioNoPath: false,
		} as any );

		expect( mockSendWpCliCommand ).not.toHaveBeenCalled();
		expect( mockRunWpCliCommand ).toHaveBeenCalledWith(
			'/test/site',
			'8.1',
			[ 'option', 'get', 'siteurl' ],
			{ phpMemoryLimit: '2048M' }
		);
	} );
} );

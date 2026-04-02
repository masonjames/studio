import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockSetPhpIniEntries,
	mockSetSapiName,
	mockMkdir,
	mockMount,
	mockWriteFile,
	mockSetSpawnHandler,
	mockCli,
	mockExit,
} = vi.hoisted( () => ( {
	mockSetPhpIniEntries: vi.fn().mockResolvedValue( undefined ),
	mockSetSapiName: vi.fn().mockResolvedValue( undefined ),
	mockMkdir: vi.fn(),
	mockMount: vi.fn().mockResolvedValue( undefined ),
	mockWriteFile: vi.fn(),
	mockSetSpawnHandler: vi.fn().mockResolvedValue( undefined ),
	mockCli: vi.fn().mockResolvedValue( {
		stdout: new ReadableStream(),
		stderr: new ReadableStream(),
		exitCode: Promise.resolve( 0 ),
	} ),
	mockExit: vi.fn(),
} ) );

vi.mock( '@php-wasm/node', () => ( {
	loadNodeRuntime: vi.fn().mockResolvedValue( 1 ),
	createNodeFsMountHandler: vi.fn( ( mountedPath: string ) => mountedPath ),
} ) );
vi.mock( '@php-wasm/util', () => ( {
	createSpawnHandler: vi.fn( () => 'spawn-handler' ),
} ) );
vi.mock( '@php-wasm/universal', () => {
	class MockPHP {
		setSapiName = mockSetSapiName;
		mkdir = mockMkdir;
		mount = mockMount;
		writeFile = mockWriteFile;
		setSpawnHandler = mockSetSpawnHandler;
		cli = mockCli;
		exit = mockExit;
	}

	class MockProcessIdAllocator {
		claim() {
			return 1;
		}
	}

	return {
		PHP: MockPHP,
		setPhpIniEntries: mockSetPhpIniEntries,
		ProcessIdAllocator: MockProcessIdAllocator,
	};
} );
vi.mock( '@studio/common/lib/jspi', () => ( {
	IS_JSPI_AVAILABLE: false,
} ) );
vi.mock( '@studio/common/lib/mu-plugins', () => ( {
	cleanupLegacyMuPlugins: vi.fn().mockResolvedValue( undefined ),
	getMuPlugins: vi.fn().mockResolvedValue( [ '/mu-plugins', '/loader.php' ] ),
} ) );
vi.mock( '@wp-playground/wordpress', () => ( {
	setupPlatformLevelMuPlugins: vi.fn().mockResolvedValue( undefined ),
} ) );
vi.mock( 'cli/lib/server-files', () => ( {
	getSqliteCommandPath: vi.fn( () => '/tmp/sqlite-command' ),
	getWpCliPharPath: vi.fn( () => '/tmp/wp-cli.phar' ),
} ) );
vi.mock( '@wordpress/i18n', () => ( {
	__: ( value: string ) => value,
} ) );

import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';

describe( 'runWpCliCommand', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'uses the default PHP memory limit for regular WP-CLI commands', async () => {
		await runWpCliCommand( '/test/site', '8.3', [ 'option', 'get', 'siteurl' ] );

		expect( mockSetPhpIniEntries ).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining( {
				memory_limit: '512M',
			} )
		);
	} );

	it( 'uses an override memory limit when provided', async () => {
		await runWpCliCommand( '/test/site', '8.3', [ 'sqlite', 'import', '/tmp/backup.sql' ], {
			phpMemoryLimit: '2048M',
		} );

		expect( mockSetPhpIniEntries ).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining( {
				memory_limit: '2048M',
			} )
		);
	} );
} );

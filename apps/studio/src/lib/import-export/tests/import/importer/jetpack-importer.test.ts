import fs from 'fs';
import { platformTestSuite } from '@studio/common/lib/tests/utils/platform-test-suite';
import { lstat, move, Stats } from 'fs-extra';
import { vi } from 'vitest';
import { JetpackImporter, SQLImporter } from 'src/lib/import-export/import/importers';
import { batchJetpackExtendedInsertsInPlace } from 'src/lib/import-export/import/importers/jetpack-sql-insert-batching';
import { rewriteSqlFileInPlace } from 'src/lib/import-export/import/importers/sql-file-transform';
import { BackupContents } from 'src/lib/import-export/import/types';
import { SiteServer } from 'src/site-server';

vi.mock( 'fs' );
vi.mock( 'src/site-server' );
vi.mock( 'src/lib/import-export/import/importers/jetpack-sql-insert-batching', () => ( {
	batchJetpackExtendedInsertsInPlace: vi.fn().mockResolvedValue( undefined ),
} ) );
vi.mock( 'src/lib/import-export/import/importers/sql-file-transform', () => ( {
	rewriteSqlFileInPlace: vi.fn().mockResolvedValue( undefined ),
} ) );
vi.mock( 'fs-extra', () => ( {
	lstat: vi.fn(),
	move: vi.fn(),
} ) );

platformTestSuite( 'JetpackImporter', ( { normalize } ) => {
	const mockBackupContents: BackupContents = {
		extractionDirectory: normalize( '/tmp/extracted' ),
		sqlFiles: [
			normalize( '/tmp/extracted/sql/wp_options.sql' ),
			normalize( '/tmp/extracted/sql/wp_posts.sql' ),
		],
		wpConfig: normalize( '/tmp/extracted/wp-config.php' ),
		wpContentFiles: [
			normalize( '/tmp/extracted/wp-content/uploads/2023/image.jpg' ),
			normalize( '/tmp/extracted/wp-content/plugins/jetpack/jetpack.php' ),
			normalize( '/tmp/extracted/wp-content/themes/twentytwentyone/style.css' ),
			normalize( '/tmp/extracted/wp-content/fonts/open-sans.woff2' ),
		],
		wpContentDirectory: 'wp-content',
		metaFile: normalize( '/tmp/extracted/meta.json' ),
	};

	const mockStudioSitePath = normalize( '/path/to/studio/site' );
	const mockStudioSiteId = '123';
	const firstSqlTempPath = '/wordpress/studio-backup-sql-1-2024-08-01-12-00-00.sql';
	const secondSqlTempPath = '/wordpress/studio-backup-sql-2-2024-08-01-12-00-00.sql';
	const firstLegacyCommand =
		`sqlite import ${ firstSqlTempPath } --require=/tmp/sqlite-command/command.php`;
	const secondLegacyCommand =
		`sqlite import ${ secondSqlTempPath } --require=/tmp/sqlite-command/command.php`;
	const firstAstCommand = `${ firstLegacyCommand } --enable-ast-driver`;
	const secondAstCommand = `${ secondLegacyCommand } --enable-ast-driver`;

	beforeEach( () => {
		vi.clearAllMocks();

		const executeWpCliCommand = vi.fn().mockImplementation( ( command: string ) =>
			Promise.resolve(
				command === 'option get siteurl'
					? { stdout: 'http://localhost:8881', stderr: '', exitCode: 0 }
					: { stdout: '', stderr: '', exitCode: 0 }
			)
		);

		vi.mocked( SiteServer.get, { partial: true } ).mockReturnValue( {
			details: {
				path: '/path/to/site',
				id: 'test-id',
				name: 'Test Site',
				port: 8881,
				phpVersion: '8.0',
				running: false,
			},
			executeWpCliCommand,
		} );

		vi.mocked( move ).mockResolvedValue();

		vi.useFakeTimers();
		vi.setSystemTime( new Date( '2024-08-01T12:00:00Z' ) );

		vi.mocked( lstat ).mockImplementation(
			async () =>
				( {
					isDirectory: () => false,
				} ) as Stats
		);
	} );

	describe( 'import', () => {
		it( 'should copy wp-config, wp-content files and read meta file', async () => {
			const importer = new JetpackImporter( mockBackupContents );
			vi.mocked( fs.promises.mkdir ).mockResolvedValue( undefined );
			vi.mocked( fs.promises.copyFile ).mockResolvedValue( undefined );
			vi.mocked( fs.promises.readFile ).mockResolvedValue(
				JSON.stringify( {
					phpVersion: '8.3',
					wordpressVersion: '5.8',
				} )
			);

			await importer.import( mockStudioSitePath, mockStudioSiteId );

			expect( fs.promises.mkdir ).toHaveBeenCalled();
			expect( fs.promises.copyFile ).toHaveBeenCalledTimes( 7 ); // wp-config + wp-content + staged SQL copies
			expect( batchJetpackExtendedInsertsInPlace ).toHaveBeenCalledTimes( 2 );
			expect( fs.promises.readFile ).toHaveBeenCalledWith(
				normalize( '/tmp/extracted/meta.json' ),
				'utf-8'
			);
		} );

		it( 'should keep raw SQL imports AST-first', async () => {
			const importer = new SQLImporter( mockBackupContents );
			await importer.import( mockStudioSitePath, mockStudioSiteId );

			expect( batchJetpackExtendedInsertsInPlace ).not.toHaveBeenCalled();

			const siteServer = SiteServer.get( mockStudioSiteId ) as unknown as {
				executeWpCliCommand: ReturnType< typeof vi.fn >;
			};

			expect( rewriteSqlFileInPlace ).toHaveBeenCalledTimes( 2 );
			expect( siteServer.executeWpCliCommand ).toHaveBeenNthCalledWith( 1, firstAstCommand, {
				targetPhpVersion: '8.3',
				phpMemoryLimit: '2048M',
				skipPluginsAndThemes: true,
			} );
			expect( siteServer.executeWpCliCommand ).toHaveBeenNthCalledWith( 2, secondAstCommand, {
				targetPhpVersion: '8.3',
				phpMemoryLimit: '2048M',
				skipPluginsAndThemes: true,
			} );

			expect( fs.promises.rm ).toHaveBeenNthCalledWith(
				1,
				normalize( '/path/to/studio/site/studio-backup-sql-1-2024-08-01-12-00-00.sql' ),
				{ force: true, recursive: true }
			);
			expect( fs.promises.rm ).toHaveBeenNthCalledWith(
				2,
				normalize( '/path/to/studio/site/studio-backup-sql-2-2024-08-01-12-00-00.sql' ),
				{ force: true, recursive: true }
			);
		} );

		it( 'should clean up staged SQL files when staging fails before import begins', async () => {
			vi.mocked( rewriteSqlFileInPlace )
				.mockResolvedValueOnce( undefined )
				.mockRejectedValueOnce( new Error( 'boom' ) );

			const importer = new SQLImporter( mockBackupContents );
			const siteServer = SiteServer.get( mockStudioSiteId ) as unknown as {
				executeWpCliCommand: ReturnType< typeof vi.fn >;
			};

			await expect( importer.import( mockStudioSitePath, mockStudioSiteId ) ).rejects.toThrow(
				'boom'
			);
			expect( siteServer.executeWpCliCommand ).not.toHaveBeenCalled();
			expect( fs.promises.rm ).toHaveBeenNthCalledWith(
				1,
				normalize( '/path/to/studio/site/studio-backup-sql-1-2024-08-01-12-00-00.sql' ),
				{ force: true, recursive: true }
			);
			expect( fs.promises.rm ).toHaveBeenNthCalledWith(
				2,
				normalize( '/path/to/studio/site/studio-backup-sql-2-2024-08-01-12-00-00.sql' ),
				{ force: true, recursive: true }
			);
		} );

		it( 'should try Jetpack SQL imports in legacy mode before AST fallback', async () => {
			const siteServer = SiteServer.get( mockStudioSiteId ) as unknown as {
				executeWpCliCommand: ReturnType< typeof vi.fn >;
			};
			siteServer.executeWpCliCommand.mockImplementation( ( command: string ) => {
				if ( command === 'option get siteurl' ) {
					return Promise.resolve( { stdout: 'http://localhost:8881', stderr: '', exitCode: 0 } );
				}

				if ( command === secondLegacyCommand ) {
					return Promise.resolve( {
						stdout: '',
						stderr: 'SQL syntax error near unsupported legacy construct',
						exitCode: 1,
					} );
				}

				return Promise.resolve( { stdout: '', stderr: '', exitCode: 0 } );
			} );

			const importer = new JetpackImporter( mockBackupContents );
			await importer.import( mockStudioSitePath, mockStudioSiteId );

			expect( siteServer.executeWpCliCommand ).toHaveBeenNthCalledWith( 1, firstLegacyCommand, {
				targetPhpVersion: '8.3',
				phpMemoryLimit: '2048M',
				skipPluginsAndThemes: true,
			} );
			expect( siteServer.executeWpCliCommand ).toHaveBeenNthCalledWith( 2, secondLegacyCommand, {
				targetPhpVersion: '8.3',
				phpMemoryLimit: '2048M',
				skipPluginsAndThemes: true,
			} );
			expect( siteServer.executeWpCliCommand ).toHaveBeenNthCalledWith( 3, firstAstCommand, {
				targetPhpVersion: '8.3',
				phpMemoryLimit: '2048M',
				skipPluginsAndThemes: true,
			} );
			expect( siteServer.executeWpCliCommand ).toHaveBeenNthCalledWith( 4, secondAstCommand, {
				targetPhpVersion: '8.3',
				phpMemoryLimit: '2048M',
				skipPluginsAndThemes: true,
			} );
			expect( fs.promises.writeFile ).toHaveBeenCalledTimes( 2 );
		} );

		it( 'should not retry Jetpack imports with AST when the legacy failure is memory-related', async () => {
			const siteServer = SiteServer.get( mockStudioSiteId ) as unknown as {
				executeWpCliCommand: ReturnType< typeof vi.fn >;
			};
			siteServer.executeWpCliCommand.mockImplementation( ( command: string ) => {
				if ( command === firstLegacyCommand ) {
					return Promise.resolve( {
						stdout: '',
						stderr: 'Fatal error: Out of memory (allocated 1078460416 bytes)',
						exitCode: 1,
					} );
				}

				return Promise.resolve( { stdout: '', stderr: '', exitCode: 0 } );
			} );

			const importer = new JetpackImporter( mockBackupContents );

			await expect( importer.import( mockStudioSitePath, mockStudioSiteId ) ).rejects.toThrow(
				'Out of memory'
			);
			expect( siteServer.executeWpCliCommand ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'should surface both failure modes when Jetpack import fails in legacy and AST mode', async () => {
			const siteServer = SiteServer.get( mockStudioSiteId ) as unknown as {
				executeWpCliCommand: ReturnType< typeof vi.fn >;
			};
			siteServer.executeWpCliCommand.mockImplementation( ( command: string ) => {
				if ( command === 'option get siteurl' ) {
					return Promise.resolve( { stdout: 'http://localhost:8881', stderr: '', exitCode: 0 } );
				}

				if ( command === secondLegacyCommand ) {
					return Promise.resolve( {
						stdout: '',
						stderr: 'SQL syntax error near unsupported legacy construct',
						exitCode: 1,
					} );
				}

				if ( command === firstAstCommand ) {
					return Promise.resolve( {
						stdout: '',
						stderr: 'AST parser failed while processing import',
						exitCode: 1,
					} );
				}

				return Promise.resolve( { stdout: '', stderr: '', exitCode: 0 } );
			} );

			const importer = new JetpackImporter( mockBackupContents );
			const importPromise = importer.import( mockStudioSitePath, mockStudioSiteId );

			await expect( importPromise ).rejects.toThrow(
				'SQLite import failed in both legacy and AST modes.'
			);
			await expect( importPromise ).rejects.toThrow(
				'Legacy stderr: SQL syntax error near unsupported legacy construct'
			);
		} );

		it( 'should handle missing meta file', async () => {
			const importer = new JetpackImporter( { ...mockBackupContents, metaFile: undefined } );
			vi.mocked( fs.promises.mkdir ).mockResolvedValue( undefined );
			vi.mocked( fs.promises.copyFile ).mockResolvedValue( undefined );
			vi.mocked( fs.promises.readFile ).mockResolvedValue( '' );

			await importer.import( mockStudioSitePath, mockStudioSiteId );

			expect( fs.promises.mkdir ).toHaveBeenCalled();
			expect( fs.promises.copyFile ).toHaveBeenCalledTimes( 7 );
			expect( fs.promises.readFile ).not.toHaveBeenCalled();
		} );

		it( 'should handle JSON parse error in meta file', async () => {
			const importer = new JetpackImporter( mockBackupContents );
			vi.mocked( fs.promises.mkdir ).mockResolvedValue( undefined );
			vi.mocked( fs.promises.copyFile ).mockResolvedValue( undefined );
			vi.mocked( fs.promises.readFile ).mockResolvedValue( 'Invalid JSON' );

			await expect(
				importer.import( mockStudioSitePath, mockStudioSiteId )
			).resolves.not.toThrow();

			expect( fs.promises.mkdir ).toHaveBeenCalled();
			expect( fs.promises.copyFile ).toHaveBeenCalledTimes( 7 );
			expect( fs.promises.readFile ).toHaveBeenCalledWith(
				normalize( '/tmp/extracted/meta.json' ),
				'utf-8'
			);
		} );

		it( 'should properly import fonts directory', async () => {
			const importer = new JetpackImporter( mockBackupContents );
			vi.mocked( fs.promises.mkdir ).mockResolvedValue( undefined );
			vi.mocked( fs.promises.copyFile ).mockResolvedValue( undefined );

			await importer.import( mockStudioSitePath, mockStudioSiteId );

			expect( fs.promises.copyFile ).toHaveBeenCalledWith(
				normalize( '/tmp/extracted/wp-content/fonts/open-sans.woff2' ),
				normalize( '/path/to/studio/site/wp-content/fonts/open-sans.woff2' )
			);
		} );

		it( 'should handle missing fonts directory gracefully', async () => {
			const backupWithoutFonts = {
				...mockBackupContents,
				wpContentFiles: mockBackupContents.wpContentFiles.filter(
					( file ) => ! file.includes( 'fonts' )
				),
			};
			const importer = new JetpackImporter( backupWithoutFonts );
			vi.mocked( fs.promises.mkdir ).mockResolvedValue( undefined );
			vi.mocked( fs.promises.copyFile ).mockResolvedValue( undefined );

			await importer.import( mockStudioSitePath, mockStudioSiteId );

			expect( fs.promises.mkdir ).toHaveBeenCalled();
			expect( fs.promises.copyFile ).toHaveBeenCalledTimes( 6 );
		} );

		it( 'should categorize WordPress content files correctly', () => {
			const testFiles = [
				normalize( '/tmp/extracted/wp-content/plugins/akismet/akismet.php' ),
				normalize( '/tmp/extracted/wp-content/plugins/jetpack/jetpack.php' ),
				normalize( '/tmp/extracted/wp-content/plugins/woocommerce/woocommerce.php' ),
				normalize( '/tmp/extracted/wp-content/themes/twentytwentyone/style.css' ),
				normalize( '/tmp/extracted/wp-content/themes/twentytwentythree/index.php' ),
				normalize( '/tmp/extracted/wp-content/uploads/2023/01/image.jpg' ),
				normalize( '/tmp/extracted/wp-content/uploads/2024/02/document.pdf' ),
				normalize( '/tmp/extracted/wp-content/uploads/2024/03/video.mp4' ),
				normalize( '/tmp/extracted/wp-content/index.php' ),
				normalize( '/tmp/extracted/wp-content/fonts/open-sans.woff2' ),
				normalize( '/tmp/extracted/wp-content/mu-plugins/custom.php' ),
				'C:\\tmp\\extracted\\wp-content\\plugins\\hello-world\\hello.php',
				'C:\\tmp\\extracted\\wp-content\\themes\\custom\\functions.php',
				'C:\\tmp\\extracted\\wp-content\\uploads\\2024\\image.png',
				'C:\\tmp\\extracted\\wp-content\\advanced-cache.php',
			];

			const importer = new JetpackImporter( mockBackupContents );
			const categorizedFiles = (
				importer as unknown as {
					categorizeWpContentFiles: ( files: string[] ) => Record< string, string[] >;
				}
			 ).categorizeWpContentFiles( testFiles );

			expect( categorizedFiles ).toEqual( {
				plugins: [
					normalize( '/tmp/extracted/wp-content/plugins/akismet/akismet.php' ),
					normalize( '/tmp/extracted/wp-content/plugins/jetpack/jetpack.php' ),
					normalize( '/tmp/extracted/wp-content/plugins/woocommerce/woocommerce.php' ),
					'C:\\tmp\\extracted\\wp-content\\plugins\\hello-world\\hello.php',
				],
				themes: [
					normalize( '/tmp/extracted/wp-content/themes/twentytwentyone/style.css' ),
					normalize( '/tmp/extracted/wp-content/themes/twentytwentythree/index.php' ),
					'C:\\tmp\\extracted\\wp-content\\themes\\custom\\functions.php',
				],
				uploads: [
					normalize( '/tmp/extracted/wp-content/uploads/2023/01/image.jpg' ),
					normalize( '/tmp/extracted/wp-content/uploads/2024/02/document.pdf' ),
					normalize( '/tmp/extracted/wp-content/uploads/2024/03/video.mp4' ),
					'C:\\tmp\\extracted\\wp-content\\uploads\\2024\\image.png',
				],
				other: [
					normalize( '/tmp/extracted/wp-content/index.php' ),
					normalize( '/tmp/extracted/wp-content/fonts/open-sans.woff2' ),
					normalize( '/tmp/extracted/wp-content/mu-plugins/custom.php' ),
					'C:\\tmp\\extracted\\wp-content\\advanced-cache.php',
				],
			} );
		} );

		it( 'should handle empty file list for categorization', () => {
			const importer = new JetpackImporter( mockBackupContents );
			const categorizedFiles = (
				importer as unknown as {
					categorizeWpContentFiles: ( files: string[] ) => Record< string, string[] >;
				}
			 ).categorizeWpContentFiles( [] );

			expect( categorizedFiles ).toEqual( {
				plugins: [],
				themes: [],
				uploads: [],
				other: [],
			} );
		} );

		it( 'should categorize files without wp-content prefix', () => {
			const testFiles = [
				'/plugins/test-plugin/test.php',
				'/themes/test-theme/style.css',
				'/uploads/image.jpg',
				'/index.php',
			];

			const importer = new JetpackImporter( mockBackupContents );
			const categorizedFiles = (
				importer as unknown as {
					categorizeWpContentFiles: ( files: string[] ) => Record< string, string[] >;
				}
			 ).categorizeWpContentFiles( testFiles );

			expect( categorizedFiles ).toEqual( {
				plugins: [ '/plugins/test-plugin/test.php' ],
				themes: [ '/themes/test-theme/style.css' ],
				uploads: [ '/uploads/image.jpg' ],
				other: [ '/index.php' ],
			} );
		} );
	} );
} );

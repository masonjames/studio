import fs from 'fs';
import { platformTestSuite } from '@studio/common/lib/tests/utils/platform-test-suite';
import { lstat, move, Stats } from 'fs-extra';
import { vi } from 'vitest';
import { LocalImporter } from 'src/lib/import-export/import/importers';
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

platformTestSuite( 'LocalImporter', ( { normalize } ) => {
	const mockBackupContents: BackupContents = {
		extractionDirectory: normalize( '/tmp/extracted' ),
		sqlFiles: [
			normalize( '/tmp/extracted/app/sql/local.sql' ),
			normalize( '/tmp/extracted/app/sql/local.sql' ),
		],
		wpConfig: normalize( '/tmp/extracted/app/wp-config.php' ),
		wpContentFiles: [
			normalize( '/tmp/extracted/app/public/wp-content/uploads/2023/image.jpg' ),
			normalize( '/tmp/extracted/app/public/wp-content/plugins/jetpack/jetpack.php' ),
			normalize( '/tmp/extracted/app/public/wp-content/themes/twentytwentyone/style.css' ),
			normalize( '/tmp/extracted/app/public/wp-content/fonts/open-sans.woff2' ),
		],
		wpContentDirectory: normalize( 'app/public/wp-content' ),
		metaFile: normalize( '/tmp/extracted/local-site.json' ),
	};

	const mockStudioSitePath = normalize( '/path/to/studio/site' );
	const mockStudioSiteId = '123';
	const firstAstCommand =
		'sqlite import /wordpress/studio-backup-sql-1-2024-08-01-12-00-00.sql --require=/tmp/sqlite-command/command.php --enable-ast-driver';
	const secondAstCommand =
		'sqlite import /wordpress/studio-backup-sql-2-2024-08-01-12-00-00.sql --require=/tmp/sqlite-command/command.php --enable-ast-driver';

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
		it( 'should copy wp-content files and read meta file', async () => {
			const importer = new LocalImporter( mockBackupContents );
			vi.mocked( fs.promises.mkdir ).mockResolvedValue( undefined );
			vi.mocked( fs.promises.copyFile ).mockResolvedValue( undefined );
			vi.mocked( fs.promises.readFile ).mockResolvedValue(
				JSON.stringify( {
					services: {
						php: {
							version: '8.2.23',
						},
					},
				} )
			);

			const result = await importer.import( mockStudioSitePath, mockStudioSiteId );

			expect( result?.meta?.phpVersion ).toBe( '8.2' );
			expect( batchJetpackExtendedInsertsInPlace ).not.toHaveBeenCalled();
			expect( fs.promises.mkdir ).toHaveBeenCalled();
			expect( fs.promises.copyFile ).toHaveBeenCalledTimes( 7 );
			expect( fs.promises.readFile ).toHaveBeenCalledWith(
				normalize( '/tmp/extracted/local-site.json' ),
				'utf-8'
			);
		} );

		it( 'should keep local SQL imports AST-first', async () => {
			const importer = new LocalImporter( mockBackupContents );
			await importer.import( mockStudioSitePath, mockStudioSiteId );

			const siteServer = SiteServer.get( mockStudioSiteId ) as unknown as {
				executeWpCliCommand: ReturnType< typeof vi.fn >;
			};

			expect( rewriteSqlFileInPlace ).toHaveBeenCalledTimes( 2 );
			expect( batchJetpackExtendedInsertsInPlace ).not.toHaveBeenCalled();
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
		} );

		it( 'should handle missing meta file', async () => {
			const importer = new LocalImporter( { ...mockBackupContents, metaFile: undefined } );
			vi.mocked( fs.promises.mkdir ).mockResolvedValue( undefined );
			vi.mocked( fs.promises.copyFile ).mockResolvedValue( undefined );
			vi.mocked( fs.promises.readFile ).mockResolvedValue( '' );

			const result = await importer.import( mockStudioSitePath, mockStudioSiteId );

			expect( result?.meta?.phpVersion ).toBe( undefined );
			expect( fs.promises.mkdir ).toHaveBeenCalled();
			expect( fs.promises.copyFile ).toHaveBeenCalledTimes( 7 );
			expect( fs.promises.readFile ).not.toHaveBeenCalled();
			expect( rewriteSqlFileInPlace ).toHaveBeenCalled();
		} );

		it( 'should handle JSON parse error in meta file', async () => {
			const importer = new LocalImporter( mockBackupContents );
			vi.mocked( fs.promises.mkdir ).mockResolvedValue( undefined );
			vi.mocked( fs.promises.copyFile ).mockResolvedValue( undefined );
			vi.mocked( fs.promises.readFile ).mockResolvedValue( 'Invalid JSON' );

			await expect(
				importer.import( mockStudioSitePath, mockStudioSiteId )
			).resolves.not.toThrow();

			expect( fs.promises.mkdir ).toHaveBeenCalled();
			expect( fs.promises.copyFile ).toHaveBeenCalledTimes( 7 );
			expect( fs.promises.readFile ).toHaveBeenCalledWith(
				normalize( '/tmp/extracted/local-site.json' ),
				'utf-8'
			);
		} );

		it( 'should properly import fonts directory', async () => {
			const importer = new LocalImporter( mockBackupContents );
			vi.mocked( fs.promises.mkdir ).mockResolvedValue( undefined );
			vi.mocked( fs.promises.copyFile ).mockResolvedValue( undefined );

			await importer.import( mockStudioSitePath, mockStudioSiteId );

			expect( fs.promises.copyFile ).toHaveBeenCalledWith(
				normalize( '/tmp/extracted/app/public/wp-content/fonts/open-sans.woff2' ),
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
			const importer = new LocalImporter( backupWithoutFonts );
			vi.mocked( fs.promises.mkdir ).mockResolvedValue( undefined );
			vi.mocked( fs.promises.copyFile ).mockResolvedValue( undefined );

			await importer.import( mockStudioSitePath, mockStudioSiteId );

			expect( fs.promises.mkdir ).toHaveBeenCalled();
			expect( fs.promises.copyFile ).toHaveBeenCalledTimes( 6 );
		} );
	} );
} );

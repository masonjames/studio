import { shell } from 'electron';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { SupportedPHPVersionsList } from '@studio/common/types/php-versions';
import { lstat, move } from 'fs-extra';
import semver from 'semver';
import { WP_CLI_SQLITE_IMPORT_MEMORY_LIMIT } from 'src/constants';
import { getSiteUrl } from 'src/lib/get-site-url';
import { generateBackupFilename } from 'src/lib/import-export/export/generate-backup-filename';
import { ImportEvents } from 'src/lib/import-export/import/events';
import { batchJetpackExtendedInsertsInPlace } from 'src/lib/import-export/import/importers/jetpack-sql-insert-batching';
import { rewriteSqlFileInPlace } from 'src/lib/import-export/import/importers/sql-file-transform';
import {
	BackupContents,
	MetaFileData,
	ImportWpContentProgressEventData,
} from 'src/lib/import-export/import/types';
import { serializePlugins } from 'src/lib/serialize-plugins';
import { updateSiteUrl } from 'src/lib/update-site-url';
import { SiteServer } from 'src/site-server';

export interface ImporterResult extends Omit< BackupContents, 'metaFile' > {
	meta?: MetaFileData;
	importerType?: string;
}

export interface Importer extends Partial< EventEmitter > {
	import( rootPath: string, siteId: string ): Promise< ImporterResult >;
}

const MYSQL_DDL_PATTERN =
	/^\s*(CREATE\s+DATABASE|USE\s+`|DROP\s+DATABASE|ALTER\s+DATABASE|\/\*![\d]+\s|LOCK\s+TABLES|UNLOCK\s+TABLES|SET\s+@@)/i;

type SqliteImportMode = 'legacy' | 'ast';
type SqliteImportStrategy = 'ast_only' | 'legacy_first_with_ast_fallback';

interface StagedSqlFile {
	sourcePath: string;
	tempPath: string;
	vfsPath: string;
}

class SqliteImportPassError extends Error {
	constructor(
		public readonly mode: SqliteImportMode,
		public readonly sqlFile: string,
		public readonly stderr: string,
		public readonly stdout: string,
		public readonly exitCode: number
	) {
		super( `Database import failed: ${ stderr || stdout || `WP-CLI exited with code ${ exitCode }` }` );
		this.name = 'SqliteImportPassError';
	}
}

abstract class BaseImporter extends EventEmitter implements Importer {
	protected meta?: MetaFileData;

	constructor( protected backup: BackupContents ) {
		super();
	}

	abstract import( rootPath: string, siteId: string ): Promise< ImporterResult >;

	protected async importDatabase(
		rootPath: string,
		siteId: string,
		sqlFiles: string[]
	): Promise< void > {
		if ( ! sqlFiles.length ) {
			return;
		}

		const server = SiteServer.get( siteId );
		if ( ! server ) {
			throw new Error( 'Site not found.' );
		}

		this.emit( ImportEvents.IMPORT_DATABASE_START );

		const stagedSqlFiles = await this.stageSqlFiles( rootPath, sqlFiles );

		try {
			if ( this.getSqliteImportStrategy() === 'legacy_first_with_ast_fallback' ) {
				try {
					await this.importStagedSqlFiles( server, stagedSqlFiles, 'legacy' );
				} catch ( error ) {
					if (
						! ( error instanceof SqliteImportPassError ) ||
						! this.shouldRetrySqliteImportWithAst( error )
					) {
						throw error;
					}

					await this.resetDatabase( rootPath );
					this.emit( ImportEvents.IMPORT_DATABASE_START );

					try {
						await this.importStagedSqlFiles( server, stagedSqlFiles, 'ast' );
					} catch ( astError ) {
						if ( astError instanceof SqliteImportPassError ) {
							throw new Error(
								this.buildSqliteImportFallbackErrorMessage( error, astError )
							);
						}

						throw astError;
					}
				}
			} else {
				await this.importStagedSqlFiles( server, stagedSqlFiles, 'ast' );
			}
		} finally {
			await Promise.all(
				stagedSqlFiles.map( ( { tempPath } ) => this.safelyDeletePath( tempPath ) )
			);
		}

		await updateSiteUrl( server, getSiteUrl( server.details ) );
		this.emit( ImportEvents.IMPORT_DATABASE_COMPLETE );
	}

	protected getSqliteImportStrategy(): SqliteImportStrategy {
		return 'ast_only';
	}

	protected async resetDatabase( rootPath: string ): Promise< void > {
		const databaseDir = path.join( rootPath, 'wp-content', 'database' );
		const dbPath = path.join( databaseDir, '.ht.sqlite' );
		await this.moveExistingDatabaseToTrash( dbPath );
		await fs.promises.mkdir( databaseDir, { recursive: true } );
		await this.createEmptyDatabase( dbPath );
	}

	protected async createEmptyDatabase( dbPath: string ): Promise< void > {
		await fs.promises.writeFile( dbPath, '' );
	}

	protected async moveExistingDatabaseToTrash( dbPath: string ): Promise< void > {
		if ( ! fs.existsSync( dbPath ) ) {
			return;
		}
		await shell.trashItem( dbPath );
	}

	protected async prepareSqlFile( tmpPath: string ): Promise< void > {
		await rewriteSqlFileInPlace( tmpPath, this.transformSqlLine.bind( this ) );
	}

	protected transformSqlLine( line: string ): string | null {
		return MYSQL_DDL_PATTERN.test( line ) ? null : line;
	}

	private async stageSqlFiles(
		rootPath: string,
		sqlFiles: string[]
	): Promise< StagedSqlFile[] > {
		const sortedSqlFiles = [ ...sqlFiles ].sort( ( a, b ) => a.localeCompare( b ) );
		const stagedSqlFiles: StagedSqlFile[] = [];

		try {
			for ( const [ index, sqlFile ] of sortedSqlFiles.entries() ) {
				const sqlTempFile = `${ generateBackupFilename( `sql-${ index + 1 }` ) }.sql`;
				const tempPath = path.join( rootPath, sqlTempFile );
				const stagedSqlFile = {
					sourcePath: sqlFile,
					tempPath,
					vfsPath: `/wordpress/${ sqlTempFile }`,
				};

				await fs.promises.copyFile( sqlFile, tempPath );
				stagedSqlFiles.push( stagedSqlFile );
				await this.prepareSqlFile( tempPath );
			}
		} catch ( error ) {
			await Promise.all(
				stagedSqlFiles.map( ( { tempPath } ) => this.safelyDeletePath( tempPath ) )
			);
			throw error;
		}

		return stagedSqlFiles;
	}

	private async importStagedSqlFiles(
		server: SiteServer,
		stagedSqlFiles: StagedSqlFile[],
		mode: SqliteImportMode
	): Promise< void > {
		let processedFiles = 0;
		const totalFiles = stagedSqlFiles.length;

		for ( const stagedSqlFile of stagedSqlFiles ) {
			processedFiles++;

			this.emit( ImportEvents.IMPORT_DATABASE_PROGRESS, {
				currentFile: path.basename( stagedSqlFile.sourcePath ),
				processedFiles,
				totalFiles,
			} );

			console.log(
				`Importing ${ stagedSqlFile.sourcePath }${ mode === 'ast' ? ' with AST driver' : '' }`
			);

			const { stderr, exitCode, stdout } = await server.executeWpCliCommand(
				this.buildSqliteImportCommand( stagedSqlFile.vfsPath, mode ),
				// SQLite plugin requires PHP 8+
				{
					targetPhpVersion: DEFAULT_PHP_VERSION,
					phpMemoryLimit: WP_CLI_SQLITE_IMPORT_MEMORY_LIMIT,
					skipPluginsAndThemes: true,
				}
			);

			if ( stdout ) {
				console.log( `SQLite import stdout: ${ stdout }` );
			}

			if ( stderr ) {
				console.error( `Error during import of ${ stagedSqlFile.sourcePath }:`, stderr );
			}

			if ( exitCode ) {
				throw new SqliteImportPassError(
					mode,
					stagedSqlFile.sourcePath,
					stderr,
					stdout,
					exitCode
				);
			}
		}
	}

	private buildSqliteImportCommand(
		vfsPath: string,
		mode: SqliteImportMode
	): string {
		const baseCommand = `sqlite import ${ vfsPath } --require=/tmp/sqlite-command/command.php`;
		return mode === 'ast' ? `${ baseCommand } --enable-ast-driver` : baseCommand;
	}

	private shouldRetrySqliteImportWithAst( error: SqliteImportPassError ): boolean {
		const errorOutput = [ error.stderr, error.stdout, error.message ].join( '\n' ).toLowerCase();
		const nonRetryPatterns = [
			'allowed memory size',
			'memory exhausted',
			'out of memory',
			'cannot allocate wasm memory',
			'timed out',
			'no such file',
			'failed to open stream',
		];

		return ! nonRetryPatterns.some( ( pattern ) => errorOutput.includes( pattern ) );
	}

	private buildSqliteImportFallbackErrorMessage(
		legacyError: SqliteImportPassError,
		astError: SqliteImportPassError
	): string {
		return [
			'SQLite import failed in both legacy and AST modes.',
			this.formatSqliteImportPassError( 'Legacy', legacyError ),
			this.formatSqliteImportPassError( 'AST', astError ),
		].join( '\n' );
	}

	private formatSqliteImportPassError(
		label: string,
		error: SqliteImportPassError
	): string {
		return [
			`${ label } file: ${ error.sqlFile }`,
			`${ label } exit code: ${ error.exitCode }`,
			`${ label } stderr: ${ error.stderr || '<empty>' }`,
			`${ label } stdout: ${ error.stdout || '<empty>' }`,
		].join( '\n' );
	}

	protected async safelyDeletePath( pathToDelete: string ): Promise< void > {
		try {
			await fs.promises.rm( pathToDelete, { recursive: true, force: true } );
		} catch ( error ) {
			console.error( `Failed to safely delete path ${ pathToDelete }:`, error );
		}
	}
}

abstract class BaseBackupImporter extends BaseImporter {
	protected shouldCleanUpBeforeImport: boolean = true;

	async import( rootPath: string, siteId: string ): Promise< ImporterResult > {
		this.emit( ImportEvents.IMPORT_START );

		try {
			if ( this.shouldCleanUpBeforeImport ) {
				await this.moveExistingWpContentToTrash( rootPath );
			}
			await this.importWpConfig( rootPath );
			await this.importWpContent( rootPath );
			if ( this.backup.metaFile ) {
				this.meta = await this.parseMetaFile();
			}
			if ( this.backup.sqlFiles.length ) {
				await this.resetDatabase( rootPath );
				await this.importDatabase( rootPath, siteId, this.backup.sqlFiles );
			}

			this.emit( ImportEvents.IMPORT_COMPLETE );
			return {
				extractionDirectory: this.backup.extractionDirectory,
				sqlFiles: this.backup.sqlFiles,
				wpContentFiles: this.backup.wpContentFiles,
				wpContentDirectory: this.backup.wpContentDirectory,
				wpConfig: this.backup.wpConfig,
				meta: this.meta,
				importerType: this.constructor.name,
			};
		} catch ( error ) {
			this.emit( ImportEvents.IMPORT_ERROR, error );
			throw error;
		}
	}

	protected abstract parseMetaFile(): Promise< MetaFileData | undefined >;
	protected async moveExistingWpContentToTrash( rootPath: string ): Promise< void > {
		const wpContentDir = path.join( rootPath, 'wp-content' );
		try {
			if ( ! fs.existsSync( wpContentDir ) ) {
				return;
			}
			const contentToKeep = [
				/^mu-plugins$/,
				/^mu-plugins(\/|\\)sqlite-database-integration(\/|\\)?.*/,
				/^database(\/|\\)?.*/,
				/^db\.php$/,
				/^index\.php$/,
				/^languages(\/|\\)?.*/,
			];

			const contents = await fs.promises.readdir( wpContentDir, { recursive: true } );

			for ( const content of contents ) {
				if ( contentToKeep.some( ( pattern ) => pattern.test( content ) ) ) {
					continue;
				}
				await this.safelyDeletePath( path.join( wpContentDir, content ) );
			}
		} catch {
			return;
		}
	}

	protected async importWpConfig( rootPath: string ): Promise< void > {
		const wpConfigPath = path.join( rootPath, 'wp-config.php' );
		const wpConfigSamplePath = path.join( rootPath, 'wp-config-sample.php' );

		if ( this.backup.wpConfig ) {
			await fs.promises.copyFile( this.backup.wpConfig, wpConfigPath );
		} else if ( ! fs.existsSync( wpConfigPath ) && fs.existsSync( wpConfigSamplePath ) ) {
			await fs.promises.copyFile( wpConfigSamplePath, wpConfigPath );
		}
	}

	protected async importWpContent( rootPath: string ): Promise< void > {
		this.emit( ImportEvents.IMPORT_WP_CONTENT_START );
		const extractionDirectory = this.backup.extractionDirectory;
		const wpContentSourceDir = this.backup.wpContentDirectory;
		const wpContentDestDir = path.join( rootPath, 'wp-content' );

		const filesByType = this.categorizeWpContentFiles( this.backup.wpContentFiles );
		let processedItems = 0;
		const totalItems = this.backup.wpContentFiles.length;

		for ( const [ type, files ] of Object.entries( filesByType ) ) {
			for ( const file of files ) {
				try {
					const stats = await lstat( file );
					if ( stats.isDirectory() ) {
						continue;
					}
				} catch {
					continue;
				}

				const relativePath = path.relative(
					path.join( extractionDirectory, wpContentSourceDir ),
					file
				);

				const destPath = path.join( wpContentDestDir, relativePath );
				await fs.promises.mkdir( path.dirname( destPath ), { recursive: true } );
				await fs.promises.copyFile( file, destPath );

				processedItems++;

				this.emit( ImportEvents.IMPORT_WP_CONTENT_PROGRESS, {
					type: type as 'plugins' | 'themes' | 'uploads' | 'other',
					currentItem: relativePath,
					processedItems,
					totalItems,
				} as ImportWpContentProgressEventData );
			}
		}
		this.emit( ImportEvents.IMPORT_WP_CONTENT_COMPLETE );
	}

	protected categorizeWpContentFiles( files: string[] ): Record< string, string[] > {
		const categorized: Record< string, string[] > = {
			plugins: [],
			themes: [],
			uploads: [],
			other: [],
		};

		for ( const file of files ) {
			const segments = file.split( /[/\\]/ );

			if ( segments.includes( 'plugins' ) ) {
				categorized.plugins.push( file );
			} else if ( segments.includes( 'themes' ) ) {
				categorized.themes.push( file );
			} else if ( segments.includes( 'uploads' ) ) {
				categorized.uploads.push( file );
			} else {
				categorized.other.push( file );
			}
		}

		return categorized;
	}

	protected parsePhpVersion( version: string | undefined ): string {
		if ( ! version ) {
			return DEFAULT_PHP_VERSION;
		}
		const phpVersion = semver.coerce( version );
		if ( ! phpVersion ) {
			return DEFAULT_PHP_VERSION;
		}

		const parsedVersion = `${ phpVersion.major }.${ phpVersion.minor }`;

		return SupportedPHPVersionsList.includes( parsedVersion ) ? parsedVersion : DEFAULT_PHP_VERSION;
	}
}

export class JetpackImporter extends BaseBackupImporter {
	protected shouldCleanUpBeforeImport = false;

	protected getSqliteImportStrategy(): SqliteImportStrategy {
		return 'legacy_first_with_ast_fallback';
	}

	protected async prepareSqlFile( tmpPath: string ): Promise< void > {
		await super.prepareSqlFile( tmpPath );
		await batchJetpackExtendedInsertsInPlace( tmpPath );
	}

	protected async parseMetaFile(): Promise< MetaFileData | undefined > {
		const metaFilePath = this.backup.metaFile;
		if ( ! metaFilePath ) {
			return;
		}
		this.emit( ImportEvents.IMPORT_META_START );
		try {
			const metaContent = await fs.promises.readFile( metaFilePath, 'utf-8' );
			const meta = JSON.parse( metaContent );
			return {
				phpVersion: this.parsePhpVersion( meta?.phpVersion ),
				wordpressVersion: meta?.wordpressVersion || '',
			};
		} catch {
			return;
		} finally {
			this.emit( ImportEvents.IMPORT_META_COMPLETE );
		}
	}
}

export class LocalImporter extends BaseBackupImporter {
	protected async parseMetaFile(): Promise< MetaFileData | undefined > {
		const metaFilePath = this.backup.metaFile;
		if ( ! metaFilePath ) {
			return;
		}
		this.emit( ImportEvents.IMPORT_META_START );
		try {
			const metaContent = await fs.promises.readFile( metaFilePath, 'utf-8' );
			const meta = JSON.parse( metaContent );
			return {
				phpVersion: this.parsePhpVersion( meta?.services?.php?.version ),
				wordpressVersion: '',
			};
		} catch {
			return;
		} finally {
			this.emit( ImportEvents.IMPORT_META_COMPLETE );
		}
	}
}

export class PlaygroundImporter extends BaseBackupImporter {
	protected async importDatabase(
		rootPath: string,
		siteId: string,
		sqlFiles: string[]
	): Promise< void > {
		if ( ! sqlFiles.length ) {
			return;
		}
		const server = SiteServer.get( siteId );
		if ( ! server ) {
			throw new Error( 'Site not found.' );
		}

		this.emit( ImportEvents.IMPORT_DATABASE_START );

		for ( const sqlFile of sqlFiles ) {
			await move( sqlFile, path.join( rootPath, 'wp-content', 'database', '.ht.sqlite' ), {
				overwrite: true,
			} );
		}
		await updateSiteUrl( server, getSiteUrl( server.details ) );

		this.emit( ImportEvents.IMPORT_DATABASE_COMPLETE );
	}

	protected async parseMetaFile(): Promise< MetaFileData | undefined > {
		return undefined;
	}
}

export class SQLImporter extends BaseImporter {
	async import( rootPath: string, siteId: string ): Promise< ImporterResult > {
		this.emit( ImportEvents.IMPORT_START );

		try {
			await this.importDatabase( rootPath, siteId, this.backup.sqlFiles );

			this.emit( ImportEvents.IMPORT_COMPLETE );
			return {
				extractionDirectory: this.backup.extractionDirectory,
				sqlFiles: this.backup.sqlFiles,
				wpConfig: this.backup.wpConfig,
				wpContentFiles: this.backup.wpContentFiles,
				wpContentDirectory: this.backup.wpContentDirectory,
				importerType: this.constructor.name,
			};
		} catch ( error ) {
			this.emit( ImportEvents.IMPORT_ERROR, error );
			throw error;
		}
	}
}

export class WpressImporter extends BaseBackupImporter {
	protected async parseMetaFile(): Promise< MetaFileData > {
		const packageJsonPath = path.join( this.backup.extractionDirectory, 'package.json' );
		try {
			const packageContent = await fs.promises.readFile( packageJsonPath, 'utf8' );
			const {
				Template: template = '',
				Stylesheet: stylesheet = '',
				Plugins: plugins = [],
			} = JSON.parse( packageContent );
			return { template, stylesheet, plugins };
		} catch ( error ) {
			console.error( 'Error reading package.json:', error );
			return { template: '', stylesheet: '', plugins: [] };
		}
	}

	protected transformSqlLine( line: string ): string | null {
		const transformedLine = super.transformSqlLine( line );
		if ( transformedLine === null ) {
			return null;
		}

		return transformedLine.replace( /SERVMASK_PREFIX/g, 'wp' );
	}

	protected async addSqlToSetTheme( sqlFiles: string[] ): Promise< void > {
		const { template, stylesheet } = this.meta || {};
		if ( ! template || ! stylesheet ) {
			return;
		}

		const themeUpdateSql = `
				UPDATE wp_options SET option_value = '${ template }' WHERE option_name = 'template';
				UPDATE wp_options SET option_value = '${ stylesheet }' WHERE option_name = 'stylesheet';
			`;
		const sqliteSetThemePath = path.join(
			this.backup.extractionDirectory,
			'studio-wpress-theme.sql'
		);
		await fs.promises.writeFile( sqliteSetThemePath, themeUpdateSql );
		sqlFiles.push( sqliteSetThemePath );
	}

	protected async addSqlToActivatePlugins( sqlFiles: string[] ): Promise< void > {
		const { plugins = [] } = this.meta || {};
		if ( plugins.length === 0 ) {
			return;
		}

		const serializedPlugins = serializePlugins( plugins );
		const activatePluginsSql = `
			INSERT INTO wp_options (option_name, option_value, autoload) VALUES ('active_plugins', '${ serializedPlugins }', 'yes')
			ON DUPLICATE KEY UPDATE option_value = VALUES(option_value), autoload = VALUES(autoload);
		`;

		const sqliteActivatePluginsPath = path.join(
			this.backup.extractionDirectory,
			'studio-wpress-activate-plugins.sql'
		);
		await fs.promises.writeFile( sqliteActivatePluginsPath, activatePluginsSql );
		sqlFiles.push( sqliteActivatePluginsPath );
	}

	protected async importDatabase(
		rootPath: string,
		siteId: string,
		sqlFiles: string[]
	): Promise< void > {
		const server = SiteServer.get( siteId );
		if ( ! server ) {
			throw new Error( 'Site not found.' );
		}
		await this.addSqlToSetTheme( sqlFiles );
		await this.addSqlToActivatePlugins( sqlFiles );
		await super.importDatabase( rootPath, siteId, sqlFiles );
	}
}

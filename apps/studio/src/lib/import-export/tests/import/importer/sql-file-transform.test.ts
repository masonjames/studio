import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rewriteSqlFileInPlace } from 'src/lib/import-export/import/importers/sql-file-transform';

describe( 'rewriteSqlFileInPlace', () => {
	let tempDir: string;

	beforeEach( async () => {
		tempDir = await fs.promises.mkdtemp( path.join( os.tmpdir(), 'studio-sql-transform-' ) );
	} );

	afterEach( async () => {
		await fs.promises.rm( tempDir, { recursive: true, force: true } );
	} );

	it( 'rewrites SQL in place with bounded line transforms', async () => {
		const filePath = path.join( tempDir, 'database.sql' );
		await fs.promises.writeFile(
			filePath,
			[
				'CREATE DATABASE `example`;',
				'USE `example`;',
				'INSERT INTO wp_posts VALUES (1);',
				'LOCK TABLES wp_posts WRITE;',
			].join( '\n' ),
			'utf8'
		);

		await rewriteSqlFileInPlace( filePath, ( line ) =>
			/^\s*(CREATE\s+DATABASE|USE\s+`|LOCK\s+TABLES)/i.test( line ) ? null : line
		);

		expect( await fs.promises.readFile( filePath, 'utf8' ) ).toBe(
			'INSERT INTO wp_posts VALUES (1);\n'
		);
	} );

	it( 'supports composed line transforms for wpress-style replacements', async () => {
		const filePath = path.join( tempDir, 'wpress.sql' );
		await fs.promises.writeFile(
			filePath,
			[
				'INSERT INTO SERVMASK_PREFIX_options VALUES (1);',
				'SET @@SESSION.sql_mode = "NO_AUTO_VALUE_ON_ZERO";',
			].join( '\n' ),
			'utf8'
		);

		await rewriteSqlFileInPlace( filePath, ( line ) => {
			if ( /^\s*SET\s+@@/i.test( line ) ) {
				return null;
			}

			return line.replace( /SERVMASK_PREFIX/g, 'wp' );
		} );

		expect( await fs.promises.readFile( filePath, 'utf8' ) ).toBe(
			'INSERT INTO wp_options VALUES (1);\n'
		);
	} );

	it( 'cleans up temp files when a transform throws', async () => {
		const filePath = path.join( tempDir, 'broken.sql' );
		await fs.promises.writeFile( filePath, 'INSERT INTO wp_options VALUES (1);\n', 'utf8' );

		await expect(
			rewriteSqlFileInPlace( filePath, () => {
				throw new Error( 'boom' );
			} )
		).rejects.toThrow( 'boom' );

		expect( await fs.promises.readFile( filePath, 'utf8' ) ).toBe(
			'INSERT INTO wp_options VALUES (1);\n'
		);
		expect( await fs.promises.readdir( tempDir ) ).toEqual( [ 'broken.sql' ] );
	} );
} );

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { batchJetpackExtendedInsertsInPlace } from 'src/lib/import-export/import/importers/jetpack-sql-insert-batching';

describe( 'batchJetpackExtendedInsertsInPlace', () => {
	let tempDir: string;

	beforeEach( async () => {
		tempDir = await fs.promises.mkdtemp( path.join( os.tmpdir(), 'jetpack-sql-batching-' ) );
	} );

	afterEach( async () => {
		await fs.promises.rm( tempDir, { recursive: true, force: true } );
	} );

	it( 'splits canonical multiline inserts into smaller statements', async () => {
		const filePath = path.join( tempDir, 'database.sql' );
		await fs.promises.writeFile(
			filePath,
			[
				'-- Comment to preserve',
				'CREATE TABLE `wp_demo` (`id` int);',
				'INSERT INTO `wp_demo` (`id`, `value`) VALUES',
				"(1, 'alpha'),",
				"(2, 'beta'),",
				"(3, 'gamma'),",
				"(4, 'delta'),",
				"(5, 'epsilon');",
			].join( '\n' ) + '\n'
		);

		await batchJetpackExtendedInsertsInPlace( filePath, {
			maxRowsPerStatement: 2,
			maxBytesPerStatement: 1024,
		} );

		const rewritten = await fs.promises.readFile( filePath, 'utf8' );

		expect( rewritten.match( /INSERT INTO `wp_demo` \(`id`, `value`\) VALUES/g ) ).toHaveLength( 3 );
		expect( rewritten ).toContain( "(1, 'alpha'),\n(2, 'beta');" );
		expect( rewritten ).toContain( "(3, 'gamma'),\n(4, 'delta');" );
		expect( rewritten ).toContain( "(5, 'epsilon');" );
		expect( rewritten ).toContain( '-- Comment to preserve' );
		expect( rewritten ).toContain( 'CREATE TABLE `wp_demo` (`id` int);' );
	} );

	it( 'preserves quoted commas and semicolons while splitting batches', async () => {
		const filePath = path.join( tempDir, 'quoted-values.sql' );
		await fs.promises.writeFile(
			filePath,
			[
				'INSERT INTO `wp_demo` (`id`, `value`) VALUES',
				"(1, 'semi;colon, comma'),",
				"(2, 'parentheses (ok)'),",
				"(3, 'slash \\\\ quote \' ok');",
			].join( '\n' ) + '\n'
		);

		await batchJetpackExtendedInsertsInPlace( filePath, {
			maxRowsPerStatement: 1,
			maxBytesPerStatement: 1024,
		} );

		const rewritten = await fs.promises.readFile( filePath, 'utf8' );

		expect( rewritten.match( /INSERT INTO `wp_demo` \(`id`, `value`\) VALUES/g ) ).toHaveLength( 3 );
		expect( rewritten ).toContain( "'semi;colon, comma'" );
		expect( rewritten ).toContain( "'parentheses (ok)'" );
		expect( rewritten ).toContain( "'slash \\\\ quote \' ok'" );
	} );

	it( 'leaves unsupported insert shapes unchanged', async () => {
		const filePath = path.join( tempDir, 'unsupported.sql' );
		const original = [
			'INSERT INTO `wp_demo` (`id`, `value`) VALUES',
			"(1, 'alpha')",
			'ON DUPLICATE KEY UPDATE `value` = VALUES(`value`);',
		].join( '\n' ) + '\n';
		await fs.promises.writeFile( filePath, original );

		await batchJetpackExtendedInsertsInPlace( filePath, {
			maxRowsPerStatement: 1,
			maxBytesPerStatement: 32,
		} );

		const rewritten = await fs.promises.readFile( filePath, 'utf8' );
		expect( rewritten ).toBe( original );
	} );
} );

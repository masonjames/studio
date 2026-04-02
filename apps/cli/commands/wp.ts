import { StreamedPHPResponse } from '@php-wasm/universal';
import { __ } from '@wordpress/i18n';
import { ArgumentsCamelCase } from 'yargs';
import yargsParser from 'yargs-parser';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { runWpCliCommand, runGlobalWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { validatePhpVersion } from 'cli/lib/utils';
import { isServerRunning, sendWpCliCommand } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { GlobalOptions } from 'cli/types';

const logger = new Logger< '' >();

async function pipePHPResponse( response: StreamedPHPResponse ) {
	const decoder = new TextDecoder();

	await response.stderr.pipeTo(
		new WritableStream( {
			write( chunk ) {
				process.stderr.write( chunk );
			},
		} )
	);

	await response.stdout.pipeTo(
		new WritableStream( {
			write( chunk ) {
				const text = decoder.decode( chunk, { stream: true } );
				if ( ! text.startsWith( '#!/usr/bin/env' ) ) {
					process.stdout.write( chunk );
				}
			},
		} )
	);
}

enum Mode {
	GLOBAL = 'global',
	SITE = 'site',
}

export async function runCommand(
	mode: Mode,
	siteFolder: string,
	args: string[],
	options: { phpVersion?: string; phpMemoryLimit?: string } = {}
): Promise< void > {
	if ( mode === Mode.GLOBAL ) {
		const [ response, exitPhp ] = await runGlobalWpCliCommand( args );

		await pipePHPResponse( response );
		process.exitCode = await response.exitCode;
		exitPhp();

		return;
	}

	const site = await getSiteByFolder( siteFolder );
	const phpVersion = validatePhpVersion( options.phpVersion ?? site.phpVersion );

	const useCustomPhpVersion = options.phpVersion && options.phpVersion !== site.phpVersion;
	const useCustomPhpMemoryLimit = !! options.phpMemoryLimit;

	if ( ! useCustomPhpVersion && ! useCustomPhpMemoryLimit ) {
		process.on( 'SIGINT', disconnectFromDaemon );
		process.on( 'SIGTERM', disconnectFromDaemon );

		try {
			await connectToDaemon();

			if ( await isServerRunning( site.id ) ) {
				const result = await sendWpCliCommand( site.id, args );
				process.stdout.write( result.stdout );
				process.stderr.write( result.stderr );
				process.exit( result.exitCode );
			}
		} finally {
			await disconnectFromDaemon();
		}
	}

	process.on( 'SIGINT', () => process.exit( 1 ) );
	process.on( 'SIGTERM', () => process.exit( 1 ) );

	const [ response, exitPhp ] = await runWpCliCommand( siteFolder, phpVersion, args, {
		phpMemoryLimit: options.phpMemoryLimit,
	} );

	await pipePHPResponse( response );
	process.exitCode = await response.exitCode;
	exitPhp();
}

function removeArgumentFromArgv(
	argv: string[],
	argName: string,
	hasValue: boolean = true
): string[] {
	argv = argv.slice( 0 );

	while ( argv.indexOf( `--${ argName }` ) !== -1 ) {
		const argIndex = argv.indexOf( `--${ argName }` );
		argv.splice( argIndex, hasValue ? 2 : 1 );
	}

	while ( argv.find( ( arg ) => arg.startsWith( `--${ argName }=` ) ) ) {
		const argIndex = argv.findIndex( ( arg ) => arg.startsWith( `--${ argName }=` ) );
		argv.splice( argIndex, 1 );
	}

	return argv;
}

interface WpCommandOptions extends GlobalOptions {
	studioNoPath?: boolean;
	studioPhpMemoryLimit?: string;
}

export async function commandHandler( argv: ArgumentsCamelCase< WpCommandOptions > ) {
	try {
		let wpCliArgv = removeArgumentFromArgv( process.argv.slice( 3 ), 'path' );
		wpCliArgv = removeArgumentFromArgv( wpCliArgv, 'studio-no-path', false );
		const parsedWpCliArgs = yargsParser( wpCliArgv );

		if ( parsedWpCliArgs._[ 0 ] === 'shell' ) {
			throw new LoggerError(
				__(
					'Studio CLI does not support the WP-CLI `shell` command. Consider adding your code to a file and using the `eval` command.'
				)
			);
		}

		const phpVersion =
			parsedWpCliArgs[ 'php-version' ] !== undefined
				? String( parsedWpCliArgs[ 'php-version' ] )
				: undefined;
		const phpMemoryLimit =
			parsedWpCliArgs[ 'studio-php-memory-limit' ] !== undefined
				? String( parsedWpCliArgs[ 'studio-php-memory-limit' ] )
				: undefined;
		wpCliArgv = removeArgumentFromArgv( wpCliArgv, 'php-version' );
		wpCliArgv = removeArgumentFromArgv( wpCliArgv, 'studio-php-memory-limit' );
		wpCliArgv = removeArgumentFromArgv( wpCliArgv, 'avoid-telemetry', false );

		await runCommand( argv.studioNoPath ? Mode.GLOBAL : Mode.SITE, argv.path, wpCliArgv, {
			phpVersion,
			phpMemoryLimit,
		} );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to run WP-CLI command' ), error );
			logger.reportError( loggerError );
		}
	}
}

import { useCallback } from 'react';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';

export function useFindAvailableSiteName() {
	const { sites } = useSiteDetails();

	return useCallback(
		async ( baseName: string ): Promise< string > => {
			const usedSiteNames = new Set( sites.map( ( site ) => site.name ) );
			const MAX_NAME_ITERATIONS = 500;
			for ( let suffix = 1; suffix < MAX_NAME_ITERATIONS; suffix++ ) {
				const candidateName = suffix === 1 ? baseName : `${ baseName } ${ suffix }`;
				if ( usedSiteNames.has( candidateName ) ) {
					continue;
				}
				const pathInfo = await getIpcApi().generateProposedSitePath( candidateName );
				if ( pathInfo.isEmpty ) {
					return candidateName;
				}
			}
			return `${ baseName } ${ MAX_NAME_ITERATIONS }`;
		},
		[ sites ]
	);
}

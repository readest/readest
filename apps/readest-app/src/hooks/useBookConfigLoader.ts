import { useEffect } from "react";
import { useBookDataStore } from "@/store/bookDataStore";
import type { SystemSettings } from "@/types/settings";
import type { Book } from "@/types/book";
import type { EnvConfigType } from "@/services/environment";

/**
 * Custom hook to handle batch loading of book configurations
 * @param libraryBooks - Array of books to load configs for
 * @param envConfig - Environment configuration
 * @param settings - System settings
 */
export const useBookConfigLoader = (
	libraryBooks: Book[],
	envConfig: EnvConfigType,
	settings: SystemSettings,
) => {
	const { booksData, setConfig } = useBookDataStore();

	useEffect(() => {
		const loadBookConfigs = async () => {
			const appService = await envConfig.getAppService();

			// Process books in batches to avoid blocking the main thread
			const batchSize = 5;
			for (let i = 0; i < libraryBooks.length; i += batchSize) {
				const batch = libraryBooks.slice(i, i + batchSize);

				await Promise.all(
					batch.map(async (book) => {
						if (!booksData[book.hash]) {
							const config = await appService.loadBookConfig(book, settings);
							if (config) {
								setConfig(book.hash, config);
							}
						}
					}),
				);

				// Small delay between batches to allow UI updates
				if (i + batchSize < libraryBooks.length) {
					await new Promise((resolve) => setTimeout(resolve, 10));
				}
			}
		};

		loadBookConfigs();
	}, [libraryBooks, envConfig, settings, booksData, setConfig]);
};

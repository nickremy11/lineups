import { bindings, defineConfig } from "cf/config";

export default defineConfig({
	worker: {
		name: "lineups",
		compatibilityDate: "2025-11-01",
		entrypoint: "src/index.ts",
		observability: {
			enabled: true,
		},
		assets: {
			htmlHandling: "auto-trailing-slash",
			runWorkerFirst: [
				"/api/*",
			],
		},
		domains: [
			"lineups.bruisedbanana.dev",
		],
		env: {
			ASSETS: bindings.assets(),
		},
	},
});

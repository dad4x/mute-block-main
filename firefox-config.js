module.exports = {
	sourceDir: './firefox',
	artifactsDir: './firefox',
	lint: {
		output: 'text',
	},
	build: {
		overwriteDest: true,
	},
	run: {
		startUrl: ['https://www.google.com.pk'],
		firefox: 'deved',
	}
}
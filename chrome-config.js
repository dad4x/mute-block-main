module.exports = {
	sourceDir: './chrome',
	artifactsDir: './chrome',
	lint: {
		output: 'text'
	},
	build: {
		overwriteDest: true,
	},
	run: {
		// chromiumBinary: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		target: ['chromium'],
		startUrl: ['https://www.google.com.pk'],
	}
}
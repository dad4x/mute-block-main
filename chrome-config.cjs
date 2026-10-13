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
		chromiumBinary: '/usr/bin/google-chrome',
		target: ['chromium'],
		startUrl: ['https://www.google.com.pk'],
	}
}
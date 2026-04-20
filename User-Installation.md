# User Installation

These directions are for a non-technical user who wants to download the latest version from GitHub and install it in Chrome or Firefox.

This guide assumes:

- you have never used `Git` before
- you have never used `Node.js` before
- you have never used `npm` before

That is fine. You do not need to understand programming to follow these steps.

## What These Tools Are

You will use three tools:

- `Git`
  This downloads the project from GitHub and can later update it.
- `Node.js`
  This is a free program that lets your computer build the extension.
- `npm`
  This comes with Node.js. It downloads the helper files the project needs and runs the build command.

## What You Need

Before you start, install these two things on your computer:

1. `Git`
2. `Node.js` (which also gives you `npm`)

### Download Git

Go to:

- Windows or Mac: `https://git-scm.com/downloads`

Install it with the normal default options.

### Download Node.js

Go to:

- `https://nodejs.org/`

Install the `LTS` version.

Use the normal default options.

### Restart Your Terminal

After installing Git and Node.js:

- close any terminal or command window you already had open
- open a fresh one

This matters because old terminal windows may not notice the new programs yet.

### Check Whether They Installed Correctly

If you are not sure whether they are installed:

- on Windows, open `Command Prompt`
- on Mac, open `Terminal`
- on Linux, open `Terminal`

Then run:

```bash
git --version
node --version
npm --version
```

If those commands show version numbers, you are ready.

If one of them says `command not found` or similar, install that program first, then close and reopen the terminal and try again.

## Open A Terminal

You will run a few commands by typing them into a terminal.

### Windows

1. Press the `Windows` key.
2. Type `Command Prompt`
3. Open it.

### Mac

1. Press `Command + Space`
2. Type `Terminal`
3. Open it.

### Linux

Open your normal terminal program.

## Get The Latest Copy From GitHub

Pick a place where you want the project folder to live, such as your Desktop or Documents folder.

If you want, you can first move into your Desktop folder:

- Windows:

```bash
cd Desktop
```

- Mac or Linux:

```bash
cd ~/Desktop
```

Then run:

```bash
git clone https://github.com/dad4x/mute-block-main.git
cd mute-block-main
```

What these commands do:

- `git clone ...` downloads the project from GitHub
- `cd mute-block-main` moves you into that project folder

After that, your terminal should be inside the project folder.

If you already downloaded it before and just want the latest changes:

```bash
cd mute-block-main
git pull
```

What `git pull` does:

- it checks GitHub for changes
- it downloads the newest files into your existing project folder

## Build The Extension

Inside the `mute-block-main` folder, run:

```bash
npm install
npm run prod
```

What this does:

- `npm install` downloads the tools the project needs
- `npm run prod` builds the extension and creates fresh `chrome/` and `firefox/` folders

The first command may take a while the first time. That is normal.

When that finishes, you are ready to install.

## Important Folder Note

After the build finishes, you will have these important folders:

- `mute-block-main/chrome`
- `mute-block-main/firefox`

Those are the built extension folders.

Do not install from the top-level `mute-block-main` folder by mistake.

## Install In Chrome

These steps also work in Brave and other Chromium-based browsers.

1. Open Chrome.
2. Go to `chrome://extensions`
3. Turn on `Developer mode` in the top right.
4. Click `Load unpacked`.
5. Open the `mute-block-main` folder you downloaded from GitHub.
6. Select the `chrome` folder inside it.
7. Confirm.

The extension should now appear in your browser.

### To Update Chrome Later

When you want the newest version:

```bash
cd mute-block-main
git pull
npm run prod
```

Then go back to `chrome://extensions` and click the refresh icon for the extension, or reload the page.

## Install In Firefox

Firefox handles manual installs differently.

1. Open Firefox.
2. Go to `about:debugging`
3. Click `This Firefox`.
4. Click `Load Temporary Add-on`.
5. Open the `mute-block-main/firefox` folder.
6. Select the file `manifest.json`.

Firefox will load the extension temporarily.

### Important Firefox Note

This temporary install usually goes away when Firefox fully closes and reopens.

If that happens:

1. open `about:debugging`
2. go to `This Firefox`
3. load `mute-block-main/firefox/manifest.json` again

### To Update Firefox Later

Run:

```bash
cd mute-block-main
git pull
npm run prod
```

Then remove the temporary add-on in `about:debugging` and load the updated `firefox/manifest.json` again.

## If Something Goes Wrong

If `npm install` or `npm run prod` fails:

- make sure Git and Node.js were installed first
- make sure `node --version` and `npm --version` work
- make sure you are inside the `mute-block-main` folder
- try closing and reopening the terminal
- run `git pull` again in case your copy is old

If Chrome or Firefox says the extension is invalid:

- make sure you selected the built `chrome` or `firefox` folder
- do not select the repo root by mistake
- make sure `npm run prod` finished without errors before loading

If `git clone` fails:

- make sure Git was installed first
- close and reopen the terminal
- try the command again

If you want to start over completely:

1. delete the `mute-block-main` folder
2. repeat the steps from `Get The Latest Copy From GitHub`

# Contribution Guidelines

When contributing to `Readest`, whether on GitHub or in other community spaces:

- Be respectful, civil, and open-minded.
- Before opening a new pull request, try searching through the [issue tracker](https://github.com/readest/readest/issues) for known issues or fixes.
- If you want to make code changes based on your personal opinion(s), make sure you open an issue first describing the changes you want to make, and open a pull request only when your suggestions get approved by maintainers.

## How to Contribute

### Prerequisites

In order to not waste your time implementing a change that has already been declined, or is generally not needed, start by [opening an issue](https://github.com/readest/readest/issues/new/choose) describing the problem you would like to solve.

For the best experience to build Readest for yourself, use a recent version of Node.js and Rust. Refer to the [Tauri documentation](https://v2.tauri.app/start/prerequisites/) for details on setting up the development environment prerequisites on different platforms.

Basically you need to install or update the following development tools:

- **Node.js** and **pnpm** for Next.js development
- **Rust** and **Cargo** for Tauri development

```bash
nvm install v24
nvm use v24
npm install -g pnpm
rustup update
```

## Getting Started

To get started with Readest, follow these steps to clone and build the project.

### 1. Clone the Repository

```bash
git clone https://github.com/readest/readest.git
cd readest
```

### 2. Install Dependencies

```bash
# might need to rerun this when code is updated
git submodule update --init --recursive
pnpm install
# copy vendors dist libs to public directory
pnpm --filter @readest/readest-app setup-vendors
```

To confirm that all dependencies are correctly installed, run the following command:

```bash
pnpm tauri info
```

This command will display information about the installed Tauri dependencies and configuration on your platform. Note that the output may vary depending on the operating system and environment setup. Please review the output specific to your platform for any potential issues.

For Windows targets, “Build Tools for Visual Studio 2022” (or a higher edition of Visual Studio) and the “Desktop development with C++” workflow must be installed. For Windows ARM64 targets, the “VS 2022 C++ ARM64 build tools” and "C++ Clang Compiler for Windows" components must be installed. And make sure `clang` can be found in the path by adding `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\Llvm\x64\bin` for example in the environment variable `Path`.

#### Using Nix

If you have Nix installed, you can leverage the included flake to enter a
development shell to install and run all the necessary dependencies and commands:

```bash
nix develop ./ops  # enter a dev shell for the web app
nix develop ./ops#ios # enter a dev shell for the ios app
nix develop ./ops#android # enter a dev shell for the android app
```

### 4. Build for Development

```bash
# Start development for the Tauri app
pnpm tauri dev
# or start development for the Web app
pnpm dev-web
# preview with OpenNext build for the Web app
pnpm preview
```

#### Android

The following must be run once before running the Android app. Note that this is done automatically if using the nix Android devshell:

```bash
rm apps/readest-app/src-tauri/gen/android
pnpm tauri android init
pnpm tauri icon ../../data/icons/readest-book.png
git checkout apps/readest-app/src-tauri/gen/android
```

To run the Android app:

```bash
pnpm tauri android dev
# or if you want to dev on a real device
pnpm tauri android dev --host
```

#### iOS

```bash
# Set up the iOS environment (run once)
pnpm tauri ios init
pnpm tauri icon ../../data/icons/readest-book.png

pnpm tauri ios dev
# or if you want to dev on a real device
pnpm tauri ios dev --host
```

### 5. Build for Production

```bash
pnpm tauri build
pnpm tauri android build
pnpm tauri ios build
```

Please refer to our release script if you experience any issues:
https://github.com/readest/readest/blob/main/.github/workflows/release.yml


### 7. More information

Please check the [wiki][link-gh-wiki] of this project for more information on development.

Now you're all setup and can start implementing your changes.

## Implement your changes

This project is a monorepo. The code for the `readest-app` is in the `apps/readest-app` directory. Here are some useful scripts for developing the frontend only without compiling Tauri:

| Command          | Description                                        |
| ---------------- | -------------------------------------------------- |
| `pnpm dev-web`   | Starts the development server for the web app only |
| `pnpm build-web` | Builds the web app                                 |

### Editor-specific setup

#### VS Code

Upon opening the project, you will be prompted to install the following recommended extensions:

- JavaScript and TypeScript Nightly (`ms-vscode.vscode-typescript-next`)
- VS Code ESLint extension (`dbaeumer.vscode-eslint`)
- Biome - Code formatter and linter (`biomejs.biome`)
- rust-analyzer (`rust-lang.rust-analyzer`) (for Tauri development only)

#### Zed

The only extension needed is [biome-zed](https://github.com/biomejs/biome-zed), for code formatting and linting.

### When you're done

Check that your code follows the project's style guidelines by running:

```bash
pnpm build
```

Please also make a manual, functional test of your changes. When all that's done, it's time to file a pull request to upstream and fill out the title and body appropriately.

## Credits

This documented was inspired by the contributing guidelines for [cloudflare/wrangler2](https://github.com/cloudflare/wrangler2/blob/main/CONTRIBUTING.md).

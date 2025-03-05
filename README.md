# 3DS Max Render Queue Manager

An Electron application for managing 3ds Max rendering jobs. This application allows you to queue multiple 3ds Max files for sequential rendering, view command-line output, and manage rendering settings.

## Features

- **Drag & Drop Interface**: Easily add 3ds Max files to the render queue
- **File Selection Dialog**: Select multiple 3ds Max files from a dialog
- **Customizable Output Location**: Set your preferred output folder
- **Project Organization**: Group renders into project subfolders
- **Live Console Output**: View rendering progress and logs in real-time
- **Queue Management**: Reorder, add, or remove files in the queue
- **Auto-detection**: Automatically locates 3ds Max installation

## Prerequisites

- [Node.js](https://nodejs.org/) 
- [npm](https://www.npmjs.com/) 
- Windows operating system with 3ds Max installed

## Development Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/yourusername/3dsmax-queue-electron.git
   cd 3dsmax-queue-electron
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Run in development mode**

   This will start the application with developer tools enabled:

   ```bash
   npm run dev
   ```

4. **Building for production**

   To create a packaged application:

   ```bash
   npm run dist
   ```

   The packaged application will be available in the `dist` folder.

## Application Architecture

- **Hybrid Module System**: Uses ESM (ECMAScript Modules) in the main process and CommonJS in the preload script
- **Main Process** (`src/main.js`): Handles file system operations, dialog windows, and 3ds Max execution using ESM
- **Preload Script** (`src/preload.cjs`): Provides secure IPC bridge between main and renderer processes using CommonJS
- **Renderer Process** (`src/renderer/renderer.js`): Handles the UI and user interactions
- **Context Isolation**: Implements Electron's context isolation security pattern for enhanced security
- **Content Security Policy**: Implements secure CSP headers for renderer process

## Application Structure

- `index.js` - Entry point for the Electron application
- `src/main.js` - Main process code for Electron (ESM)
- `src/preload.cjs` - Bridge between main and renderer processes (CommonJS)
- `src/renderer/renderer.js` - Renderer process code for the UI
- `public/index.html` - Main HTML file for the application UI

## Module System Notes

The application uses a hybrid approach to modules:
- Main process (main.js) uses ESM (`import`/`export`)
- Preload script (preload.cjs) uses CommonJS (`require`) for better compatibility
- Renderer process uses exposed APIs through the preload script's context bridge
- Package.json is configured with `"type": "module"` to enable ESM by default

## Using the Application

1. **Adding Files**:
   - Drag and drop 3ds Max (.max) files onto the drop zone
   - Or click "Select Files" to choose files from a dialog

2. **Managing the Queue**:
   - Reorder files by dragging them in the queue
   - Remove files using the "Remove" button
   - Clear the entire queue with "Clear Queue"

3. **Project Organization**:
   - Enter a project name to group renders in a subfolder
   - Leave blank to output directly to the main output folder

4. **Rendering**:
   - Click "Start Rendering" to process the queue
   - Monitor progress in the "Output" tab
   - Files are rendered sequentially

5. **Settings**:
   - Set your output folder in the "Settings" tab
   - The application will auto-detect 3ds Max, but you can override it if needed

## Command Line Rendering

This application uses 3ds Max's command-line rendering capabilities via `3dsmaxcmd.exe`. The command line syntax we use is:

```
3dsmaxcmd.exe file.max -silent -outputName:"C:/path/to/output.jpg" -v:5
```

Where:
- `-silent`: Runs the render without showing a progress dialog
- `-outputName`: Specifies the output file path
- `-v:5`: Sets the verbose level for detailed logging

## Troubleshooting

- **3ds Max Not Found**: Ensure 3ds Max is properly installed. If auto-detection fails, manually set the path to 3dsmaxcmd.exe in settings.
- **Permission Errors**: Ensure the output folder has write permissions
- **Module System Issues**: The application uses ESM in the main process and CommonJS in the preload script. If you encounter module-related errors, check that you're using the correct import system for each file type.
- **Preload Script Issues**: If the renderer can't access Node.js modules, ensure the preload script (preload.cjs) is properly loaded and the context bridge is working.
- **Content Security Policy**: If you see CSP warnings in development, this is normal. The CSP is configured to allow necessary resources while maintaining security.

## Security Features

- **Context Isolation**: Prevents direct access to Node.js and Electron APIs from the renderer process
- **Content Security Policy**: Restricts resource loading and script execution to enhance security
- **Secure IPC**: All communication between renderer and main processes goes through a controlled bridge
- **Sandboxing**: Preload script runs with limited privileges for enhanced security

## License

ISC

## Contributing

Contributions welcome! Please feel free to submit a Pull Request. When contributing, note the hybrid module system and maintain the security patterns in place.
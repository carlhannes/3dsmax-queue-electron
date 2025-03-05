import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import Store from 'electron-store';
import os from 'os';

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create a promisified version of execFile for async usage
const execFileAsync = promisify(execFile);

// Initialize store for settings
const store = new Store({
  name: '3ds-max-queue-config',
  defaults: {
    outputFolder: path.join(os.homedir(), 'Documents', 'Renders'),
    maxPath: '' // Will be auto-detected if empty
  }
});

let mainWindow;
let renderProcesses = {};

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.cjs')
    },
  });

  // Set CSP header
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self' https: 'unsafe-inline'"]
      }
    });
  });

  // Load the index.html file
  await mainWindow.loadFile(path.join(__dirname, '../public/index.html'));

  // Open DevTools in development environment
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

// Detect 3ds Max installation path
async function detect3dsMaxPath() {
  let maxPath = store.get('maxPath');
  
  if (!maxPath) {
    // Common installation directories for 3ds Max on Windows
    const programFiles = process.env['ProgramFiles'];
    const programFilesX86 = process.env['ProgramFiles(x86)'];
    
    const possiblePaths = [
      programFiles,
      programFilesX86
    ].filter(Boolean);
    
    // Check for Autodesk directories
    for (const basePath of possiblePaths) {
      const autodeskPath = path.join(basePath, 'Autodesk');
      
      try {
        if (fs.existsSync(autodeskPath)) {
          const dirs = fs.readdirSync(autodeskPath);
          for (const dir of dirs) {
            if (dir.includes('3ds Max')) {
              const candidatePath = path.join(autodeskPath, dir);
              const cmdPath = path.join(candidatePath, '3dsmaxcmd.exe');
              
              if (fs.existsSync(cmdPath)) {
                maxPath = cmdPath;
                store.set('maxPath', maxPath);
                return maxPath;
              }
            }
          }
        }
      } catch (error) {
        console.error('Error detecting 3ds Max:', error);
      }
    }
  }
  
  return maxPath;
}

// Set up all IPC handlers
function setupIpcHandlers() {
  // Handle file drops and selections
  ipcMain.handle('select-files', async () => {
    console.log('Select files dialog requested');
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '3ds Max Files', extensions: ['max'] }
        ]
      });
      
      console.log('Dialog result:', { canceled, filePaths });
      if (!canceled) {
        return filePaths;
      }
      return [];
    } catch (error) {
      console.error('Error showing file dialog:', error);
      return [];
    }
  });

  // Handle folder selection for output
  ipcMain.handle('select-output-folder', async () => {
    console.log('Select output folder dialog requested');
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory'],
      });
      
      console.log('Dialog result:', { canceled, filePaths });
      if (!canceled && filePaths.length > 0) {
        store.set('outputFolder', filePaths[0]);
        return filePaths[0];
      }
      return store.get('outputFolder');
    } catch (error) {
      console.error('Error showing folder dialog:', error);
      return store.get('outputFolder');
    }
  });

  // Get settings from store
  ipcMain.handle('get-settings', async () => {
    console.log('Settings requested from renderer');
    const settings = {
      outputFolder: store.get('outputFolder'),
      maxPath: await detect3dsMaxPath()
    };
    console.log('Returning settings:', settings);
    return settings;
  });

  // Save settings to store
  ipcMain.handle('save-settings', async (event, settings) => {
    console.log('Saving settings:', settings);
    store.set('outputFolder', settings.outputFolder);
    if (settings.maxPath) {
      store.set('maxPath', settings.maxPath);
    }
    return true;
  });

  // Render a single file
  ipcMain.handle('render-file', async (event, { file, outputName, projectName }) => {
    const maxPath = await detect3dsMaxPath();
    if (!maxPath) {
      throw new Error('3ds Max path not found. Please set it in the settings.');
    }
    
    const outputFolder = store.get('outputFolder');
    const projectFolder = projectName ? path.join(outputFolder, projectName) : outputFolder;
    
    // Create output directory if it doesn't exist
    if (!fs.existsSync(projectFolder)) {
      fs.mkdirSync(projectFolder, { recursive: true });
    }
    
    // Build the output path - use file basename if outputName not provided
    const baseFileName = path.basename(file, '.max');
    const outputFileName = outputName || `${baseFileName}.jpg`;
    const outputPath = path.join(projectFolder, outputFileName);

    // Prepare command line arguments
    const args = [
      file,
      '-silent',
      '-outputName:' + outputPath,
      '-v:5' // Verbose output
    ];
    
    // Create a unique ID for this render process
    const processId = Date.now().toString();
    
    try {
      // Start the render process
      const process = execFile(maxPath, args);
      renderProcesses[processId] = process;
      
      // Send output to the renderer
      process.stdout.on('data', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('render-output', { id: processId, output: data.toString() });
        }
      });
      
      process.stderr.on('data', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('render-output', { id: processId, output: data.toString(), error: true });
        }
      });
      
      // Return the process ID to track this render job
      return { id: processId, file, outputPath };
    } catch (error) {
      console.error('Error starting render:', error);
      throw error;
    }
  });

  // Get all current render processes
  ipcMain.handle('get-render-processes', () => {
    return Object.keys(renderProcesses).map(id => ({ id }));
  });

  // Cancel a render process
  ipcMain.handle('cancel-render', (event, id) => {
    if (renderProcesses[id]) {
      renderProcesses[id].kill();
      delete renderProcesses[id];
      return true;
    }
    return false;
  });

  // Open the output folder
  ipcMain.handle('open-output-folder', async (event, customPath) => {
    console.log('Opening output folder');
    const folderPath = customPath || store.get('outputFolder');
    console.log('Folder path:', folderPath);
    if (folderPath) {
      try {
        await shell.openPath(folderPath);
        return true;
      } catch (error) {
        console.error('Error opening folder:', error);
        return false;
      }
    }
    return false;
  });
}

// Initialize application
async function init() {
  try {
    // Set up all IPC handlers
    setupIpcHandlers();
    
    // Create the main window
    await createWindow();
    
    // Detect 3ds Max path
    const maxPath = await detect3dsMaxPath();
    console.log('3ds Max path detected:', maxPath || 'Not found');
  } catch (error) {
    console.error('Error during initialization:', error);
  }
}

// Application lifecycle events
app.whenReady().then(init);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Clean up before quitting
app.on('before-quit', () => {
  // Kill any running render processes
  Object.values(renderProcesses).forEach(process => {
    process.kill();
  });
});
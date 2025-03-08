import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { execFile, spawn } from 'child_process'; // Add spawn import
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
    const programFiles = process.env['ProgramFiles'];
    const programFilesX86 = process.env['ProgramFiles(x86)'];
    
    const possiblePaths = [programFiles, programFilesX86].filter(Boolean);
    
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

// Set up IPC handlers
function setupIpcHandlers() {
  ipcMain.handle('select-files', async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '3ds Max Files', extensions: ['max'] }]
      });
      return !canceled ? filePaths : [];
    } catch (error) {
      console.error('Error selecting files:', error);
      return [];
    }
  });

  ipcMain.handle('select-output-folder', async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory'],
      });
      if (!canceled && filePaths.length > 0) {
        store.set('outputFolder', filePaths[0]);
        return filePaths[0];
      }
      return store.get('outputFolder');
    } catch (error) {
      console.error('Error selecting folder:', error);
      return store.get('outputFolder');
    }
  });

  ipcMain.handle('get-settings', async () => {
    return {
      outputFolder: store.get('outputFolder'),
      maxPath: await detect3dsMaxPath()
    };
  });

  ipcMain.handle('save-settings', async (event, settings) => {
    store.set('outputFolder', settings.outputFolder);
    if (settings.maxPath) store.set('maxPath', settings.maxPath);
    return true;
  });

  ipcMain.handle('render-file', async (event, { file, outputName, projectName }) => {
    const maxPath = await detect3dsMaxPath();
    if (!maxPath) throw new Error('3ds Max path not found. Please set it in the settings.');

    const outputFolder = store.get('outputFolder');
    const projectFolder = projectName ? path.join(outputFolder, projectName) : outputFolder;
    
    if (!fs.existsSync(projectFolder)) {
      fs.mkdirSync(projectFolder, { recursive: true });
    }

    const baseFileName = path.basename(file, '.max');
    const outputFileName = outputName || `${baseFileName}.jpg`;
    const outputPath = path.join(projectFolder, outputFileName);

    // Fix batch file syntax - escape properly and use correct CMD syntax
    const sessionLogPath = path.join(projectFolder, `maxrender_log_${Date.now()}.txt`);
    const batchFile = path.join(projectFolder, `max_render_${Date.now()}.bat`);
    
    // Create batch content with proper CMD syntax and line endings
    const batchContent = `@echo off\r\n
:: Set code page to UTF-8\r\n
chcp 65001 > nul\r\n

:: Set environment variables for optimal rendering\r\n
set "ADSK_3DSMAX_BUFFEREDFILE_BUFFERSIZE=262144"\r\n
set "ADSK_3DSMAX_SESSION_LOG=${sessionLogPath.replace(/\\/g, '\\\\')}"\r\n

:: Execute 3ds Max
"${maxPath}" "${file}" -outputName:"${outputPath}" -v:5 -stillFrame -gammaCorrection:1\r\n
exit %ERRORLEVEL%`;
    
    // Write the batch file with Windows line endings
    fs.writeFileSync(batchFile, batchContent.replace(/\r\n/g, '\r\n'), { encoding: 'utf8' });

    const processId = Date.now().toString();
    
    try {
      // Execute the batch file with proper encoding
      const process = spawn(batchFile, [], { 
        encoding: 'utf8',
        shell: true,
        windowsVerbatimArguments: true
      });
      
      renderProcesses[processId] = process;
      
      // Enhanced output handling with explicit UTF-8 encoding
      process.stdout.on('data', (data) => {
        if (mainWindow) {
          // Convert buffer to string with explicit UTF-8 encoding and normalize text
          const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
          const output = buffer.toString('utf8').trim();
          
          if (output) { // Only send non-empty output
            // Replace any problematic characters
            const cleanOutput = output
              .replace(/\uFFFD/g, '?') // Replace replacement character with question mark
              .replace(/[^\x20-\x7E\u00A0-\u00FF\u0100-\u017F\u0180-\u024F\u2022\u2013\u2014\u2018\u2019\u201C\u201D\u2026\u2032\u2033]/g, '·'); // Replace other unusual chars with dots
              
            mainWindow.webContents.send('render-output', { id: processId, output: cleanOutput });
          }
        }
      });
      
      process.stderr.on('data', (data) => {
        if (mainWindow) {
          // Same encoding handling for stderr
          const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
          const output = buffer.toString('utf8').trim();
          
          if (output) {
            // Replace any problematic characters
            const cleanOutput = output
              .replace(/\uFFFD/g, '?')
              .replace(/[^\x20-\x7E\u00A0-\u00FF\u0100-\u017F\u0180-\u024F\u2022\u2013\u2014\u2018\u2019\u201C\u201D\u2026\u2032\u2033]/g, '·');
              
            mainWindow.webContents.send('render-output', { id: processId, output: cleanOutput, error: true });
          }
        }
      });

      // Add completion handling
      process.on('exit', (code) => {
        // Check if session log exists and read it for additional info
        try {
          if (fs.existsSync(sessionLogPath)) {
            const logContent = fs.readFileSync(sessionLogPath, 'utf8');
            if (logContent && mainWindow) {
              mainWindow.webContents.send('render-output', { 
                id: processId, 
                output: 'Session log: ' + logContent
              });
            }
            // Clean up session log
            //fs.unlinkSync(sessionLogPath);
          }
        } catch (err) {
          console.error('Error processing session log:', err);
        }

        // Clean up the batch file
        try {
          //fs.unlinkSync(batchFile);
        } catch (err) {
          console.error('Error cleaning up batch file:', err);
        }
        
        // Send completion message based on exit code
        if (mainWindow) {
          const status = code === 0 ? 'Rendering completed successfully' : `Rendering process exited with code ${code}`;
          mainWindow.webContents.send('render-output', { 
            id: processId, 
            output: status,
            error: code !== 0
          });
        }
      });

      return { id: processId, file, outputPath };
    } catch (error) {
      console.error('Error starting render:', error);
      // Clean up the batch file if there's an error
      try {
        fs.unlinkSync(batchFile);
      } catch (err) {
        console.error('Error cleaning up batch file after error:', err);
      }
      throw error;
    }
  });

  ipcMain.handle('get-render-processes', () => {
    return Object.keys(renderProcesses).map(id => ({ id }));
  });

  ipcMain.handle('cancel-render', (event, id) => {
    if (renderProcesses[id]) {
      renderProcesses[id].kill();
      delete renderProcesses[id];
      return true;
    }
    return false;
  });

  ipcMain.handle('open-output-folder', async (event, customPath) => {
    const folderPath = customPath || store.get('outputFolder');
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
    setupIpcHandlers();
    await createWindow();
    const maxPath = await detect3dsMaxPath();
    console.log('3ds Max path detected:', maxPath || 'Not found');
  } catch (error) {
    console.error('Error during initialization:', error);
  }
}

// Application lifecycle events
app.whenReady().then(init);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  Object.values(renderProcesses).forEach(process => process.kill());
});

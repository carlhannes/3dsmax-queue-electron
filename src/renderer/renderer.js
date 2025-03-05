// Using the exposed API from the preload script instead of require
console.log('Renderer process started');

// Queue of files to render
let renderQueue = [];
let currentRenderIndex = -1;
let isRendering = false;

// Wait for DOM to be ready before accessing elements
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM fully loaded');
  
  // DOM elements
  const dropZone = document.getElementById('drop-zone');
  const fileList = document.getElementById('file-list');
  const emptyQueueMessage = document.getElementById('empty-queue');
  const selectFilesBtn = document.getElementById('select-files-btn');
  const renderBtn = document.getElementById('render-btn');
  const clearQueueBtn = document.getElementById('clear-queue-btn');
  const projectNameInput = document.getElementById('project-name');
  const consoleOutput = document.getElementById('console-output');
  const clearOutputBtn = document.getElementById('clear-output-btn');
  const openOutputFolderBtn = document.getElementById('open-output-folder-btn');
  const outputFolderInput = document.getElementById('output-folder');
  const maxPathInput = document.getElementById('max-path');
  const selectOutputFolderBtn = document.getElementById('select-output-folder-btn');
  const selectMaxPathBtn = document.getElementById('select-max-path-btn');
  const saveSettingsBtn = document.getElementById('save-settings-btn');

  // Add a message to the console output
  function addConsoleMessage(message, type = 'info') {
    console.log(`Console message (${type}):`, message);
    const messageElement = document.createElement('div');
    
    // Add timestamp
    const timestamp = new Date().toLocaleTimeString();
    
    let className = '';
    if (type === 'error') className = 'error-text';
    if (type === 'warning') className = 'text-warning';
    if (type === 'success') className = 'text-success';
    
    messageElement.className = className;
    messageElement.textContent = `[${timestamp}] ${message}`;
    
    consoleOutput.appendChild(messageElement);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
  }

  // Initialize settings
  async function initSettings() {
    try {
      addConsoleMessage('Loading settings...', 'info');
      console.log('Requesting settings from main process');
      const settings = await window.api.getSettings();
      console.log('Received settings:', settings);
      
      outputFolderInput.value = settings.outputFolder || '';
      maxPathInput.value = settings.maxPath || 'Auto-detected';
      
      if (!settings.maxPath) {
        addConsoleMessage('3ds Max path will be auto-detected', 'info');
      } else {
        addConsoleMessage(`3ds Max path: ${settings.maxPath}`, 'info');
      }
      
      addConsoleMessage(`Output folder: ${settings.outputFolder}`, 'info');
    } catch (error) {
      console.error('Error loading settings:', error);
      addConsoleMessage('Failed to load settings: ' + error.message, 'error');
    }
  }

  // Initialize the sortable file list
  function initSortable() {
    console.log('Initializing sortable list');
    // We'll use the globally loaded Sortable library from the CDN
    if (typeof Sortable !== 'undefined') {
      Sortable.create(fileList, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        handle: '.drag-handle',
        onEnd: function() {
          // Update the renderQueue array to match the new order in the DOM
          const items = Array.from(fileList.querySelectorAll('.file-list-item'));
          renderQueue = items.map(item => {
            const id = item.dataset.id;
            return renderQueue.find(file => file.id === id);
          });
        }
      });
    } else {
      console.error('Sortable library not found');
      addConsoleMessage('Error: Sortable library not loaded', 'error');
    }
  }

  // Add files to the queue
  function addFilesToQueue(files) {
    console.log('Adding files to queue:', files);
    if (!files || files.length === 0) return;
    
    const newFiles = files.filter(file => {
      // Check if the file is a .max file
      if (!file.toLowerCase().endsWith('.max')) {
        addConsoleMessage(`Skipping non-3ds Max file: ${file}`, 'warning');
        return false;
      }
      
      // Check if the file already exists in the queue
      if (renderQueue.some(item => item.path === file)) {
        addConsoleMessage(`File already in queue: ${file}`, 'warning');
        return false;
      }
      
      return true;
    });
    
    if (newFiles.length === 0) return;
    
    // Add new files to the queue
    newFiles.forEach(file => {
      const fileObj = {
        id: window.api.uuidv4(),
        path: file,
        name: window.api.path.basename(file),
        status: 'pending'
      };
      
      renderQueue.push(fileObj);
    });
    
    updateFileList();
    updateButtons();
    
    addConsoleMessage(`Added ${newFiles.length} file(s) to the queue.`);
  }

  // Update the file list in the UI
  function updateFileList() {
    console.log('Updating file list UI');
    // Remove the empty queue message if we have files
    if (renderQueue.length > 0) {
      emptyQueueMessage.style.display = 'none';
    } else {
      emptyQueueMessage.style.display = 'block';
    }
    
    // Clear existing file items (but keep the empty queue message)
    Array.from(fileList.querySelectorAll('.file-list-item')).forEach(item => {
      fileList.removeChild(item);
    });
    
    // Add files to the list
    renderQueue.forEach(file => {
      const item = document.createElement('div');
      item.className = 'file-list-item render-queue-item';
      item.dataset.id = file.id;
      
      const statusClass = getStatusClass(file.status);
      
      item.innerHTML = `
        <div class="drag-handle">⠿</div>
        <div class="file-name">${file.name}</div>
        <span class="badge ${statusClass}">${file.status}</span>
        <button class="btn btn-sm btn-outline-danger remove-file-btn ms-2">Remove</button>
      `;
      
      const removeBtn = item.querySelector('.remove-file-btn');
      removeBtn.addEventListener('click', () => {
        removeFileFromQueue(file.id);
      });
      
      fileList.appendChild(item);
    });
  }

  // Get the Bootstrap class for status badges
  function getStatusClass(status) {
    switch (status) {
      case 'pending': return 'bg-secondary';
      case 'rendering': return 'bg-primary';
      case 'completed': return 'bg-success';
      case 'failed': return 'bg-danger';
      case 'canceled': return 'bg-warning';
      default: return 'bg-secondary';
    }
  }

  // Remove a file from the queue
  function removeFileFromQueue(id) {
    console.log('Removing file from queue:', id);
    // Don't allow removal during rendering
    if (isRendering) {
      addConsoleMessage('Cannot remove files while rendering is in progress.', 'warning');
      return;
    }
    
    const index = renderQueue.findIndex(file => file.id === id);
    if (index !== -1) {
      const removedFile = renderQueue[index];
      renderQueue.splice(index, 1);
      updateFileList();
      updateButtons();
      addConsoleMessage(`Removed ${removedFile.name} from the queue.`);
    }
  }

  // Update button states
  function updateButtons() {
    console.log('Updating button states');
    renderBtn.disabled = renderQueue.length === 0 || isRendering;
    clearQueueBtn.disabled = renderQueue.length === 0 || isRendering;
  }

  // Start the rendering process
  async function startRendering() {
    console.log('Starting rendering process');
    if (renderQueue.length === 0 || isRendering) return;
    
    isRendering = true;
    currentRenderIndex = 0;
    updateButtons();
    
    addConsoleMessage('Starting render queue...', 'info');
    
    // Get project name for subfolder
    const projectName = projectNameInput.value.trim();
    
    try {
      await renderNext(projectName);
    } catch (error) {
      console.error('Error starting render:', error);
      addConsoleMessage(`Render error: ${error.message}`, 'error');
      
      isRendering = false;
      currentRenderIndex = -1;
      updateButtons();
    }
  }

  // Render the next file in the queue
  async function renderNext(projectName) {
    console.log('Rendering next file, index:', currentRenderIndex);
    if (currentRenderIndex >= renderQueue.length) {
      // All files have been rendered
      addConsoleMessage('All renders completed!', 'success');
      isRendering = false;
      currentRenderIndex = -1;
      updateButtons();
      return;
    }
    
    const file = renderQueue[currentRenderIndex];
    
    // Update UI to show the current file is rendering
    file.status = 'rendering';
    updateFileList();
    
    addConsoleMessage(`Rendering [${currentRenderIndex + 1}/${renderQueue.length}]: ${file.name}`, 'info');
    
    try {
      // Start rendering the file using our preload API
      const result = await window.api.renderFile({
        file: file.path,
        projectName: projectName
      });
      
      // Store the process ID
      file.processId = result.id;
      file.outputPath = result.outputPath;
      
      // The render process will continue in the background
      // Render output will be received via the render-output event handler
      
    } catch (error) {
      console.error('Render error:', error);
      file.status = 'failed';
      updateFileList();
      
      addConsoleMessage(`Failed to render ${file.name}: ${error.message}`, 'error');
      
      // Continue with the next file
      currentRenderIndex++;
      await renderNext(projectName);
    }
  }

  // Clear the console output
  function clearConsole() {
    console.log('Clearing console output');
    consoleOutput.innerHTML = '';
    addConsoleMessage('Console cleared.');
  }

  // Initialize the application
  initSettings();
  
  // File drop zone event listeners
  console.log('Setting up drop zone event listeners');
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('active');
  });
  
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('active');
  });
  
  dropZone.addEventListener('drop', (e) => {
    console.log('Files dropped');
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('active');
    
    // Get dropped files
    if (e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files)
        .map(file => file.path);
      
      addFilesToQueue(files);
    }
  });
  
  // Button event listeners
  console.log('Setting up button event listeners');
  
  selectFilesBtn.addEventListener('click', async () => {
    console.log('Select files button clicked');
    try {
      const files = await window.api.selectFiles();
      console.log('Files selected:', files);
      addFilesToQueue(files);
    } catch (error) {
      console.error('Error selecting files:', error);
      addConsoleMessage(`Error selecting files: ${error.message}`, 'error');
    }
  });
  
  renderBtn.addEventListener('click', () => {
    console.log('Render button clicked');
    startRendering();
  });
  
  clearQueueBtn.addEventListener('click', () => {
    console.log('Clear queue button clicked');
    renderQueue = [];
    updateFileList();
    updateButtons();
    addConsoleMessage('Queue cleared.');
  });
  
  clearOutputBtn.addEventListener('click', () => {
    console.log('Clear output button clicked');
    clearConsole();
  });
  
  openOutputFolderBtn.addEventListener('click', async () => {
    console.log('Open output folder button clicked');
    try {
      const result = await window.api.openOutputFolder();
      console.log('Open output folder result:', result);
      if (!result) {
        addConsoleMessage('Failed to open output folder.', 'error');
      }
    } catch (error) {
      console.error('Error opening output folder:', error);
      addConsoleMessage(`Error opening output folder: ${error.message}`, 'error');
    }
  });
  
  selectOutputFolderBtn.addEventListener('click', async () => {
    console.log('Select output folder button clicked');
    try {
      const folder = await window.api.selectOutputFolder();
      console.log('Output folder selected:', folder);
      outputFolderInput.value = folder;
      addConsoleMessage(`Output folder set to: ${folder}`, 'info');
    } catch (error) {
      console.error('Error selecting output folder:', error);
      addConsoleMessage(`Error selecting output folder: ${error.message}`, 'error');
    }
  });
  
  saveSettingsBtn.addEventListener('click', async () => {
    console.log('Save settings button clicked');
    try {
      const settings = {
        outputFolder: outputFolderInput.value,
        maxPath: maxPathInput.value !== 'Auto-detected' ? maxPathInput.value : ''
      };
      
      await window.api.saveSettings(settings);
      addConsoleMessage('Settings saved.', 'success');
    } catch (error) {
      console.error('Error saving settings:', error);
      addConsoleMessage(`Error saving settings: ${error.message}`, 'error');
    }
  });

  // Set up event listeners for render output
  console.log('Setting up render output event listeners');
  
  // Register the event handler for render output
  window.api.onRenderOutput((data) => {
    // Find the file with the matching process ID
    const file = renderQueue.find(f => f.processId === data.id);
    
    // Add the output to the console
    if (data.error) {
      addConsoleMessage(`[${file ? file.name : 'Unknown'}] ${data.output}`, 'error');
    } else {
      addConsoleMessage(`[${file ? file.name : 'Unknown'}] ${data.output}`);
    }
    
    // Check if the render has completed
    if (data.output.includes('Rendering completed') || data.output.includes('successfully rendered')) {
      if (file) {
        file.status = 'completed';
        updateFileList();
        
        // Move to the next file
        currentRenderIndex++;
        renderNext(projectNameInput.value.trim());
      }
    }
    
    // Check for errors
    if (data.error && data.output.includes('Error')) {
      if (file) {
        file.status = 'failed';
        updateFileList();
        
        // Move to the next file
        currentRenderIndex++;
        renderNext(projectNameInput.value.trim());
      }
    }
  });

  // Initialize Sortable after everything else
  if (typeof Sortable !== 'undefined') {
    initSortable();
  } else {
    // Wait a bit in case Sortable is loaded asynchronously
    setTimeout(() => {
      if (typeof Sortable !== 'undefined') {
        initSortable();
      } else {
        console.error('Sortable library not available after delay');
      }
    }, 500);
  }

  // Log that we're ready
  console.log('Renderer initialization complete');
  addConsoleMessage('Application initialized and ready', 'info');
});
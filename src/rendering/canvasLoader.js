// Canvas loader state
let loaderCanvas = null;
let canvas2DContext = null;
let loaderAnimationId = null;
let isShowingLoader = false;

/**
 * Starts the canvas loading animation by creating an overlay canvas
 * @param {HTMLCanvasElement} mainCanvas - The main canvas element to overlay
 */
export function startCanvasLoader(mainCanvas) {
    if (isShowingLoader) return;
    
    isShowingLoader = true;
    
    // Create a separate canvas element for the loader overlay
    loaderCanvas = document.createElement('canvas');
    loaderCanvas.style.position = 'absolute';
    loaderCanvas.style.top = '0';
    loaderCanvas.style.left = '0';
    loaderCanvas.style.width = '100%';
    loaderCanvas.style.height = '100%';
    loaderCanvas.style.pointerEvents = 'none';
    loaderCanvas.style.zIndex = '1000';
    
    // Set canvas size to match main canvas
    const rect = mainCanvas.getBoundingClientRect();
    loaderCanvas.width = rect.width;
    loaderCanvas.height = rect.height;
    
    // Add the loader canvas to the main canvas's parent
    mainCanvas.parentElement.style.position = 'relative';
    mainCanvas.parentElement.appendChild(loaderCanvas);
    
    canvas2DContext = loaderCanvas.getContext('2d');
    
    function animateLoader() {
        if (!isShowingLoader || !canvas2DContext || !loaderCanvas) return;
        
        const ctx = canvas2DContext;
        const width = loaderCanvas.width;
        const height = loaderCanvas.height;
        
        // Clear canvas with dark background
        ctx.fillStyle = '#1a1a1a'; // Match Config.BACKGROUND_COLOR
        ctx.fillRect(0, 0, width, height);
        
        // Calculate center and animation parameters
        const centerX = width / 2;
        const centerY = height / 2;
        const time = performance.now() * 0.002; // Slower rotation
        const radius = Math.min(width, height) * 0.1;
        const dotSize = Math.min(width, height) * 0.01;
        
        // Draw rotating dots
        const numDots = 8;
        for (let i = 0; i < numDots; i++) {
            const angle = (i / numDots) * Math.PI * 2 + time;
            const dotX = centerX + Math.cos(angle) * radius;
            const dotY = centerY + Math.sin(angle) * radius;
            
            // Fade dots based on position for trailing effect
            const alpha = 0.3 + 0.7 * (Math.sin(angle - time) + 1) / 2;
            
            ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.beginPath();
            ctx.arc(dotX, dotY, dotSize, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Draw "Initializing..." text
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.font = `${Math.min(width, height) * 0.03}px Arial`;
        ctx.textAlign = 'center';
        ctx.fillText('Initializing...', centerX, centerY + radius + 40);
        
        loaderAnimationId = requestAnimationFrame(animateLoader);
    }
    
    animateLoader();
}

/**
 * Stops the canvas loading animation and removes the overlay canvas
 */
export function stopCanvasLoader() {
    isShowingLoader = false;
    if (loaderAnimationId) {
        cancelAnimationFrame(loaderAnimationId);
        loaderAnimationId = null;
    }
    
    // Remove the loader canvas element
    if (loaderCanvas && loaderCanvas.parentElement) {
        loaderCanvas.parentElement.removeChild(loaderCanvas);
    }
    
    loaderCanvas = null;
    canvas2DContext = null;
}

/**
 * Handles resizing of the loader canvas to match the main canvas
 * @param {HTMLCanvasElement} mainCanvas - The main canvas element to match
 */
export function handleLoaderResize(mainCanvas) {
    if (isShowingLoader && loaderCanvas && canvas2DContext && mainCanvas) {
        const rect = mainCanvas.getBoundingClientRect();
        loaderCanvas.width = rect.width;
        loaderCanvas.height = rect.height;
    }
}

/**
 * Returns whether the loader is currently showing
 * @returns {boolean} True if loader is active
 */
export function isLoaderActive() {
    return isShowingLoader;
} 
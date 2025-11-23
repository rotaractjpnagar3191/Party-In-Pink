// public/utils.js - Phase 2 UI/UX Utilities
// Shared utilities for form validation, notifications, and UX enhancements

/**
 * Show Toast Notification
 * @param {string} message - Notification message
 * @param {string} type - Type: 'success', 'error', 'info' (default: 'info')
 * @param {number} duration - Display duration in ms (default: 4000)
 */
function showToast(message, type = 'info', duration = 4000) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.setAttribute('role', 'alert');
  
  document.body.appendChild(toast);
  
  // Trigger show animation
  setTimeout(() => {
    toast.classList.add('show');
  }, 10);
  
  // Remove after duration
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/**
 * Copy text to clipboard with visual feedback
 * @param {string} text - Text to copy
 * @param {HTMLElement} button - Button element to show feedback on
 */
async function copyToClipboard(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    
    // Show feedback
    const originalText = button.textContent;
    button.textContent = '✓ Copied!';
    button.classList.add('copied');
    
    // Reset after 2 seconds
    setTimeout(() => {
      button.textContent = originalText;
      button.classList.remove('copied');
    }, 2000);
    
    showToast('Copied to clipboard!', 'success');
  } catch (err) {
    console.error('Copy to clipboard failed:', err);
    showToast('Failed to copy', 'error');
  }
}

/**
 * Setup copy button
 * @param {string} buttonId - ID of copy button
 * @param {string} textToCopy - Text to copy when clicked
 */
function setupCopyButton(buttonId, textToCopy) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  
  btn.addEventListener('click', async () => {
    await copyToClipboard(textToCopy, btn);
  });
}

/**
 * Capture UTM parameters from URL
 * @returns {Object} UTM parameters object
 */
function captureUTMParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    utm_source: params.get('utm_source') || 'direct',
    utm_medium: params.get('utm_medium') || null,
    utm_campaign: params.get('utm_campaign') || null,
    utm_content: params.get('utm_content') || null,
    utm_term: params.get('utm_term') || null,
    referrer: document.referrer || null
  };
}

/**
 * Set up form with real-time validation
 * @param {HTMLFormElement} form - Form element
 * @param {Object} validationRules - Rules for each field
 */
function setupFormValidation(form, validationRules = {}) {
  if (!form) return;
  
  const inputs = form.querySelectorAll('input, textarea, select');
  
  inputs.forEach(input => {
    // Add validation feedback element if not present
    if (!input.nextElementSibling?.classList.contains('validation-feedback')) {
      const feedback = document.createElement('div');
      feedback.className = 'validation-feedback error';
      feedback.setAttribute('role', 'alert');
      feedback.setAttribute('hidden', 'true');
      
      const successFeedback = document.createElement('div');
      successFeedback.className = 'validation-feedback success';
      successFeedback.setAttribute('hidden', 'true');
      
      input.parentNode.insertBefore(successFeedback, input.nextSibling);
      input.parentNode.insertBefore(feedback, input.nextSibling);
    }
    
    // Validate on input
    input.addEventListener('input', () => {
      validateField(input);
    });
    
    // Validate on blur
    input.addEventListener('blur', () => {
      validateField(input);
    });
  });
  
  // Handle form submission
  form.addEventListener('submit', (e) => {
    let isValid = true;
    inputs.forEach(input => {
      if (!validateField(input)) {
        isValid = false;
      }
    });
    
    if (!isValid) {
      e.preventDefault();
      showToast('Please fix the errors in the form', 'error');
    }
  });
}

/**
 * Validate single field
 * @param {HTMLElement} field - Input field to validate
 * @returns {boolean} True if valid
 */
function validateField(field) {
  if (!field.checkValidity && field.type !== 'text') {
    return true; // Skip non-input fields
  }
  
  const isValid = field.checkValidity();
  const feedbackElements = field.parentNode?.querySelectorAll('.validation-feedback');
  
  if (feedbackElements) {
    feedbackElements.forEach(fb => {
      if (fb.classList.contains('error')) {
        fb.setAttribute('hidden', isValid ? 'true' : 'false');
      } else if (fb.classList.contains('success')) {
        fb.setAttribute('hidden', isValid ? 'false' : 'true');
      }
    });
  }
  
  return isValid;
}

/**
 * Show loading state on button
 * @param {HTMLButtonElement} button - Button to show loading state
 * @param {string} loadingText - Text to show while loading
 */
function showLoadingState(button, loadingText = 'Processing...') {
  if (!button) return;
  
  button.disabled = true;
  button.classList.add('loading');
  button.dataset.originalText = button.textContent;
  button.textContent = loadingText;
}

/**
 * Hide loading state on button
 * @param {HTMLButtonElement} button - Button to hide loading state
 */
function hideLoadingState(button) {
  if (!button) return;
  
  button.disabled = false;
  button.classList.remove('loading');
  button.textContent = button.dataset.originalText || 'Submit';
}

/**
 * Save form data to sessionStorage
 * @param {string} key - Storage key
 * @param {Object} data - Data to save
 */
function saveFormState(key, data) {
  try {
    sessionStorage.setItem(`pip_${key}`, JSON.stringify(data));
  } catch (err) {
    console.warn('Failed to save form state:', err);
  }
}

/**
 * Restore form data from sessionStorage
 * @param {string} key - Storage key
 * @returns {Object|null} Saved data or null
 */
function restoreFormState(key) {
  try {
    const saved = sessionStorage.getItem(`pip_${key}`);
    return saved ? JSON.parse(saved) : null;
  } catch (err) {
    console.warn('Failed to restore form state:', err);
    return null;
  }
}

/**
 * Clear saved form state
 * @param {string} key - Storage key
 */
function clearFormState(key) {
  try {
    sessionStorage.removeItem(`pip_${key}`);
  } catch (err) {
    console.warn('Failed to clear form state:', err);
  }
}

/**
 * Setup mobile menu toggle
 */
function setupMobileMenu() {
  const navToggle = document.getElementById('navToggle');
  const mobileMenu = document.querySelector('.mobile-menu');
  const menuClose = document.querySelector('.menu-close');
  
  if (!navToggle || !mobileMenu) return;
  
  // Toggle menu open/close
  navToggle.addEventListener('click', () => {
    const isOpen = navToggle.getAttribute('aria-expanded') === 'true';
    navToggle.setAttribute('aria-expanded', !isOpen);
    mobileMenu.hidden = isOpen;
  });
  
  // Close menu
  if (menuClose) {
    menuClose.addEventListener('click', () => {
      navToggle.setAttribute('aria-expanded', 'false');
      mobileMenu.hidden = true;
    });
  }
  
  // Close menu when clicking on a link
  const menuLinks = mobileMenu?.querySelectorAll('a');
  menuLinks?.forEach(link => {
    link.addEventListener('click', () => {
      navToggle.setAttribute('aria-expanded', 'false');
      mobileMenu.hidden = true;
    });
  });
}

/**
 * Setup progress indicator
 * @param {number} currentStep - Current step (1, 2, 3, ...)
 */
function setProgressStep(currentStep) {
  const steps = document.querySelectorAll('.progress-steps .step');
  steps.forEach((step, index) => {
    const stepNum = index + 1;
    if (stepNum < currentStep) {
      step.classList.add('completed');
      step.classList.remove('active');
    } else if (stepNum === currentStep) {
      step.classList.add('active');
      step.classList.remove('completed');
    } else {
      step.classList.remove('active', 'completed');
    }
  });
  
  // Update progress bar
  const progressFill = document.querySelector('.progress-fill');
  if (progressFill) {
    const percentage = (currentStep / steps.length) * 100;
    progressFill.style.width = `${percentage}%`;
  }
}

/**
 * Format currency
 * @param {number} amount - Amount to format
 * @param {string} currency - Currency code (default: 'INR')
 * @returns {string} Formatted currency
 */
function formatCurrency(amount, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(amount);
}

/**
 * Track page analytics (when implemented)
 * @param {string} event - Event name
 * @param {Object} data - Event data
 */
function trackEvent(event, data = {}) {
  // Placeholder for analytics integration (Google Analytics, Mixpanel, etc.)
  console.log(`[Analytics] Event: ${event}`, data);
  
  // Example: Send to custom analytics endpoint
  // fetch('/.netlify/functions/track-event', {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify({ event, data })
  // });
}

/**
 * Initialize keyboard shortcuts
 */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Escape to close mobile menu
    if (e.key === 'Escape') {
      const navToggle = document.getElementById('navToggle');
      const mobileMenu = document.querySelector('.mobile-menu');
      if (mobileMenu && !mobileMenu.hidden) {
        navToggle?.setAttribute('aria-expanded', 'false');
        mobileMenu.hidden = true;
      }
    }
  });
}

// Initialize on document ready
document.addEventListener('DOMContentLoaded', () => {
  setupMobileMenu();
  setupKeyboardShortcuts();
});

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    showToast,
    copyToClipboard,
    setupCopyButton,
    captureUTMParams,
    setupFormValidation,
    validateField,
    showLoadingState,
    hideLoadingState,
    saveFormState,
    restoreFormState,
    clearFormState,
    setupMobileMenu,
    setProgressStep,
    formatCurrency,
    trackEvent,
    setupKeyboardShortcuts
  };
}

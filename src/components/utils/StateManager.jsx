// State persistence utilities
const STATE_KEYS = {
  CURRENT_PAGE: 'nt_current_page',
  FORM_DATA: 'nt_form_data',
  CONVERSATION_STATE: 'nt_conversation_state',
  LAST_VISIT: 'nt_last_visit',
  USER_PREFERENCES: 'nt_user_preferences'
};

export const StateManager = {
  // Save current page and any form data
  saveCurrentState: (pageName, formData = {}, additionalData = {}) => {
    try {
      const state = {
        page: pageName,
        formData,
        timestamp: Date.now(),
        ...additionalData
      };
      localStorage.setItem(STATE_KEYS.CURRENT_PAGE, JSON.stringify(state));
    } catch (error) {
      console.warn('Failed to save state:', error);
    }
  },

  // Restore last known state
  restoreState: () => {
    try {
      const saved = localStorage.getItem(STATE_KEYS.CURRENT_PAGE);
      if (saved) {
        const state = JSON.parse(saved);
        // Only restore if less than 24 hours old
        if (Date.now() - state.timestamp < 24 * 60 * 60 * 1000) {
          return state;
        }
      }
    } catch (error) {
      console.warn('Failed to restore state:', error);
    }
    return null;
  },

  // Save conversation state for AI assistants
  saveConversationState: (conversationId, messages, context = {}) => {
    try {
      const state = {
        conversationId,
        messages,
        context,
        timestamp: Date.now()
      };
      localStorage.setItem(STATE_KEYS.CONVERSATION_STATE, JSON.stringify(state));
    } catch (error) {
      console.warn('Failed to save conversation state:', error);
    }
  },

  // Restore conversation state
  restoreConversationState: () => {
    try {
      const saved = localStorage.getItem(STATE_KEYS.CONVERSATION_STATE);
      if (saved) {
        const state = JSON.parse(saved);
        // Only restore if less than 2 hours old
        if (Date.now() - state.timestamp < 2 * 60 * 60 * 1000) {
          return state;
        }
      }
    } catch (error) {
      console.warn('Failed to restore conversation state:', error);
    }
    return null;
  },

  // Save form data for specific forms
  saveFormData: (formId, data) => {
    try {
      const formData = JSON.parse(localStorage.getItem(STATE_KEYS.FORM_DATA) || '{}');
      formData[formId] = {
        data,
        timestamp: Date.now()
      };
      localStorage.setItem(STATE_KEYS.FORM_DATA, JSON.stringify(formData));
    } catch (error) {
      console.warn('Failed to save form data:', error);
    }
  },

  // Restore form data
  restoreFormData: (formId) => {
    try {
      const formData = JSON.parse(localStorage.getItem(STATE_KEYS.FORM_DATA) || '{}');
      const saved = formData[formId];
      if (saved && Date.now() - saved.timestamp < 60 * 60 * 1000) { // 1 hour
        return saved.data;
      }
    } catch (error) {
      console.warn('Failed to restore form data:', error);
    }
    return null;
  },

  // Clear all saved state (for logout or reset)
  clearState: () => {
    try {
      Object.values(STATE_KEYS).forEach(key => {
        localStorage.removeItem(key);
      });
    } catch (error) {
      console.warn('Failed to clear state:', error);
    }
  },

  // Check if app was backgrounded recently (vs fresh start)
  wasRecentlyActive: () => {
    try {
      const lastVisit = localStorage.getItem(STATE_KEYS.LAST_VISIT);
      if (lastVisit) {
        const timeDiff = Date.now() - parseInt(lastVisit);
        return timeDiff < 30 * 60 * 1000; // 30 minutes
      }
    } catch (error) {
      console.warn('Failed to check recent activity:', error);
    }
    return false;
  },

  // Mark app as active
  markActive: () => {
    try {
      localStorage.setItem(STATE_KEYS.LAST_VISIT, String(Date.now()));
    } catch (error) {
      console.warn('Failed to mark active:', error);
    }
  }
};
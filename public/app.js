// ============================================
// TELEGRAM MINI APP - CHECKLIST
// ============================================

class ChecklistApp {
  constructor() {
    this.checklists = [];
    this.currentChecklistId = null;
    this.currentItemId = null;
    this.userId = null;
    this.isAdmin = false;
    this.groupId = 'default-group';
    
    // Initialize Telegram Web App
    this.initTelegram();
    
    // Initialize Socket.io
    this.socket = io();
    this.setupSocketEvents();
    
    // Setup UI events
    this.setupEventListeners();
    
    // Authenticate and load data
    this.authenticate();
  }

  // ============================================
  // TELEGRAM INITIALIZATION
  // ============================================

  initTelegram() {
    if (window.Telegram && window.Telegram.WebApp) {
      const webApp = window.Telegram.WebApp;
      webApp.ready();
      
      // Set header color
      webApp.setHeaderColor('#1a1f2b');
      webApp.setBackgroundColor('#0f1419');
      
      // Get group ID if available
      const chat = webApp.initDataUnsafe?.chat;
      if (chat) {
        this.groupId = chat.id.toString();
      }
    }
  }

  // ============================================
  // AUTHENTICATION
  // ============================================

  async authenticate() {
    try {
      // Get initData from Telegram Web App
      const initData = window.Telegram?.WebApp?.initData;
      
      if (!initData) {
        // Development mode
        console.log('⚠️  Development mode - no Telegram initData');
        this.userId = 'dev-' + Math.random().toString(36).substr(2, 9);
        this.loadChecklists();
        return;
      }

      // Send initData to server for verification
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData })
      });

      if (!response.ok) {
        throw new Error('Auth failed');
      }

      const data = await response.json();
      this.userId = data.userId;
      this.isAdmin = data.isAdmin;

      console.log('✅ Authenticated as:', this.userId, 'Admin:', this.isAdmin);
      
      this.loadChecklists();
    } catch (err) {
      console.error('Auth error:', err);
      this.showNotification('❌ Authentication error');
    }
  }

  // ============================================
  // SOCKET.IO EVENTS
  // ============================================

  setupSocketEvents() {
    // Initial data
    this.socket.on('init', (data) => {
      console.log('Initialized with data');
      this.checklists = Array.isArray(data.checklists) 
        ? data.checklists 
        : Object.values(data.checklists || {});
      this.renderChecklistsList();
    });

    // New checklist created
    this.socket.on('checklistCreated', (checklist) => {
      console.log('Checklist created:', checklist);
      this.checklists.push(checklist);
      this.renderChecklistsList();
      this.showNotification('✅ Checklist created');
    });

    // Item status updated
    this.socket.on('itemUpdated', (data) => {
      const { checklistId, itemId, status, emoji, modifiedBy } = data;
      const checklist = this.checklists.find(c => String(c._id) === String(checklistId) || String(c.id) === String(checklistId));
      
      if (checklist) {
        const item = checklist.items.find(i => String(i._id) === String(itemId) || String(i.id) === String(itemId));
        if (item) {
          item.status = status;
          item.emoji = emoji;
          if (String(this.currentChecklistId) === String(checklistId)) {
            this.renderChecklistItems();
            if (modifiedBy !== this.userId) {
              this.showNotification('🔄 Updated');
            }
          }
        }
      }
    });

    // Item details updated
    this.socket.on('detailsUpdated', (data) => {
      const { checklistId, itemId, details, modifiedBy } = data;
      const checklist = this.checklists.find(c => String(c._id) === String(checklistId) || String(c.id) === String(checklistId));
      
      if (checklist) {
        const item = checklist.items.find(i => String(i._id) === String(itemId) || String(i.id) === String(itemId));
        if (item) {
          item.details = details;
          if (String(this.currentItemId) === String(itemId)) {
            this.updateDetailsModal(item);
          }
        }
      }
    });

    // Emoji updated
    this.socket.on('emojiUpdated', (data) => {
      const { checklistId, itemId, emoji } = data;
      const checklist = this.checklists.find(c => String(c._id) === String(checklistId) || String(c.id) === String(checklistId));
      
      if (checklist) {
        const item = checklist.items.find(i => String(i._id) === String(itemId) || String(i.id) === String(itemId));
        if (item) {
          item.emoji = emoji;
          if (String(this.currentChecklistId) === String(checklistId)) {
            this.renderChecklistItems();
          }
        }
      }
    });

    // Checklist deleted
    this.socket.on('checklistDeleted', (data) => {
      const { checklistId } = data;
      this.checklists = this.checklists.filter(c => String(c._id) !== String(checklistId) && String(c.id) !== String(checklistId));
      if (String(this.currentChecklistId) === String(checklistId)) {
        this.showChecklistScreen(null);
      }
      this.renderChecklistsList();
      this.showNotification('🗑️ Checklist deleted');
    });

    // Template updated by admin - refresh data
    this.socket.on('templateUpdated', () => {
      this.showNotification('🔄 Template updated, refreshing...');
      this.loadChecklists();
    });
  }

  // ============================================
  // EVENT LISTENERS
  // ============================================

  setupEventListeners() {
    // Create new checklist
    document.getElementById('addBtn').addEventListener('click', () => {
      this.showCreateModal();
    });

    // Cancel create
    document.getElementById('cancelBtn').addEventListener('click', () => {
      this.hideCreateModal();
    });

    // Create checklist
    document.getElementById('createBtn').addEventListener('click', () => {
      this.createChecklist();
    });

    // Back button
    document.getElementById('backBtn').addEventListener('click', () => {
      this.showChecklistScreen(null);
    });

    // Delete checklist
    document.getElementById('deleteBtn').addEventListener('click', () => {
      if (confirm('Are you sure? This action cannot be undone.')) {
        this.socket.emit('deleteChecklist', { checklistId: this.currentChecklistId });
      }
    });

    // Close details modal
    document.getElementById('closeDetailsBtn').addEventListener('click', () => {
      this.hideDetailsModal();
    });

    // Save details
    document.getElementById('saveDetailsBtn').addEventListener('click', () => {
      this.saveItemDetails();
    });

    // Copy buttons
    document.querySelectorAll('.btn-copy').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const field = e.target.dataset.field;
        const input = document.getElementById(field + 'Input');
        this.copyToClipboard(input.value, field);
      });
    });

    // Enter key on name input
    document.getElementById('nameInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.createChecklist();
      }
    });
  }

  // ============================================
  // MODALS
  // ============================================

  showCreateModal() {
    const modal = document.getElementById('createModal');
    const input = document.getElementById('nameInput');
    modal.classList.remove('hidden');
    input.value = '';
    input.focus();
  }

  hideCreateModal() {
    document.getElementById('createModal').classList.add('hidden');
  }

  showDetailsModal(checklistId, itemId) {
    const checklist = this.checklists.find(c => String(c._id) === String(checklistId) || String(c.id) === String(checklistId));
    if (!checklist) return;
    const item = checklist.items.find(i => String(i._id) === String(itemId) || String(i.id) === String(itemId));

    if (!item) return;

    this.currentItemId = itemId;
    document.getElementById('detailsTitle').textContent = item.name;
    
    // Fill in details
    document.getElementById('loginInput').value = item.details?.login || '';
    document.getElementById('passwordInput').value = item.details?.password || '';
    document.getElementById('phoneInput').value = item.details?.phone || '';
    document.getElementById('emailInput').value = item.details?.email || '';

    document.getElementById('detailsModal').classList.remove('hidden');
  }

  hideDetailsModal() {
    document.getElementById('detailsModal').classList.add('hidden');
    this.currentItemId = null;
  }

  updateDetailsModal(item) {
    document.getElementById('loginInput').value = item.details?.login || '';
    document.getElementById('passwordInput').value = item.details?.password || '';
    document.getElementById('phoneInput').value = item.details?.phone || '';
    document.getElementById('emailInput').value = item.details?.email || '';
  }

  // ============================================
  // CREATE CHECKLIST
  // ============================================

  createChecklist() {
    const name = document.getElementById('nameInput').value.trim();
    
    if (!name) {
      this.showNotification('⚠️ Enter checklist name');
      return;
    }

    if (name.length > 50) {
      this.showNotification('⚠️ Name is too long');
      return;
    }

    this.socket.emit('createChecklist', {
      name,
      userId: this.userId,
      groupId: this.groupId
    });

    this.hideCreateModal();
    this.showNotification('⏳ Creating...');
  }

  // ============================================
  // CHECKLIST OPERATIONS
  // ============================================

  showChecklistScreen(checklistId) {
    if (checklistId === null) {
      document.getElementById('listScreen').classList.remove('hidden');
      document.getElementById('checklistScreen').classList.add('hidden');
      this.currentChecklistId = null;
      return;
    }

    this.currentChecklistId = checklistId;
    const checklist = this.checklists.find(c => c._id === checklistId || c.id === checklistId || String(c.id) === String(checklistId));
    
    if (!checklist) {
      this.showNotification('❌ Checklist not found');
      return;
    }
    
    document.getElementById('checklistTitle').textContent = checklist.name;
    document.getElementById('checklistScreen').classList.remove('hidden');
    document.getElementById('listScreen').classList.add('hidden');
    
    this.renderChecklistItems();
  }

  updateItemStatus(checklistId, itemId) {
    this.socket.emit('updateItemStatus', {
      checklistId,
      itemId,
      userId: this.userId
    });
  }

  saveItemDetails() {
    const checklist = this.checklists.find(c => String(c._id) === String(this.currentChecklistId) || String(c.id) === String(this.currentChecklistId));
    if (!checklist) return;
    const item = checklist.items.find(i => String(i._id) === String(this.currentItemId) || String(i.id) === String(this.currentItemId));

    const details = {
      login: document.getElementById('loginInput').value,
      password: document.getElementById('passwordInput').value,
      phone: document.getElementById('phoneInput').value,
      email: document.getElementById('emailInput').value
    };

    this.socket.emit('updateItemDetails', {
      checklistId: this.currentChecklistId,
      itemId: this.currentItemId,
      details,
      userId: this.userId
    });

    this.hideDetailsModal();
    this.showNotification('💾 Saved');
  }

  // ============================================
  // RENDERING
  // ============================================

  loadChecklists() {
    this.socket.emit('init', { groupId: this.groupId });
  }

  renderChecklistsList() {
    const listContainer = document.getElementById('checklistsList');
    const emptyState = document.getElementById('emptyState');
    
    if (this.checklists.length === 0) {
      listContainer.innerHTML = '';
      emptyState.style.display = 'flex';
      return;
    }

    emptyState.style.display = 'none';

    listContainer.innerHTML = this.checklists
      .filter(checklist => checklist && checklist.items)
      .sort((a, b) => new Date(b.created_at || b.createdAt) - new Date(a.created_at || a.createdAt))
      .map(checklist => {
        const checklistId = checklist._id || checklist.id;

        return `
          <div class="checklist-item" onclick="app.showChecklistScreen('${checklistId}')">
            <div class="checklist-info">
              <div class="checklist-name">${this.escapeHtml(checklist.name)}</div>
            </div>
            <div class="checklist-arrow">→</div>
          </div>
        `;
      })
      .join('');
  }

  renderChecklistItems() {
    const itemsContainer = document.getElementById('itemsList');
    const checklist = this.checklists.find(c => c._id === this.currentChecklistId || c.id === this.currentChecklistId || String(c.id) === String(this.currentChecklistId));

    if (!checklist || !checklist.items) {
      itemsContainer.innerHTML = '<p class="text-secondary">No items</p>';
      return;
    }

    itemsContainer.innerHTML = checklist.items
      .map(item => {
        const itemId = item._id || item.id;
        const checklistId = checklist._id || checklist.id;
        return `
          <div class="item">
            <div class="item-status" onclick="event.stopPropagation(); app.updateItemStatus('${checklistId}', '${itemId}')">
              ${item.emoji}
            </div>
            <div class="item-header" onclick="app.showDetailsModal('${checklistId}', '${itemId}')">
              <div>
                <div class="item-name">${this.escapeHtml(item.name)}</div>
              </div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  // ============================================
  // UTILITIES
  // ============================================

  copyToClipboard(text, field) {
    if (!text) {
      this.showNotification('❌ Field is empty');
      return;
    }

    navigator.clipboard.writeText(text).then(() => {
      this.showNotification(`📋 ${field.toUpperCase()} copied`);
    });
  }

  showNotification(message) {
    console.log(message);
    // Simple toast notification instead of Telegram popup
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new ChecklistApp();
});
